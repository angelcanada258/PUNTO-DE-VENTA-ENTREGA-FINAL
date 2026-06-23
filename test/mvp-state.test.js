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

test('MVP state is persisted in SQLite and returned after a later request', async () => {
  const state = {
    config: { aforoMax: 50, folioCounter: 17, operator: 'Miguel' },
    ventas: [{ id: 'SALE-7', total: 800 }],
    brazaletes: [{
      folio: 'KL-00017',
      estado: 'pendiente',
      extras: [{ requiresInventory: true, resourceId: 'kayaks' }]
    }],
    movimientos: [],
    inventory: { kayaks: { total: 10, occupied: 1 } }
  };

  const saved = await fetch(`${baseUrl}/api/mvp-state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state })
  });
  const loaded = await fetch(`${baseUrl}/api/mvp-state`);

  assert.equal(saved.status, 200);
  assert.deepEqual((await loaded.json()).state, state);
});

test('MVP state rejects malformed payloads', async () => {
  const response = await fetch(`${baseUrl}/api/mvp-state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: null })
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('MVP state removes demo occupancy when there are no active rentals', async () => {
  const state = {
    config: { aforoMax: 50 },
    brazaletes: [],
    ventas: [],
    movimientos: [],
    inventory: {
      kayaks: { name: 'Kayaks', total: 10, occupied: 2 },
      paddles: { name: 'Paddle boards', total: 8, occupied: 1 },
      lockers: { name: 'Lockers', total: 30, occupied: 6 },
      chalecos: { name: 'Chalecos', total: 50, occupied: 12 }
    }
  };

  await fetch(`${baseUrl}/api/mvp-state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state })
  });
  const response = await fetch(`${baseUrl}/api/mvp-state`);
  const body = await response.json();

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(body.state.inventory).map(([id, item]) => [id, item.occupied])
    ),
    { kayaks: 0, paddles: 0, lockers: 0, chalecos: 0 }
  );
});
