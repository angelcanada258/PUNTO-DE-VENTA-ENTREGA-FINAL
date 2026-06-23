const { hashPin, verifyPin } = require('./auth');

const METODOS_PAGO = new Set([
  'efectivo', 'visa', 'mastercard', 'credito', 'dolar', 'transferencia', 'cortesia'
]);

function domainError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureCajaSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      usuario TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('admin', 'cajera')),
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caja_turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operador_apertura TEXT NOT NULL,
      fondo_inicial INTEGER NOT NULL DEFAULT 0,
      tipo_cambio_usd REAL NOT NULL DEFAULT 18,
      abierto_en INTEGER NOT NULL,
      cerrado_en INTEGER,
      operador_cierre TEXT,
      efectivo_esperado INTEGER,
      efectivo_contado INTEGER,
      diferencia INTEGER,
      estado TEXT NOT NULL CHECK(estado IN ('abierto', 'cerrado'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_turno_unico_abierto
      ON caja_turnos(estado) WHERE estado = 'abierto';

    CREATE TABLE IF NOT EXISTS caja_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER NOT NULL REFERENCES caja_turnos(id),
      operador TEXT NOT NULL,
      total INTEGER NOT NULL,
      total_usd REAL,
      es_cortesia INTEGER NOT NULL DEFAULT 0,
      motivo_cortesia TEXT,
      autorizado_por TEXT,
      creada_en INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caja_venta_pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL REFERENCES caja_ventas(id),
      metodo TEXT NOT NULL,
      monto_mxn INTEGER NOT NULL,
      monto_origen REAL,
      tipo_cambio REAL,
      monto_recibido INTEGER,
      cambio INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_caja_venta_pagos_venta ON caja_venta_pagos(venta_id);

    CREATE TABLE IF NOT EXISTS caja_brazaletes (
      folio TEXT PRIMARY KEY,
      venta_id INTEGER NOT NULL REFERENCES caja_ventas(id),
      turno_id INTEGER NOT NULL REFERENCES caja_turnos(id),
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      nombre TEXT NOT NULL,
      color TEXT NOT NULL,
      precio INTEGER NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('adentro', 'cancelado')) DEFAULT 'adentro',
      creado_en INTEGER NOT NULL,
      cancelado_en INTEGER,
      cancelado_motivo TEXT,
      operador TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_caja_brazaletes_turno ON caja_brazaletes(turno_id);
    CREATE INDEX IF NOT EXISTS idx_caja_brazaletes_color ON caja_brazaletes(color, estado);

    CREATE TABLE IF NOT EXISTS caja_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER NOT NULL REFERENCES caja_turnos(id),
      operador TEXT NOT NULL,
      tipo TEXT NOT NULL,
      folio TEXT,
      venta_id INTEGER,
      concepto TEXT NOT NULL,
      monto INTEGER NOT NULL DEFAULT 0,
      monto_usd REAL,
      metodo_pago TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_caja_movimientos_turno ON caja_movimientos(turno_id);

    CREATE TABLE IF NOT EXISTS caja_inventario_color (
      color TEXT PRIMARY KEY,
      stock_total INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS caja_recargas (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      color     TEXT    NOT NULL,
      folio_inicio INTEGER NOT NULL,
      folio_fin    INTEGER NOT NULL,
      cantidad  INTEGER NOT NULL,
      operador  TEXT,
      timestamp INTEGER NOT NULL
    );
  `);

  // Migración: las primeras versiones de este esquema usaban "billete_recibido".
  // Si la base ya existía con esa columna, la renombramos en vez de perder los
  // datos (CREATE TABLE IF NOT EXISTS no toca tablas que ya existen).
  const pagoColumns = new Set(
    db.prepare('PRAGMA table_info(caja_venta_pagos)').all().map((c) => c.name)
  );
  if (pagoColumns.has('billete_recibido') && !pagoColumns.has('monto_recibido')) {
    db.exec('ALTER TABLE caja_venta_pagos RENAME COLUMN billete_recibido TO monto_recibido');
  }

  const userCount = db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO usuarios(usuario, pin_hash, rol, activo, creado_en)
      VALUES (?, ?, ?, 1, ?)
    `);
    const now = Date.now();
    insertUser.run('admin', hashPin('1234'), 'admin', now);
    insertUser.run('cajera', hashPin('0000'), 'cajera', now);
    console.warn(
      '[Kaan Luum] Se crearon usuarios por defecto (admin/1234, cajera/0000). ' +
      'Cámbialos en cuanto puedas: ver "Cambiar PIN" en el panel de administración.'
    );
  }

  const colors = db.prepare('SELECT DISTINCT color_brazalete AS color FROM tickets').all();
  const insertColor = db.prepare(`
    INSERT OR IGNORE INTO caja_inventario_color(color, stock_total) VALUES (?, 100)
  `);
  for (const { color } of colors) insertColor.run(color);
}

