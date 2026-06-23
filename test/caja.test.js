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
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

async function abrirTurno(overrides = {}) {
  return request('/api/caja/turnos/abrir', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      fondo_inicial: 1000,
      tipo_cambio_usd: 18,
      ...overrides
    })
  });
}

test('login accepts the seeded default users and rejects a wrong PIN', async () => {
  const ok = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'admin', pin: '1234' })
  });
  const bad = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'admin', pin: 'wrong' })
  });

  assert.equal(ok.response.status, 200);
  assert.equal(ok.body.rol, 'admin');
  assert.equal(bad.response.status, 401);
});

test('an admin can create a named cashier, who can then log in and be deactivated', async () => {
  const created = await request('/api/caja/usuarios', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'maria', pin: '5555', rol: 'cajera' })
  });
  const duplicate = await request('/api/caja/usuarios', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'maria', pin: '1111', rol: 'cajera' })
  });
  const loginOk = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'maria', pin: '5555' })
  });

  assert.equal(created.response.status, 201);
  assert.equal(duplicate.response.status, 409);
  assert.equal(loginOk.body.rol, 'cajera');

  await request('/api/caja/usuarios/maria/desactivar', { method: 'POST' });
  const loginAfterDeactivate = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'maria', pin: '5555' })
  });
  assert.equal(loginAfterDeactivate.response.status, 401);

  const list = await request('/api/caja/usuarios');
  assert.ok(list.body.usuarios.some((u) => u.usuario === 'maria' && u.activo === false));
});

test('a deactivated user can be reactivated and can log in again', async () => {
  await request('/api/caja/usuarios', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'paco', pin: '5555', rol: 'cajera' })
  });
  await request('/api/caja/usuarios/paco/desactivar', { method: 'POST' });
  await request('/api/caja/usuarios/paco/activar', { method: 'POST' });

  const login = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'paco', pin: '5555' })
  });
  assert.equal(login.response.status, 200);
});

test('an admin can rename a user, change their role and reset their PIN', async () => {
  await request('/api/caja/usuarios', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'temporal', pin: '5555', rol: 'cajera' })
  });

  const edit = await request('/api/caja/usuarios/temporal', {
    method: 'PUT',
    body: JSON.stringify({ usuario: 'nuevo_empleado', pin: '9999', rol: 'admin' })
  });
  assert.equal(edit.response.status, 200);
  assert.equal(edit.body.usuario, 'nuevo_empleado');

  const oldLogin = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'temporal', pin: '5555' })
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await request('/api/caja/login', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'nuevo_empleado', pin: '9999' })
  });
  assert.equal(newLogin.response.status, 200);
  assert.equal(newLogin.body.rol, 'admin');
});

test('a user can be permanently deleted', async () => {
  await request('/api/caja/usuarios', {
    method: 'POST',
    body: JSON.stringify({ usuario: 'descartable', pin: '5555', rol: 'cajera' })
  });
  const del = await request('/api/caja/usuarios/descartable', { method: 'DELETE' });
  assert.equal(del.response.status, 200);

  const list = await request('/api/caja/usuarios');
  assert.ok(!list.body.usuarios.some((u) => u.usuario === 'descartable'));
});

test('the last active admin cannot be deleted, deactivated, or demoted', async () => {
  // El seed solo trae un admin ("admin"); confirmamos las tres protecciones contra él.
  const del = await request('/api/caja/usuarios/admin', { method: 'DELETE' });
  const off = await request('/api/caja/usuarios/admin/desactivar', { method: 'POST' });
  const demote = await request('/api/caja/usuarios/admin', {
    method: 'PUT',
    body: JSON.stringify({ rol: 'cajera' })
  });

  assert.equal(del.response.status, 409);
  assert.equal(off.response.status, 409);
  assert.equal(demote.response.status, 409);
});

test('PIN hashes are salted and never store the plain PIN', () => {
  const { hashPin, verifyPin } = require('../services/auth');
  const stored = hashPin('1234');

  assert.doesNotMatch(stored, /^1234$/);
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/);
  assert.ok(verifyPin('1234', stored));
  assert.ok(!verifyPin('0000', stored));
  assert.notEqual(hashPin('1234'), hashPin('1234')); // different salt each time
});

test('only one shift can be open at a time', async () => {
  const first = await abrirTurno();
  const second = await abrirTurno({ operador: 'admin' });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 409);
});

test('a sale with split payments generates one folio per visitor and applies each line in order', async () => {
  await abrirTurno();
  const sale = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'nacional', cantidad: 2 }],
      pagos: [
        { metodo: 'efectivo', monto: 300 },
        { metodo: 'visa', monto: 200 }
      ]
    })
  });

  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.folios.length, 2);
  assert.equal(sale.body.venta.total, 500);
  assert.equal(sale.body.pagos[0].monto_recibido, 300);
  assert.equal(sale.body.pagos[0].monto_mxn, 300);
  assert.equal(sale.body.pagos[0].cambio, 0);
  assert.equal(sale.body.pagos[1].monto_mxn, 200);
});

