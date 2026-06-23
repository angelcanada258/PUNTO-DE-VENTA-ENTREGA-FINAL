const assert = require('node:assert/strict');
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
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
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
  return {
    response,
    body: await response.json()
  };
}

test('sale associates permission and rental to its only visitor', async () => {
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'extranjero', cantidad: 1 }],
      extras: [
        { servicio_id: 'dron', cantidad: 1 },
        { servicio_id: 'kayak', cantidad: 1 }
      ]
    })
  });
  const folio = sale.body.brazaletes[0].folio;
  const detail = await request(`/api/brazaletes/${folio}`);
  const catalog = await request('/api/catalogo-pos');

  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.venta.total, 800);
  assert.deepEqual(
    detail.body.brazalete.extras.map((extra) => extra.servicio_id).sort(),
    ['dron', 'kayak']
  );
  assert.equal(detail.body.brazalete.total_acumulado, 800);
  assert.equal(
    catalog.body.inventario.find((item) => item.id === 'kayak').disponible,
    9
  );
});

test('sale assigns extras to selected visitors in a group', async () => {
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'tarjeta',
      items: [
        { ticket_id: 'nacional', cantidad: 1 },
        { ticket_id: 'nino', cantidad: 1 }
      ],
      extras: [
        { servicio_id: 'dron', cantidad: 1, visitante_indice: 0 },
        { servicio_id: 'chaleco', cantidad: 1, visitante_indice: 1 }
      ]
    })
  });
  const first = await request(`/api/brazaletes/${sale.body.brazaletes[0].folio}`);
  const second = await request(`/api/brazaletes/${sale.body.brazaletes[1].folio}`);

  assert.deepEqual(first.body.brazalete.extras.map((item) => item.servicio_id), ['dron']);
  assert.deepEqual(second.body.brazalete.extras.map((item) => item.servicio_id), ['chaleco']);
});

test('additional sale does not change access state and exit releases rentals', async () => {
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }]
    })
  });
  const folio = sale.body.brazaletes[0].folio;
  await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const additional = await request('/api/adicionales', {
    method: 'POST',
    body: JSON.stringify({
      folio,
      operador: 'Luis',
      metodo_pago: 'tarjeta',
      items: [{ servicio_id: 'kayak', cantidad: 1 }]
    })
  });
  const beforeExit = await request(`/api/brazaletes/${folio}`);
  const exit = await request('/api/salida', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Luis' })
  });
  const catalog = await request('/api/catalogo-pos');

  assert.equal(additional.response.status, 201);
  assert.equal(additional.body.operacion.total, 200);
  assert.equal(beforeExit.body.brazalete.estado, 'adentro');
  assert.equal(exit.body.brazalete.estado, 'salido');
  assert.equal(exit.body.rentas_liberadas, 1);
  assert.equal(
    catalog.body.inventario.find((item) => item.id === 'kayak').disponible,
    10
  );
});

test('rental sale is rejected when there is no availability', async () => {
  const first = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }],
      extras: [{ servicio_id: 'kayak', cantidad: 10 }]
    })
  });
  const rejected = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }],
      extras: [{ servicio_id: 'kayak', cantidad: 1 }]
    })
  });

  assert.equal(first.response.status, 201);
  assert.equal(rejected.response.status, 409);
  assert.match(rejected.body.error, /disponibilidad|stock/i);
});

test('additional sale rejects cancelled or exited wristbands', async () => {
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }]
    })
  });
  const folio = sale.body.brazaletes[0].folio;
  await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  await request('/api/salida', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const additional = await request('/api/adicionales', {
    method: 'POST',
    body: JSON.stringify({
      folio,
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ servicio_id: 'dron', cantidad: 1 }]
    })
  });

  assert.equal(additional.response.status, 409);
});