function createCajaRepository(db) {
  ensureCajaSchema(db);

  function insertMovement(data) {
    db.prepare(`
      INSERT INTO caja_movimientos
        (turno_id, operador, tipo, folio, venta_id, concepto, monto, monto_usd, metodo_pago, timestamp)
      VALUES
        (@turno_id, @operador, @tipo, @folio, @venta_id, @concepto, @monto, @monto_usd, @metodo_pago, @timestamp)
    `).run({
      turno_id: data.turno_id,
      operador: data.operador,
      tipo: data.tipo,
      folio: data.folio ?? null,
      venta_id: data.venta_id ?? null,
      concepto: data.concepto,
      monto: Number(data.monto) || 0,
      monto_usd: data.monto_usd ?? null,
      metodo_pago: data.metodo_pago ?? null,
      timestamp: data.timestamp ?? Date.now()
    });
  }

  function getOpenShift() {
    return db.prepare(`
      SELECT * FROM caja_turnos WHERE estado = 'abierto' LIMIT 1
    `).get() || null;
  }

  function requireOpenShift() {
    const shift = getOpenShift();
    if (!shift) throw domainError(409, 'No hay un turno de caja abierto.');
    return shift;
  }

  function nextFolio(prefix) {
    const row = db.prepare(`
      SELECT folio FROM caja_brazaletes WHERE folio LIKE ? ORDER BY folio DESC LIMIT 1
    `).get(`${prefix}-%`);
    const last = row ? Number(row.folio.slice(prefix.length + 1)) || 0 : 0;
    return `${prefix}-${String(last + 1).padStart(3, '0')}`;
  }

  function login({ usuario, pin }) {
    const clean = String(usuario || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(clean);
    if (!user || !verifyPin(pin, user.pin_hash)) {
      throw domainError(401, 'Usuario o PIN incorrectos.');
    }
    return { usuario: user.usuario, rol: user.rol };
  }

  function cambiarPin({ usuario, pinActual, pinNuevo }) {
    const clean = String(usuario || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(clean);
    if (!user || !verifyPin(pinActual, user.pin_hash)) {
      throw domainError(401, 'PIN actual incorrecto.');
    }
    const nuevo = String(pinNuevo || '').trim();
    if (nuevo.length < 4) throw domainError(400, 'El nuevo PIN debe tener al menos 4 caracteres.');
    db.prepare('UPDATE usuarios SET pin_hash = ? WHERE usuario = ?').run(hashPin(nuevo), clean);
    return { usuario: clean };
  }

  function listarUsuarios() {
    return db.prepare(`
      SELECT usuario, rol, activo, creado_en FROM usuarios ORDER BY creado_en ASC
    `).all().map((row) => ({ ...row, activo: Boolean(row.activo) }));
  }

  function crearUsuario({ usuario, pin, rol }) {
    const clean = String(usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(clean)) {
      throw domainError(400, 'El nombre de usuario debe tener 3 a 30 letras/números (sin espacios ni acentos).');
    }
    const rolLimpio = String(rol || 'cajera');
    if (!['admin', 'cajera'].includes(rolLimpio)) {
      throw domainError(400, 'El rol debe ser admin o cajera.');
    }
    const pinLimpio = String(pin || '').trim();
    if (pinLimpio.length < 4) throw domainError(400, 'El PIN debe tener al menos 4 caracteres.');
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(clean)) {
      throw domainError(409, `Ya existe un usuario llamado "${clean}".`);
    }
    db.prepare(`
      INSERT INTO usuarios(usuario, pin_hash, rol, activo, creado_en)
      VALUES (?, ?, ?, 1, ?)
    `).run(clean, hashPin(pinLimpio), rolLimpio, Date.now());
    return { usuario: clean, rol: rolLimpio };
  }

  function getUsuarioOr404(usuario) {
    const clean = String(usuario || '').trim().toLowerCase();
    const row = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(clean);
    if (!row) throw domainError(404, `El usuario "${clean}" no existe.`);
    return row;
  }

  function contarAdminsActivos(excluyendo) {
    return db.prepare(`
      SELECT COUNT(*) c FROM usuarios WHERE rol = 'admin' AND activo = 1 AND usuario <> ?
    `).get(excluyendo || '').c;
  }

  function editarUsuario({ usuario, nuevoUsuario, nuevoPin, nuevoRol }) {
    const actual = getUsuarioOr404(usuario);
    const updates = {};

    if (nuevoUsuario !== undefined && nuevoUsuario !== null && String(nuevoUsuario).trim() !== '') {
      const limpio = String(nuevoUsuario).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(limpio)) {
        throw domainError(400, 'El nombre de usuario debe tener 3 a 30 letras/números (sin espacios ni acentos).');
      }
      if (limpio !== actual.usuario && db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(limpio)) {
        throw domainError(409, `Ya existe un usuario llamado "${limpio}".`);
      }
      updates.usuario = limpio;
    }

    if (nuevoRol !== undefined && nuevoRol !== null && String(nuevoRol).trim() !== '') {
      const rolLimpio = String(nuevoRol);
      if (!['admin', 'cajera'].includes(rolLimpio)) {
        throw domainError(400, 'El rol debe ser admin o cajera.');
      }
      if (actual.rol === 'admin' && rolLimpio !== 'admin' && contarAdminsActivos(actual.usuario) === 0) {
        throw domainError(409, 'No puedes quitar el rol de admin al único administrador activo.');
      }
      updates.rol = rolLimpio;
    }

    if (nuevoPin !== undefined && nuevoPin !== null && String(nuevoPin).trim() !== '') {
      const pinLimpio = String(nuevoPin).trim();
      if (pinLimpio.length < 4) throw domainError(400, 'El nuevo PIN debe tener al menos 4 caracteres.');
      updates.pin_hash = hashPin(pinLimpio);
    }

    if (Object.keys(updates).length === 0) {
      throw domainError(400, 'No hay cambios para guardar.');
    }

    const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE usuarios SET ${sets} WHERE usuario = ?`)
      .run(...Object.values(updates), actual.usuario);

    return { usuario: updates.usuario || actual.usuario };
  }

  function desactivarUsuario(usuario) {
    const actual = getUsuarioOr404(usuario);
    if (actual.rol === 'admin' && contarAdminsActivos(actual.usuario) === 0) {
      throw domainError(409, 'No puedes desactivar al único administrador activo.');
    }
    db.prepare('UPDATE usuarios SET activo = 0 WHERE usuario = ?').run(actual.usuario);
    return { usuario: actual.usuario };
  }

  function activarUsuario(usuario) {
    const actual = getUsuarioOr404(usuario);
    db.prepare('UPDATE usuarios SET activo = 1 WHERE usuario = ?').run(actual.usuario);
    return { usuario: actual.usuario };
  }

  function eliminarUsuario(usuario) {
    const actual = getUsuarioOr404(usuario);
    if (actual.rol === 'admin' && contarAdminsActivos(actual.usuario) === 0) {
      throw domainError(409, 'No puedes eliminar al único administrador activo.');
    }
    db.prepare('DELETE FROM usuarios WHERE usuario = ?').run(actual.usuario);
    return { usuario: actual.usuario };
  }

  function listarTickets() {
    return db.prepare('SELECT * FROM tickets WHERE activo = 1 ORDER BY precio DESC, nombre ASC').all()
      .map((row) => ({ ...row, activo: Boolean(row.activo) }));
  }

  // Cada brazalete generado descuenta del stock físico de por vida.
  // Incluye los 'cancelado' (cierre de turno) porque ese brazalete físico ya
  // se entregó. Los folios son únicos y crecen indefinidamente (ññ-001 → ññ-N).
  function obtenerInventarioColores() {
    const rows = db.prepare(`
      SELECT
        c.color,
        c.stock_total,
        (
          SELECT COUNT(*) FROM caja_brazaletes b WHERE b.color = c.color
        ) AS vendidos,
        (
          SELECT COUNT(*) FROM caja_brazaletes b
          WHERE b.color = c.color AND b.estado = 'adentro'
        ) AS adentro
      FROM caja_inventario_color c
      ORDER BY c.color
    `).all().map((row) => ({
      ...row,
      disponible: Math.max(0, row.stock_total - row.vendidos)
    }));

    const ultimasRecargas = db.prepare(`
      SELECT r.color, r.folio_inicio, r.folio_fin, r.cantidad, r.timestamp
      FROM caja_recargas r
      INNER JOIN (
        SELECT color, MAX(timestamp) AS mt FROM caja_recargas GROUP BY color
      ) m ON r.color = m.color AND r.timestamp = m.mt
    `).all();
    const recargaMap = Object.fromEntries(ultimasRecargas.map((r) => [r.color, r]));

    return rows.map((row) => ({ ...row, ultima_recarga: recargaMap[row.color] || null }));
  }

  // Aumenta el stock_total de un color (cuando llegan brazaletes físicos).
  // Registra el rango de folios físicos para trazabilidad.
  function recargarStock({ color, folio_inicio, folio_fin, operador }) {
    const colorLimpio = String(color || '').trim();
    if (!colorLimpio) throw domainError(400, 'Indica el color a recargar.');
    const fi = Math.round(Number(folio_inicio));
    const ff = Math.round(Number(folio_fin));
    if (!Number.isInteger(fi) || fi <= 0) throw domainError(400, 'El folio inicio debe ser un número positivo.');
    if (!Number.isInteger(ff) || ff < fi) throw domainError(400, 'El folio fin debe ser mayor o igual al folio inicio.');
    const n = ff - fi + 1;
    if (n > 10000) throw domainError(400, 'Rango de folios demasiado grande (máx 10,000).');
    const row = db.prepare('SELECT * FROM caja_inventario_color WHERE color = ?').get(colorLimpio);
    if (!row) throw domainError(404, `El color "${colorLimpio}" no existe en el inventario.`);
    db.transaction(() => {
      db.prepare('UPDATE caja_inventario_color SET stock_total = stock_total + ? WHERE color = ?')
        .run(n, colorLimpio);
      db.prepare(`INSERT INTO caja_recargas (color, folio_inicio, folio_fin, cantidad, operador, timestamp)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(colorLimpio, fi, ff, n, operador || null, Date.now());
    })();
    return { color: colorLimpio, agregado: n, folio_inicio: fi, folio_fin: ff, nuevo_stock_total: row.stock_total + n };
  }

  const abrirTurnoTransaction = db.transaction(({ operador, fondo_inicial, tipo_cambio_usd }) => {
    if (getOpenShift()) throw domainError(409, 'Ya existe un turno de caja abierto.');
    const operator = String(operador || '').trim();
    if (!operator) throw domainError(400, 'Selecciona un operador.');
    const fondo = Number(fondo_inicial);
    if (!Number.isInteger(fondo) || fondo < 0) {
      throw domainError(400, 'El fondo inicial debe ser un entero mayor o igual a cero.');
    }
    const tipoCambio = Number(tipo_cambio_usd);
    if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) {
      throw domainError(400, 'El tipo de cambio debe ser mayor a cero.');
    }
    const timestamp = Date.now();
    const result = db.prepare(`
      INSERT INTO caja_turnos(operador_apertura, fondo_inicial, tipo_cambio_usd, abierto_en, estado)
      VALUES (?, ?, ?, ?, 'abierto')
    `).run(operator, fondo, tipoCambio, timestamp);
    const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(result.lastInsertRowid);
    insertMovement({
      turno_id: turno.id,
      operador: operator,
      tipo: 'apertura_turno',
      concepto: `Apertura de turno #${turno.id} · TC ${tipoCambio}`,
      monto: fondo,
      metodo_pago: 'efectivo',
      timestamp
    });
    return turno;
  });

  // Métodos "en efectivo" (efectivo y dólares en mano): el cajero captura cuánto
  // entregó el cliente (monto_recibido), no cuánto se le cobra. Lo que se aplica a
  // la venta queda topado a lo que falte cubrir; lo que sobra es cambio a devolver.
  // Tarjeta/transferencia/crédito siguen siendo cobros exactos (no generan cambio).
  const METODOS_EFECTIVO = new Set(['efectivo', 'dolar']);

  function validarPagos(pagos, total, esCortesia, tipoCambioUsd) {
    if (esCortesia) {
      if (!Array.isArray(pagos) || pagos.length !== 1 || pagos[0].metodo !== 'cortesia') {
        throw domainError(400, 'Una venta de cortesía solo lleva un pago de tipo cortesía.');
      }
      return [{ metodo: 'cortesia', monto_mxn: 0, monto_origen: null, tipo_cambio: null, monto_recibido: null, cambio: null }];
    }
    if (!Array.isArray(pagos) || pagos.length === 0) {
      throw domainError(400, 'Agrega al menos un pago.');
    }

    const totalRedondeado = Math.round(total);
    let remaining = totalRedondeado;

    const lineas = pagos.map((pago) => {
      const metodo = String(pago?.metodo || '');
      if (!METODOS_PAGO.has(metodo) || metodo === 'cortesia') {
        throw domainError(400, `Método de pago inválido: ${metodo}.`);
      }

      if (metodo === 'dolar') {
        const montoUsd = Number(pago.monto);
        if (!Number.isFinite(montoUsd) || montoUsd <= 0) {
          throw domainError(400, 'El monto en dólares debe ser mayor a cero.');
        }
        const montoMxn = Math.round(montoUsd * tipoCambioUsd);
        const aplicado = Math.min(montoMxn, Math.max(0, remaining));
        const cambio = montoMxn - aplicado;
        remaining = Math.max(0, remaining - aplicado);
        return {
          metodo,
          monto_mxn: aplicado,
          monto_origen: montoUsd,
          tipo_cambio: tipoCambioUsd,
          monto_recibido: montoMxn,
          cambio
        };
      }

      const monto = Number(pago.monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        throw domainError(400, 'El monto del pago debe ser mayor a cero.');
      }

      if (metodo === 'efectivo') {
        const montoRecibido = Math.round(monto);
        const aplicado = Math.min(montoRecibido, Math.max(0, remaining));
        const cambio = montoRecibido - aplicado;
        remaining = Math.max(0, remaining - aplicado);
        return {
          metodo,
          monto_mxn: aplicado,
          monto_origen: null,
          tipo_cambio: null,
          monto_recibido: montoRecibido,
          cambio
        };
      }

      // Tarjeta / transferencia / crédito: cobro exacto, no admite sobrepago.
      if (monto - remaining > 0.5) {
        throw domainError(400, `El pago con ${metodo} no puede exceder el saldo pendiente (${remaining}).`);
      }
      const aplicado = Math.round(monto);
      remaining = Math.max(0, remaining - aplicado);
      return {
        metodo,
        monto_mxn: aplicado,
        monto_origen: null,
        tipo_cambio: null,
        monto_recibido: null,
        cambio: null
      };
    });

    const aplicado = lineas.reduce((sum, l) => sum + l.monto_mxn, 0);
    if (aplicado !== totalRedondeado) {
      throw domainError(
        400,
        `El pago cubre ${aplicado} de ${totalRedondeado}. Faltan ${totalRedondeado - aplicado}.`
      );
    }
    return lineas;
  }

  const crearVentaTransaction = db.transaction((payload) => {
    const shift = requireOpenShift();
    const operator = String(payload.operador || '').trim();
    if (!operator) throw domainError(400, 'Selecciona un operador.');
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw domainError(400, 'Agrega al menos un brazalete a la venta.');
    }

    const esCortesia = Array.isArray(payload.pagos) &&
      payload.pagos.some((pago) => pago?.metodo === 'cortesia');
    const motivoCortesia = String(payload.motivo_cortesia || '').trim();
    const autorizadoPor = String(payload.autorizado_por || '').trim();
    if (esCortesia && !motivoCortesia) {
      throw domainError(400, 'La cortesía requiere un motivo.');
    }
    if (esCortesia && !autorizadoPor) {
      throw domainError(400, 'La cortesía requiere quién la autoriza.');
    }

    const expanded = [];
    let total = 0;
    for (const item of payload.items) {
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND activo = 1').get(item.ticket_id);
      const cantidad = Number(item.cantidad);
      if (!ticket) throw domainError(404, `El ticket ${item.ticket_id} no existe o está inactivo.`);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) {
        throw domainError(400, 'La cantidad debe estar entre 1 y 50.');
      }
      const precio = esCortesia ? 0 : ticket.precio;
      total += precio * cantidad;
      expanded.push({ ticket, cantidad, precio });
    }

    if (total === 0 && !esCortesia) {
      throw domainError(400, 'No se puede registrar una venta de $0 sin marcarla como cortesía.');
    }

    for (const group of expanded) {
      const inventario = db.prepare(
        'SELECT * FROM caja_inventario_color WHERE color = ?'
      ).get(group.ticket.color_brazalete);
      const emitidos = db.prepare(`
        SELECT COUNT(*) c FROM caja_brazaletes WHERE color = ?
      `).get(group.ticket.color_brazalete).c;
      const disponible = Math.max(0, (inventario?.stock_total ?? 0) - emitidos);
      if (disponible < group.cantidad) {
        throw domainError(409, `Stock insuficiente de brazaletes ${group.ticket.color_brazalete} (${disponible} disp. — pide recarga al admin).`);
      }
    }

    const pagos = validarPagos(payload.pagos, total, esCortesia, shift.tipo_cambio_usd);
    const totalUsd = esCortesia ? null : total / shift.tipo_cambio_usd;
    const timestamp = Date.now();

    const ventaResult = db.prepare(`
      INSERT INTO caja_ventas
        (turno_id, operador, total, total_usd, es_cortesia, motivo_cortesia, autorizado_por, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shift.id,
      operator,
      total,
      totalUsd,
      esCortesia ? 1 : 0,
      esCortesia ? motivoCortesia : null,
      esCortesia ? autorizadoPor : null,
      timestamp
    );
    const ventaId = Number(ventaResult.lastInsertRowid);

    const insertPago = db.prepare(`
      INSERT INTO caja_venta_pagos
        (venta_id, metodo, monto_mxn, monto_origen, tipo_cambio, monto_recibido, cambio)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pago of pagos) {
      insertPago.run(
        ventaId, pago.metodo, pago.monto_mxn, pago.monto_origen,
        pago.tipo_cambio, pago.monto_recibido, pago.cambio
      );
      insertMovement({
        turno_id: shift.id,
        operador: operator,
        tipo: 'pago',
        venta_id: ventaId,
        concepto: `Pago ${pago.metodo}`,
        monto: pago.monto_mxn,
        monto_usd: pago.monto_origen,
        metodo_pago: pago.metodo,
        timestamp
      });
    }

    const folios = [];
    for (const group of expanded) {
      for (let i = 0; i < group.cantidad; i += 1) {
        const folio = nextFolio(group.ticket.prefijo || 'KL');
        db.prepare(`
          INSERT INTO caja_brazaletes
            (folio, venta_id, turno_id, ticket_id, nombre, color, precio, estado, creado_en, operador)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'adentro', ?, ?)
        `).run(
          folio, ventaId, shift.id, group.ticket.id, group.ticket.nombre,
          group.ticket.color_brazalete, group.precio, timestamp, operator
        );
        folios.push({
          folio,
          ticket_id: group.ticket.id,
          nombre: group.ticket.nombre,
          color: group.ticket.color_brazalete,
          precio: group.precio
        });
        insertMovement({
          turno_id: shift.id,
          operador: operator,
          tipo: 'venta',
          folio,
          venta_id: ventaId,
          concepto: `Brazalete ${group.ticket.nombre}${esCortesia ? ' (cortesía)' : ''}`,
          monto: group.precio,
          timestamp
        });
      }
    }

    return {
      venta: db.prepare('SELECT * FROM caja_ventas WHERE id = ?').get(ventaId),
      pagos,
      folios
    };
  });

  function registrarMovimientoCaja({ operador, tipo, monto, concepto }) {
    const shift = requireOpenShift();
    const operator = String(operador || '').trim();
    if (!operator) throw domainError(400, 'Selecciona un operador.');
    if (!['deposito', 'retiro'].includes(tipo)) {
      throw domainError(400, 'El tipo de movimiento debe ser depósito o retiro.');
    }
    const amount = Math.round(Number(monto));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw domainError(400, 'Captura un monto válido (entero positivo).');
    }
    const desc = String(concepto || '').trim();
    if (!desc) throw domainError(400, 'Captura una descripción.');
    insertMovement({
      turno_id: shift.id,
      operador: operator,
      tipo,
      concepto: desc,
      monto: amount,
      metodo_pago: 'efectivo'
    });
    return obtenerCorte();
  }

  function calcularTotalesTurno(turnoId) {
    const pagos = db.prepare(`
      SELECT vp.metodo, vp.monto_mxn, vp.monto_origen
      FROM caja_venta_pagos vp
      JOIN caja_ventas v ON v.id = vp.venta_id
      WHERE v.turno_id = ?
    `).all(turnoId);

    const porMetodo = {};
    for (const pago of pagos) {
      if (!porMetodo[pago.metodo]) porMetodo[pago.metodo] = { mxn: 0, usd: 0, conteo: 0 };
      porMetodo[pago.metodo].mxn += pago.monto_mxn;
      porMetodo[pago.metodo].conteo += 1;
      if (pago.metodo === 'dolar') porMetodo[pago.metodo].usd += pago.monto_origen || 0;
    }

    const depositos = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) s FROM caja_movimientos WHERE turno_id = ? AND tipo = 'deposito'
    `).get(turnoId).s;
    const retiros = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) s FROM caja_movimientos WHERE turno_id = ? AND tipo = 'retiro'
    `).get(turnoId).s;
    const totalVentas = Object.values(porMetodo).reduce((sum, m) => sum + m.mxn, 0);

    return { porMetodo, depositos, retiros, totalVentas };
  }

  function obtenerCorte() {
    const shift = requireOpenShift();
    return construirCorte(shift);
  }

  function construirCorte(shift) {
    const { porMetodo, depositos, retiros, totalVentas } = calcularTotalesTurno(shift.id);
    const efectivoVentas = porMetodo.efectivo?.mxn || 0;
    const efectivoEsperado = shift.fondo_inicial + efectivoVentas + depositos - retiros;
    const usdEsperado = porMetodo.dolar?.usd || 0;
    const movimientosCaja = db.prepare(`
      SELECT * FROM caja_movimientos
      WHERE turno_id = ? AND tipo IN ('deposito', 'retiro')
      ORDER BY timestamp DESC
    `).all(shift.id);

    // Resumen de operaciones (transacciones, ticket promedio, tiempos).
    const ventasStats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN es_cortesia = 0 THEN 1 ELSE 0 END), 0) AS cobradas,
        COALESCE(SUM(CASE WHEN es_cortesia = 0 THEN total ELSE 0 END), 0) AS monto_cobrado,
        MIN(creada_en) AS primera,
        MAX(creada_en) AS ultima
      FROM caja_ventas
      WHERE turno_id = ?
    `).get(shift.id);
    const ticketPromedio = ventasStats.cobradas > 0
      ? Math.round(ventasStats.monto_cobrado / ventasStats.cobradas)
      : 0;

    // Cortesías del turno.
    const cortesias = db.prepare(`
      SELECT
        COUNT(*) AS cantidad,
        COALESCE(SUM((
          SELECT COALESCE(SUM(t.precio), 0)
          FROM caja_brazaletes b
          JOIN tickets t ON t.id = b.ticket_id
          WHERE b.venta_id = v.id
        )), 0) AS valor_comercial
      FROM caja_ventas v
      WHERE v.turno_id = ? AND v.es_cortesia = 1
    `).get(shift.id);

    // Brazaletes vendidos por tipo (para conciliar inventario físico).
    const brazaletesPorTipo = db.prepare(`
      SELECT
        b.ticket_id,
        b.nombre,
        b.color,
        COUNT(*) AS cantidad,
        SUM(b.precio) AS total,
        COALESCE(SUM(CASE WHEN b.estado = 'cancelado' THEN 1 ELSE 0 END), 0) AS cancelados
      FROM caja_brazaletes b
      WHERE b.turno_id = ?
      GROUP BY b.ticket_id, b.nombre, b.color
      ORDER BY b.color, b.nombre
    `).all(shift.id);

    const ahora = Date.now();
    const duracionMs = (shift.cerrado_en || ahora) - shift.abierto_en;

    return {
      turno: shift,
      por_metodo: porMetodo,
      depositos,
      retiros,
      total_ventas: totalVentas,
      efectivo_esperado: efectivoEsperado,
      usd_esperado: usdEsperado,
      movimientos_caja: movimientosCaja,
      operaciones: {
        ventas_total: ventasStats.total,
        ventas_cobradas: ventasStats.cobradas,
        monto_cobrado: ventasStats.monto_cobrado,
        ticket_promedio: ticketPromedio,
        primera_venta: ventasStats.primera,
        ultima_venta: ventasStats.ultima,
        duracion_ms: duracionMs
      },
      cortesias: {
        cantidad: cortesias.cantidad || 0,
        valor_comercial: cortesias.valor_comercial || 0
      },
      brazaletes_por_tipo: brazaletesPorTipo
    };
  }

  function obtenerCorteDeTurno(turnoId) {
    const shift = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(turnoId);
    if (!shift) throw domainError(404, `Turno #${turnoId} no encontrado.`);
    return construirCorte(shift);
  }

  const cerrarTurnoTransaction = db.transaction(({ operador, efectivo_contado }) => {
    const shift = requireOpenShift();
    const operator = String(operador || '').trim();
    if (!operator) throw domainError(400, 'Selecciona un operador.');
    const contado = Number(efectivo_contado);
    if (!Number.isFinite(contado) || contado < 0) {
      throw domainError(400, 'Captura el efectivo contado.');
    }

    const timestamp = Date.now();
    const huerfanos = db.prepare(`
      SELECT folio, color FROM caja_brazaletes WHERE turno_id = ? AND estado = 'adentro'
    `).all(shift.id);
    for (const wristband of huerfanos) {
      db.prepare(`
        UPDATE caja_brazaletes
        SET estado = 'cancelado', cancelado_en = ?, cancelado_motivo = 'cierre_turno'
        WHERE folio = ?
      `).run(timestamp, wristband.folio);
    }
    if (huerfanos.length > 0) {
      insertMovement({
        turno_id: shift.id,
        operador: operator,
        tipo: 'cierre_turno_brazaletes',
        concepto: `${huerfanos.length} brazalete(s) vencido(s) por cierre de turno #${shift.id}`,
        timestamp
      });
    }

    const { depositos, retiros, porMetodo } = calcularTotalesTurno(shift.id);
    const efectivoVentas = porMetodo.efectivo?.mxn || 0;
    const efectivoEsperado = shift.fondo_inicial + efectivoVentas + depositos - retiros;
    const diferencia = Math.round(contado - efectivoEsperado);

    db.prepare(`
      UPDATE caja_turnos
      SET estado = 'cerrado', cerrado_en = ?, operador_cierre = ?,
          efectivo_esperado = ?, efectivo_contado = ?, diferencia = ?
      WHERE id = ?
    `).run(timestamp, operator, efectivoEsperado, Math.round(contado), diferencia, shift.id);

    insertMovement({
      turno_id: shift.id,
      operador: operator,
      tipo: 'cierre_turno',
      concepto: `Cierre de turno #${shift.id} · diferencia ${diferencia >= 0 ? '+' : ''}${diferencia}`,
      timestamp
    });

    return db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(shift.id);
  });

  const AFORO_MAX = 50;
  const STOCK_BAJO = 20;

  function obtenerDashboard() {
    const shift = getOpenShift();

    // Aforo global (todos los brazaletes 'adentro', independiente del turno).
    const adentro = db.prepare(`
      SELECT COUNT(*) c FROM caja_brazaletes WHERE estado = 'adentro'
    `).get().c;

    // Alertas de inventario bajo (todos los colores con disponible < STOCK_BAJO).
    const inventarioBajo = db.prepare(`
      SELECT c.color, c.stock_total,
        c.stock_total - (SELECT COUNT(*) FROM caja_brazaletes b WHERE b.color = c.color) AS disponible
      FROM caja_inventario_color c
      ORDER BY disponible ASC
    `).all()
      .map((r) => ({ ...r, disponible: Math.max(0, r.disponible) }))
      .filter((r) => r.disponible < STOCK_BAJO);

    if (!shift) {
      return {
        turno_abierto: false,
        entradas: 0,
        cobrado: 0,
        adentro,
        aforo: { adentro, max: AFORO_MAX },
        inventario_bajo: inventarioBajo
      };
    }

    const entradas = db.prepare(`
      SELECT COUNT(*) c FROM caja_brazaletes WHERE turno_id = ?
    `).get(shift.id).c;

    const ventasStats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN es_cortesia = 0 THEN 1 ELSE 0 END), 0) AS cobradas,
        COALESCE(SUM(CASE WHEN es_cortesia = 0 THEN total ELSE 0 END), 0) AS cobrado,
        MAX(creada_en) AS ultima
      FROM caja_ventas WHERE turno_id = ?
    `).get(shift.id);
    const ticketPromedio = ventasStats.cobradas > 0
      ? Math.round(ventasStats.cobrado / ventasStats.cobradas) : 0;

    const cortesias = db.prepare(`
      SELECT COUNT(*) AS cantidad,
        COALESCE(SUM((
          SELECT COALESCE(SUM(t.precio), 0)
          FROM caja_brazaletes b JOIN tickets t ON t.id = b.ticket_id
          WHERE b.venta_id = v.id
        )), 0) AS valor_comercial
      FROM caja_ventas v WHERE v.turno_id = ? AND v.es_cortesia = 1
    `).get(shift.id);

    // Mix de pagos del turno: ya disponible vía calcularTotalesTurno.
    const { porMetodo } = calcularTotalesTurno(shift.id);
    const mixTotal = Object.values(porMetodo).reduce((s, m) => s + m.mxn, 0);

    return {
      turno_abierto: true,
      turno_id: shift.id,
      operador: shift.operador_apertura,
      tipo_cambio_usd: shift.tipo_cambio_usd,
      abierto_en: shift.abierto_en,
      aforo: { adentro, max: AFORO_MAX },
      entradas,
      adentro,
      cobrado: ventasStats.cobrado,
      usd_acumulado: porMetodo.dolar?.usd || 0,
      ticket_promedio: ticketPromedio,
      ventas_cobradas: ventasStats.cobradas,
      cortesias: {
        cantidad: cortesias.cantidad || 0,
        valor_comercial: cortesias.valor_comercial || 0
      },
      mix_pagos: porMetodo,
      mix_total: mixTotal,
      ultima_venta_ts: ventasStats.ultima,
      inventario_bajo: inventarioBajo
    };
  }

  function obtenerHistorialTurno(turnoId, limite = 200) {
    return db.prepare(`
      SELECT * FROM caja_movimientos WHERE turno_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(turnoId, limite);
  }

  function listarTurnosCerrados(limite = 30) {
    const turnos = db.prepare(`
      SELECT * FROM caja_turnos WHERE estado = 'cerrado' ORDER BY id DESC LIMIT ?
    `).all(limite);
    return turnos.map((turno) => ({
      ...turno,
      totales: calcularTotalesTurno(turno.id)
    }));
  }

  return {
    login,
    cambiarPin,
    listarUsuarios,
    crearUsuario,
    editarUsuario,
    desactivarUsuario,
    activarUsuario,
    eliminarUsuario,
    listarTickets,
    obtenerInventarioColores,
    recargarStock,
    obtenerTurnoAbierto: getOpenShift,
    abrirTurno: (payload) => abrirTurnoTransaction(payload),
    cerrarTurno: (payload) => cerrarTurnoTransaction(payload),
    crearVenta: (payload) => crearVentaTransaction(payload),
    registrarMovimientoCaja,
    obtenerCorte,
    obtenerCorteDeTurno,
    obtenerDashboard,
    obtenerHistorialTurno: (turnoId, limite) => obtenerHistorialTurno(turnoId ?? getOpenShift()?.id, limite),
    listarTurnosCerrados
  };
}

module.exports = { createCajaRepository, ensureCajaSchema };
