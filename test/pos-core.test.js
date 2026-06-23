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

test('cashier opens a shift and creates one pending wristband per visitor', async () => {
  const opened = await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 2000 })
  });
  const tickets = await request('/api/tickets');
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [
        { ticket_id: 'nacional', cantidad: 2 },
        { ticket_id: 'nino', cantidad: 1 }
      ]
    })
  });

  assert.equal(opened.response.status, 201);
  assert.equal(opened.body.turno.estado, 'abierto');
  assert.equal(tickets.body.tickets.length, 7);
  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.venta.total, 650);
  assert.deepEqual(
    sale.body.brazaletes.map(({ folio, estado }) => ({ folio, estado })),
    [
      { folio: 'NCNL-001', estado: 'pendiente' },
      { folio: 'NCNL-002', estado: 'pendiente' },
      { folio: 'NÑ-001', estado: 'pendiente' }
    ]
  );
});

test('access rejects unknown folios and only advances sold wristbands', async () => {
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const sale = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'tarjeta',
      items: [{ ticket_id: 'extranjero', cantidad: 1 }]
    })
  });
  const folio = sale.body.brazaletes[0].folio;

  const unknown = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio: 'NCNL-999', operador: 'Ana' })
  });
  // adapt expected unknown folio to new prefix scheme
  // KL-99999 no longer used
  const entry = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const duplicate = await request('/api/entrada', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Ana' })
  });
  const exit = await request('/api/salida', {
    method: 'POST',
    body: JSON.stringify({ folio, operador: 'Luis' })
  });

  assert.equal(unknown.response.status, 404);
  assert.match(unknown.body.error, /no registrado/i);
  assert.equal(entry.body.brazalete.estado, 'adentro');
  assert.equal(duplicate.response.status, 409);
  assert.equal(exit.body.brazalete.estado, 'salido');
  assert.equal(exit.body.brazalete.operador_salida, 'Luis');
});

test('sales require an open shift and manual folios are audited and unique', async () => {
  const withoutShift = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'nacional', cantidad: 1 }]
    })
  });
  await request('/api/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({ operador: 'Ana', deposito_inicial: 0 })
  });
  const first = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'local', cantidad: 1, folios: ['FISICO-100'] }]
    })
  });
  const duplicate = await request('/api/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'Ana',
      metodo_pago: 'efectivo',
      items: [{ ticket_id: 'local', cantidad: 1, folios: ['FISICO-100'] }]
    })
  });

  assert.equal(withoutShift.response.status, 409);
  assert.equal(first.body.brazaletes[0].asignacion_manual, true);
  assert.equal(duplicate.response.status, 409);
});