test('a cash overpayment is capped at the total and the rest becomes change', async () => {
  await abrirTurno();
  const sale = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'nino', cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 500 }]
    })
  });

  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.venta.total, 150);
  assert.equal(sale.body.pagos[0].monto_recibido, 500);
  assert.equal(sale.body.pagos[0].monto_mxn, 150);
  assert.equal(sale.body.pagos[0].cambio, 350);
});

test('a dollar payment is converted using the shift exchange rate and can overpay for change', async () => {
  await abrirTurno({ tipo_cambio_usd: 20 });
  const sale = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'extranjero', cantidad: 1 }],
      pagos: [{ metodo: 'dolar', monto: 20 }]
    })
  });

  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.venta.total, 350);
  assert.equal(sale.body.pagos[0].monto_recibido, 400);
  assert.equal(sale.body.pagos[0].monto_mxn, 350);
  assert.equal(sale.body.pagos[0].cambio, 50);
});

test('a card payment cannot exceed the remaining balance', async () => {
  await abrirTurno();
  const sale = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'nino', cantidad: 1 }],
      pagos: [{ metodo: 'visa', monto: 200 }]
    })
  });

  assert.equal(sale.response.status, 400);
  assert.match(sale.body.error, /no puede exceder/i);
});

test('a courtesy sale requires a reason and an authorizer, and charges nothing', async () => {
  await abrirTurno();
  const missingReason = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'inapam', cantidad: 1 }],
      pagos: [{ metodo: 'cortesia' }]
    })
  });
  const ok = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'inapam', cantidad: 1 }],
      pagos: [{ metodo: 'cortesia' }],
      motivo_cortesia: 'Invitado',
      autorizado_por: 'Gerente'
    })
  });

  assert.equal(missingReason.response.status, 400);
  assert.equal(ok.response.status, 201);
  assert.equal(ok.body.venta.total, 0);
  assert.equal(ok.body.folios[0].precio, 0);
});

test('a sale is rejected when there is not enough wristband stock for that color', async () => {
  await abrirTurno();
  // Stock per color starts at 100; two sales of 50 (the per-item max) exhaust it.
  for (let i = 0; i < 2; i += 1) {
    const sale = await request('/api/caja/ventas', {
      method: 'POST',
      body: JSON.stringify({
        operador: 'cajera',
        items: [{ ticket_id: 'nacional', cantidad: 50 }],
        pagos: [{ metodo: 'efectivo', monto: 12500 }]
      })
    });
    assert.equal(sale.response.status, 201);
  }

  const result = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'nacional', cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 250 }]
    })
  });

  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /stock/i);
});

test('cash movements update the expected cash and closing the shift persists the count and diff', async () => {
  await abrirTurno();
  await request('/api/caja/movimientos', {
    method: 'POST',
    body: JSON.stringify({ operador: 'cajera', tipo: 'deposito', monto: 200, concepto: 'Cambio extra' })
  });

  const corte = await request('/api/caja/corte');
  assert.equal(corte.body.efectivo_esperado, 1200);

  const cierre = await request('/api/caja/turnos/cerrar', {
    method: 'POST',
    body: JSON.stringify({ operador: 'admin', efectivo_contado: 1150 })
  });

  assert.equal(cierre.response.status, 200);
  assert.equal(cierre.body.turno.efectivo_esperado, 1200);
  assert.equal(cierre.body.turno.efectivo_contado, 1150);
  assert.equal(cierre.body.turno.diferencia, -50);

  const reabrir = await abrirTurno();
  assert.equal(reabrir.response.status, 201);

  const cerrados = await request('/api/caja/turnos/cerrados');
  assert.equal(cerrados.body.turnos.length, 1);
  assert.equal(cerrados.body.turnos[0].diferencia, -50);
});

test('closing the shift cancels wristbands still inside but keeps them counted against physical stock', async () => {
  await abrirTurno();
  await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'local', cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 150 }]
    })
  });

  const before = await request('/api/caja/inventario');
  const verdeBefore = before.body.inventario.find((i) => i.color === 'verde');
  assert.equal(verdeBefore.vendidos, 1);
  assert.equal(verdeBefore.adentro, 1);

  await request('/api/caja/turnos/cerrar', {
    method: 'POST',
    body: JSON.stringify({ operador: 'admin', efectivo_contado: 1150 })
  });

  await abrirTurno();
  const after = await request('/api/caja/inventario');
  const verdeAfter = after.body.inventario.find((i) => i.color === 'verde');
  // El brazalete físico ya se entregó: descuenta permanente del stock.
  assert.equal(verdeAfter.vendidos, 1);
  // Pero ya nadie está adentro de la laguna.
  assert.equal(verdeAfter.adentro, 0);
  assert.equal(verdeAfter.disponible, verdeAfter.stock_total - 1);
});

test('selling without an open shift is rejected', async () => {
  const result = await request('/api/caja/ventas', {
    method: 'POST',
    body: JSON.stringify({
      operador: 'cajera',
      items: [{ ticket_id: 'nacional', cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 250 }]
    })
  });

  assert.equal(result.response.status, 409);
});
