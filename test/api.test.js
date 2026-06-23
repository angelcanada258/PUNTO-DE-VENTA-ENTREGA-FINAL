const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');
const { createDatabase } = require('../database');
const { createApp } = require('../create-app');

let repository;
let server;
let baseUrl;

beforeEach(async () => {
  repository = createDatabase(':memory:');
  server = createApp(repository).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  repository.close();
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('server exports the Express handler expected by Vercel', () => {
  const handler = require('../index');

  assert.equal(typeof handler, 'function');
  assert.equal(typeof handler.use, 'function');
});

test('Vercel routes every request to the explicit Express entrypoint', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')
  );

  assert.equal(config.builds[0].src, 'index.js');
  assert.equal(config.builds[0].use, '@vercel/node');
  assert.deepEqual(config.routes[0], { src: '/(.*)', dest: '/index.js' });
});

test('database stores required fields and calculates who is inside', () => {
  repository.insertarRegistro({
    folio: 'KL-001',
    tipo: 'adulto',
    evento: 'entrada',
    timestamp: 1718100000000,
    fecha: '2024-06-11',
    tarifa: 'mexicano',
    precio: 250,
    servicios: [],
    total: 250
  });

  const registros = repository.obtenerRegistrosPorFecha('2024-06-11');
  const adentro = repository.obtenerAdentroAhora('2024-06-11');

  assert.equal(registros.length, 1);
  assert.equal(registros[0].folio, 'KL-001');
  assert.equal(adentro.length, 1);
  assert.equal(adentro[0].entrada_timestamp, 1718100000000);
});

test('POST entrada normalizes folio and rejects a duplicate open entry', async () => {
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1, folios: ['KL-100'] }]
    })
  });
  const first = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: ' kl-100 ', operador: 'Ana' })
  });
  const duplicate = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: 'KL-100', operador: 'Ana' })
  });

  assert.equal(sale.response.status, 201);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.folio, 'KL-100');
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.success, false);
});

test('the default local repository exposes the POS core', () => {
  const selectedRepository = require('../repository');

  assert.equal(typeof selectedRepository.pos.listarTickets, 'function');
  assert.equal(typeof selectedRepository.pos.crearVenta, 'function');
});

test('POST salida returns visit duration and prevents a second exit', async () => {
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nino', cantidad: 1 }]
    })
  });
  const folio = sale.body.brazaletes[0].folio;
  await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const exit = await request('/api/salida', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const duplicate = await request('/api/salida', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });

  assert.equal(exit.response.status, 200);
  assert.equal(exit.body.success, true);
  assert.equal(typeof exit.body.duracion_minutos, 'number');
  assert.equal(duplicate.response.status, 409);
});

test('entry is rejected when capacity reaches 50 people', async () => {
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 50 }]
    })
  });
  for (const wristband of sale.body.brazaletes) {
    await request('/api/entrada', {
      method: 'POST',
      body: JSON.stringify({ folio: wristband.folio, operador: 'Ana' })
    });
  }
  const extra = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }]
    })
  });
  const result = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: extra.body.brazaletes[0].folio, operador: 'Ana' })
  });

  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /aforo/i);
});

test('dashboard, history, reports and CSV expose daily operation', async () => {
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'local', cantidad: 1 }]
    })
  });
  await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: sale.body.brazaletes[0].folio, operador: 'Ana' })
  });

  const dashboard = await request('/api/dashboard');
  const inside = await request('/api/adentro-pos');
  const reports = await request('/api/reportes');
  const csv = await request('/api/exportar');

  assert.equal(dashboard.body.adentro, 1);
  assert.equal(dashboard.body.tipos.local, 1);
  assert.equal(inside.body.length, 1);
  assert.equal(reports.response.status, 200);
  assert.match(csv.response.headers.get('content-disposition'), /attachment/);
  assert.match(csv.body, /Folio,Tipo,Evento,Fecha,Hora/);
});

test('all API failures use the JSON error contract', async () => {
  const invalid = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: '', operador: '' })
  });
  const missing = await request('/api/no-existe');

  assert.equal(invalid.response.status, 409);
  assert.deepEqual(Object.keys(invalid.body).sort(), ['error', 'success']);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.success, false);
});
