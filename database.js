const path = require('node:path');
const Database = require('better-sqlite3');
const { createCajaRepository } = require('./services/caja-repository');

function parseServices(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    servicios: parseServices(row.servicios)
  };
}

function normalizarEstadoMvp(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  if (!state.inventory || typeof state.inventory !== 'object') return state;

  const inventory = Object.fromEntries(
    Object.entries(state.inventory).map(([id, item]) => [
      id,
      { ...item, occupied: 0 }
    ])
  );

  for (const wristband of state.brazaletes || []) {
    if (!['pendiente', 'adentro'].includes(wristband.estado)) continue;
    for (const extra of wristband.extras || []) {
      if (!extra.requiresInventory || !inventory[extra.resourceId]) continue;
      const quantity = Math.max(1, Number(extra.cantidad || extra.qty) || 1);
      inventory[extra.resourceId].occupied += quantity;
    }
  }

  return { ...state, inventory };
}

function createDatabase(filename = process.env.SQLITE_FILE || (() => {
  if (process.env.ELECTRON_APP_DATA) return require('node:path').join(process.env.ELECTRON_APP_DATA, 'kaan_luum.db');
  if (process.env.VERCEL) return require('node:path').join('/tmp', 'kaan_luum.db');
  return require('node:path').join(__dirname, 'kaan_luum.db');
})()) {
  const fs = require('node:fs');
  const dir = require('node:path').dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  // FULL = cada venta confirmada se escribe a disco de forma segura. Protege la
  // información incluso ante un corte de luz / apagón (negocio que opera a diario).
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('adulto', 'niño', 'local')),
      evento TEXT NOT NULL CHECK(evento IN ('entrada', 'salida')),
      timestamp INTEGER NOT NULL,
      fecha TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fecha ON registros(fecha);
    CREATE INDEX IF NOT EXISTS idx_folio ON registros(folio);
  `);

  const columns = new Set(
    db.prepare('PRAGMA table_info(registros)').all().map((column) => column.name)
  );
  const migrations = [
    ['tarifa', "ALTER TABLE registros ADD COLUMN tarifa TEXT NOT NULL DEFAULT ''"],
    ['precio', 'ALTER TABLE registros ADD COLUMN precio INTEGER NOT NULL DEFAULT 0'],
    ['servicios', "ALTER TABLE registros ADD COLUMN servicios TEXT NOT NULL DEFAULT '[]'"],
    ['total', 'ALTER TABLE registros ADD COLUMN total INTEGER NOT NULL DEFAULT 0']
  ];

  for (const [column, sql] of migrations) {
    if (!columns.has(column)) db.exec(sql);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mvp_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      data TEXT NOT NULL,
      actualizado_en INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operadores (
      nombre TEXT PRIMARY KEY,
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operador_apertura TEXT NOT NULL,
      deposito_inicial INTEGER NOT NULL DEFAULT 0,
      abierto_en INTEGER NOT NULL,
      cerrado_en INTEGER,
      estado TEXT NOT NULL CHECK(estado IN ('abierto', 'cerrado'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_unico_abierto
      ON turnos(estado) WHERE estado = 'abierto';

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo_visitante TEXT NOT NULL CHECK(tipo_visitante IN ('adulto', 'niño', 'local')),
      precio INTEGER NOT NULL,
      color_brazalete TEXT NOT NULL,
      prefijo TEXT NOT NULL DEFAULT 'KL',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER NOT NULL REFERENCES turnos(id),
      operador TEXT NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'cortesia')),
      subtotal INTEGER NOT NULL,
      total INTEGER NOT NULL,
      motivo_cortesia TEXT,
      estado TEXT NOT NULL DEFAULT 'confirmada',
      creada_en INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS venta_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      tipo TEXT NOT NULL DEFAULT 'ticket',
      referencia_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario INTEGER NOT NULL,
      total INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brazaletes (
      folio TEXT PRIMARY KEY,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      turno_id INTEGER NOT NULL REFERENCES turnos(id),
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      tipo_visitante TEXT NOT NULL,
      color TEXT NOT NULL,
      precio_entrada INTEGER NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'adentro', 'salido', 'cancelado')),
      asignacion_manual INTEGER NOT NULL DEFAULT 0,
      creado_en INTEGER NOT NULL,
      entrada_en INTEGER,
      salida_en INTEGER,
      operador_creacion TEXT NOT NULL,
      operador_entrada TEXT,
      operador_salida TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_brazaletes_estado ON brazaletes(estado);
    CREATE INDEX IF NOT EXISTS idx_brazaletes_venta ON brazaletes(venta_id);

    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER REFERENCES turnos(id),
      operador TEXT NOT NULL,
      tipo TEXT NOT NULL,
      folio TEXT,
      venta_id INTEGER,
      concepto TEXT NOT NULL,
      monto INTEGER NOT NULL DEFAULT 0,
      metodo_pago TEXT,
      cantidad INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS inventario (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL,
      modalidad TEXT NOT NULL CHECK(modalidad IN ('consumible', 'rentable')),
      stock_total INTEGER NOT NULL,
      stock_disponible INTEGER NOT NULL,
      stock_minimo INTEGER NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS servicios (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      precio INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('actividad', 'permiso', 'renta', 'producto')),
      inventario_id TEXT REFERENCES inventario(id),
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS folio_servicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT NOT NULL REFERENCES brazaletes(folio),
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      servicio_id TEXT NOT NULL REFERENCES servicios(id),
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario INTEGER NOT NULL,
      total INTEGER NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('activo', 'liberado')),
      asignado_en INTEGER NOT NULL,
      liberado_en INTEGER,
      operador TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_folio_servicios_folio
      ON folio_servicios(folio, estado);

    INSERT OR IGNORE INTO configuracion(clave, valor) VALUES ('folio_actual', '1');

    INSERT OR IGNORE INTO tickets
      (id, nombre, tipo_visitante, precio, color_brazalete, prefijo, activo)
    VALUES
      ('nacional', 'Nacional', 'adulto', 250, 'rosa', 'NCNL', 1),
      ('extranjero', 'Extranjero', 'adulto', 350, 'rojo', 'EXT', 1),
      ('agencia', 'Agencia', 'adulto', 200, 'azul', 'AGNC', 1),
      ('nino', 'Niño', 'niño', 150, 'amarillo', 'NÑ', 1),
      ('local', 'Local / Tulumense', 'local', 100, 'verde', 'LOCAL', 1),
      ('inapam', 'INAPAM', 'adulto', 150, 'naranja', 'INPM', 1),
      ('cortesia', 'Cortesía', 'adulto', 0, 'blanco', 'CRT', 1);

    UPDATE tickets SET prefijo = 'AGNC' WHERE id = 'agencia'  AND prefijo <> 'AGNC';
    UPDATE tickets SET prefijo = 'INPM' WHERE id = 'inapam'   AND prefijo <> 'INPM';
    UPDATE tickets SET prefijo = 'NÑ'   WHERE id = 'nino'     AND prefijo <> 'NÑ';
    UPDATE tickets SET prefijo = 'CRT'  WHERE id = 'cortesia' AND prefijo <> 'CRT';

    INSERT OR IGNORE INTO inventario
      (id, nombre, categoria, modalidad, stock_total, stock_disponible, stock_minimo, activo)
    VALUES
      ('kayak', 'Kayaks', 'renta', 'rentable', 10, 10, 2, 1),
      ('paddle', 'Paddle boards', 'renta', 'rentable', 10, 10, 2, 1),
      ('locker', 'Lockers', 'renta', 'rentable', 30, 30, 5, 1),
      ('chaleco', 'Chalecos', 'renta', 'rentable', 50, 50, 10, 1);

    INSERT OR IGNORE INTO servicios
      (id, nombre, precio, tipo, inventario_id, activo)
    VALUES
      ('dron', 'Dron', 250, 'permiso', NULL, 1),
      ('apnea', 'Apnea', 300, 'actividad', NULL, 1),
      ('buzo', 'Buzo', 350, 'actividad', NULL, 1),
      ('kayak', 'Kayak', 200, 'renta', 'kayak', 1),
      ('paddle', 'Paddle Board', 200, 'renta', 'paddle', 1),
      ('locker', 'Locker', 100, 'renta', 'locker', 1),
      ('chaleco', 'Chaleco', 50, 'renta', 'chaleco', 1),
      ('otro_producto', 'Otro producto', 0, 'producto', NULL, 1);
  `);

  const insertStatement = db.prepare(`
    INSERT INTO registros
      (folio, tipo, evento, timestamp, fecha, tarifa, precio, servicios, total)
    VALUES
      (@folio, @tipo, @evento, @timestamp, @fecha, @tarifa, @precio, @servicios, @total)
  `);
  const byDateStatement = db.prepare(`
    SELECT id, folio, tipo, evento, timestamp, fecha, tarifa, precio, servicios, total
    FROM registros
    WHERE fecha = ?
    ORDER BY timestamp ASC, id ASC
  `);

  function insertarRegistro(registro) {
    const info = insertStatement.run({
      folio: registro.folio,
      tipo: registro.tipo,
      evento: registro.evento,
      timestamp: registro.timestamp ?? Date.now(),
      fecha: registro.fecha,
      tarifa: registro.tarifa || '',
      precio: Number(registro.precio) || 0,
      servicios: JSON.stringify(registro.servicios || []),
      total: Number(registro.total) || 0
    });
    return hydrate(
      db.prepare('SELECT * FROM registros WHERE id = ?').get(info.lastInsertRowid)
    );
  }

  function obtenerRegistrosPorFecha(fecha) {
    return byDateStatement.all(fecha).map(hydrate);
  }

  function obtenerAdentroAhora(fecha) {
    const abiertos = new Map();

    for (const registro of obtenerRegistrosPorFecha(fecha)) {
      const cola = abiertos.get(registro.folio) || [];
      if (registro.evento === 'entrada') {
        cola.push(registro);
      } else if (cola.length) {
        cola.shift();
      }
      abiertos.set(registro.folio, cola);
    }

    return [...abiertos.entries()]
      .filter(([, cola]) => cola.length > 0)
      .map(([folio, cola]) => {
        const entrada = cola[cola.length - 1];
        return {
          folio,
          tipo: entrada.tipo,
          entrada_timestamp: entrada.timestamp,
          tarifa: entrada.tarifa,
          precio: entrada.precio,
          servicios: entrada.servicios,
          total: entrada.total
        };
      })
      .sort((a, b) => b.entrada_timestamp - a.entrada_timestamp);
  }

  function obtenerResumenDia(fecha) {
    const registros = obtenerRegistrosPorFecha(fecha);
    const entradas = registros.filter((registro) => registro.evento === 'entrada');
    const salidas = registros.filter((registro) => registro.evento === 'salida');
    const tipos = { adulto: 0, niño: 0, local: 0 };

    for (const registro of entradas) tipos[registro.tipo] += 1;

    return {
      adentro: obtenerAdentroAhora(fecha),
      entradas,
      salidas,
      tipos,
      ultimos: registros.slice(-6).reverse(),
      ingresos: entradas.reduce((sum, registro) => sum + registro.total, 0)
    };
  }

  function obtenerEstadoMvp() {
    const row = db.prepare('SELECT data FROM mvp_state WHERE id = 1').get();
    if (!row) return null;
    const state = normalizarEstadoMvp(JSON.parse(row.data));
    const normalizedData = JSON.stringify(state);
    if (normalizedData !== row.data) {
      db.prepare(`
        UPDATE mvp_state SET data = ?, actualizado_en = ? WHERE id = 1
      `).run(normalizedData, Date.now());
    }
    return state;
  }

  const guardarEstadoMvpTransaction = db.transaction((state) => {
    const timestamp = Date.now();
    const normalizedState = normalizarEstadoMvp(state);
    db.prepare(`
      INSERT INTO mvp_state (id, data, actualizado_en)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        actualizado_en = excluded.actualizado_en
    `).run(JSON.stringify(normalizedState), timestamp);
    return { actualizado_en: timestamp };
  });

  function guardarEstadoMvp(state) {
    return guardarEstadoMvpTransaction(state);
  }

  const pos = createPosRepository(db);
  const caja = createCajaRepository(db);

  return {
    close: () => db.close(),
    insertarRegistro,
    obtenerRegistrosPorFecha,
    obtenerAdentroAhora,
    obtenerResumenDia,
    obtenerEstadoMvp,
    guardarEstadoMvp,
    pos,
    caja
  };
}

function createPosRepository(db) {
  const rowToTicket = (row) => row && ({ ...row, activo: Boolean(row.activo) });
  const rowToWristband = (row) => row && ({
    ...row,
    asignacion_manual: Boolean(row.asignacion_manual)
  });

  function ensureOperator(nombre) {
    const clean = String(nombre || '').trim();
    if (!clean) throw domainError(400, 'Selecciona un operador activo.');
    db.prepare(`
      INSERT INTO operadores(nombre, activo, creado_en)
      VALUES (?, 1, ?)
      ON CONFLICT(nombre) DO UPDATE SET activo = 1
    `).run(clean, Date.now());
    return clean;
  }

  function getOpenShift() {
    return db.prepare(`
      SELECT id, operador_apertura, deposito_inicial, abierto_en, cerrado_en, estado
      FROM turnos WHERE estado = 'abierto' LIMIT 1
    `).get() || null;
  }

  function requireOpenShift() {
    const shift = getOpenShift();
    if (!shift) throw domainError(409, 'No hay un turno de caja abierto.');
    return shift;
  }

  function insertMovement(data) {
    db.prepare(`
      INSERT INTO movimientos
        (turno_id, operador, tipo, folio, venta_id, concepto, monto,
         metodo_pago, cantidad, timestamp, metadata)
      VALUES
        (@turno_id, @operador, @tipo, @folio, @venta_id, @concepto, @monto,
         @metodo_pago, @cantidad, @timestamp, @metadata)
    `).run({
      turno_id: data.turno_id ?? null,
      operador: data.operador,
      tipo: data.tipo,
      folio: data.folio ?? null,
      venta_id: data.venta_id ?? null,
      concepto: data.concepto,
      monto: Number(data.monto) || 0,
      metodo_pago: data.metodo_pago ?? null,
      cantidad: Number(data.cantidad) || 1,
      timestamp: data.timestamp ?? Date.now(),
      metadata: JSON.stringify(data.metadata || {})
    });
  }

  function nextFolio(prefix = 'KL') {
    const key = `folio_actual_${prefix}`;
    const row = db.prepare(`SELECT valor FROM configuracion WHERE clave = ?`).get(key);
    const globalRow = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'folio_actual'`).pluck().get();
    let current;
    if (!row) {
      const init = Number(globalRow) || 1;
      current = init;
      db.prepare(`INSERT OR REPLACE INTO configuracion(clave, valor) VALUES (?, ?)`)
        .run(key, String(current + 1));
    } else {
      current = Number(row.valor) || 1;
      db.prepare(`UPDATE configuracion SET valor = ? WHERE clave = ?`).run(String(current + 1), key);
    }
    return `${prefix}-${String(current).padStart(3, '0')}`;
  }

  function listServices() {
    return db.prepare(`
      SELECT s.id, s.nombre, s.precio, s.tipo, s.inventario_id, s.activo,
             i.stock_total, i.stock_disponible
      FROM servicios s
      LEFT JOIN inventario i ON i.id = s.inventario_id
      WHERE s.activo = 1
      ORDER BY s.tipo, s.precio DESC, s.nombre
    `).all().map((row) => ({
      ...row,
      activo: Boolean(row.activo),
      disponible: row.inventario_id ? row.stock_disponible : null
    }));
  }

  function listInventory() {
    return db.prepare(`
      SELECT id, nombre, categoria, modalidad, stock_total,
             stock_disponible AS disponible, stock_minimo, activo
      FROM inventario
      ORDER BY categoria, nombre
    `).all().map((row) => ({ ...row, activo: Boolean(row.activo) }));
  }

  function getWristbandDetail(folio) {
    const wristband = rowToWristband(
      db.prepare('SELECT * FROM brazaletes WHERE folio = ?')
        .get(String(folio || '').trim().toUpperCase())
    );
    if (!wristband) return null;
    const extras = db.prepare(`
      SELECT id, folio, venta_id, servicio_id, nombre, tipo, cantidad,
             precio_unitario, total, estado, asignado_en, liberado_en, operador
      FROM folio_servicios
      WHERE folio = ?
      ORDER BY asignado_en, id
    `).all(wristband.folio);
    const salesTotal = db.prepare(`
      SELECT COALESCE(SUM(total), 0)
      FROM folio_servicios
      WHERE folio = ?
    `).pluck().get(wristband.folio);
    return {
      ...wristband,
      extras,
      total_acumulado: wristband.precio_entrada + (Number(salesTotal) || 0)
    };
  }

  function validateExtras(extras, visitorCount) {
    if (!extras) return [];
    if (!Array.isArray(extras)) throw domainError(400, 'Los extras deben enviarse como lista.');
    return extras.map((extra) => {
      const service = db.prepare(`
        SELECT * FROM servicios WHERE id = ? AND activo = 1
      `).get(extra.servicio_id);
      const quantity = Number(extra.cantidad);
      if (!service) {
        throw domainError(404, `El servicio ${extra.servicio_id} no existe o está inactivo.`);
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        throw domainError(400, 'La cantidad del extra debe estar entre 1 y 50.');
      }
      const visitorIndex = extra.visitante_indice === undefined
        ? (visitorCount === 1 ? 0 : null)
        : Number(extra.visitante_indice);
      if (!Number.isInteger(visitorIndex) || visitorIndex < 0 || visitorIndex >= visitorCount) {
        throw domainError(400, 'Asigna cada extra a un visitante de la venta.');
      }
      if (service.inventario_id) {
        const inventory = db.prepare(`
          SELECT * FROM inventario WHERE id = ? AND activo = 1
        `).get(service.inventario_id);
        if (!inventory || inventory.stock_disponible < quantity) {
          throw domainError(409, `No hay disponibilidad suficiente de ${service.nombre}.`);
        }
      }
      return { service, quantity, visitorIndex };
    });
  }

  function assignExtras({ extras, wristbands, saleId, operator, timestamp }) {
    for (const extra of extras) {
      const wristband = wristbands[extra.visitorIndex];
      db.prepare(`
        INSERT INTO venta_items
          (venta_id, tipo, referencia_id, nombre, cantidad, precio_unitario, total)
        VALUES (?, 'servicio', ?, ?, ?, ?, ?)
      `).run(
        saleId,
        extra.service.id,
        extra.service.nombre,
        extra.quantity,
        extra.service.precio,
        extra.service.precio * extra.quantity
      );
      db.prepare(`
        INSERT INTO folio_servicios
          (folio, venta_id, servicio_id, nombre, tipo, cantidad,
           precio_unitario, total, estado, asignado_en, operador)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?, ?)
      `).run(
        wristband.folio,
        saleId,
        extra.service.id,
        extra.service.nombre,
        extra.service.tipo,
        extra.quantity,
        extra.service.precio,
        extra.service.precio * extra.quantity,
        timestamp,
        operator
      );
      if (extra.service.inventario_id) {
        db.prepare(`
          UPDATE inventario
          SET stock_disponible = stock_disponible - ?
          WHERE id = ?
        `).run(extra.quantity, extra.service.inventario_id);
      }
      insertMovement({
        turno_id: wristband.turno_id,
        operador: operator,
        tipo: extra.service.tipo === 'renta' ? 'renta_asignada' : 'venta_extra',
        folio: wristband.folio,
        venta_id: saleId,
        concepto: extra.service.nombre,
        monto: extra.service.precio * extra.quantity,
        cantidad: extra.quantity,
        timestamp,
        metadata: {
          servicio_id: extra.service.id,
          inventario_id: extra.service.inventario_id
        }
      });
    }
  }

  const openShiftTransaction = db.transaction(({ operador, deposito_inicial }) => {
    if (getOpenShift()) throw domainError(409, 'Ya existe un turno de caja abierto.');
    const operator = ensureOperator(operador);
    const deposit = Number(deposito_inicial);
    if (!Number.isInteger(deposit) || deposit < 0) {
      throw domainError(400, 'El depósito inicial debe ser un entero mayor o igual a cero.');
    }
    const timestamp = Date.now();
    const result = db.prepare(`
      INSERT INTO turnos(operador_apertura, deposito_inicial, abierto_en, estado)
      VALUES (?, ?, ?, 'abierto')
    `).run(operator, deposit, timestamp);
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(result.lastInsertRowid);
    insertMovement({
      turno_id: turno.id,
      operador: operator,
      tipo: 'apertura_turno',
      concepto: 'Apertura de turno',
      monto: deposit,
      metodo_pago: 'efectivo',
      timestamp
    });
    return turno;
  });

  const createSaleTransaction = db.transaction((payload) => {
    const shift = requireOpenShift();
    const operator = ensureOperator(payload.operador);
    const method = String(payload.metodo_pago || '');
    if (!['efectivo', 'tarjeta', 'transferencia', 'cortesia'].includes(method)) {
      throw domainError(400, 'Selecciona un método de pago válido.');
    }
    if (method === 'cortesia' && !String(payload.motivo_cortesia || '').trim()) {
      throw domainError(400, 'La cortesía requiere un motivo.');
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw domainError(400, 'Agrega al menos un ticket a la venta.');
    }

    const expanded = [];
    let ticketTotal = 0;
    let visitorCount = 0;
    for (const item of payload.items) {
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND activo = 1')
        .get(item.ticket_id);
      const quantity = Number(item.cantidad);
      if (!ticket) throw domainError(404, `El ticket ${item.ticket_id} no existe o está inactivo.`);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        throw domainError(400, 'La cantidad de tickets debe estar entre 1 y 50.');
      }
      const manualFolios = Array.isArray(item.folios) ? item.folios : [];
      if (manualFolios.length && manualFolios.length !== quantity) {
        throw domainError(400, 'Debes asignar un folio manual por visitante.');
      }
      ticketTotal += ticket.precio * quantity;
      visitorCount += quantity;
      expanded.push({ ticket, quantity, manualFolios });
    }
    const validatedExtras = validateExtras(payload.extras || [], visitorCount);
    const extrasTotal = validatedExtras.reduce(
      (sum, extra) => sum + extra.service.precio * extra.quantity,
      0
    );
    const total = ticketTotal + extrasTotal;
    if (method === 'cortesia' && total !== 0) {
      throw domainError(400, 'El método cortesía solo puede usarse con tickets de monto cero.');
    }
    if (total === 0 && method !== 'cortesia') {
      throw domainError(400, 'No se puede registrar una venta de $0.');
    }

    const timestamp = Date.now();
    const saleResult = db.prepare(`
      INSERT INTO ventas
        (turno_id, operador, metodo_pago, subtotal, total, motivo_cortesia, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      shift.id,
      operator,
      method,
      total,
      total,
      payload.motivo_cortesia || null,
      timestamp
    );
    const saleId = Number(saleResult.lastInsertRowid);
    const wristbands = [];

    for (const group of expanded) {
      db.prepare(`
        INSERT INTO venta_items
          (venta_id, referencia_id, nombre, cantidad, precio_unitario, total)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        saleId,
        group.ticket.id,
        group.ticket.nombre,
        group.quantity,
        group.ticket.precio,
        group.ticket.precio * group.quantity
      );

      for (let index = 0; index < group.quantity; index += 1) {
        const manual = group.manualFolios.length > 0;
        const folio = manual
          ? String(group.manualFolios[index] || '').trim().toUpperCase()
          : nextFolio(group.ticket.prefijo || 'KL');
        if (!folio) throw domainError(400, 'El folio manual no puede estar vacío.');
        if (db.prepare('SELECT 1 FROM brazaletes WHERE folio = ?').get(folio)) {
          throw domainError(409, `El folio ${folio} ya fue vendido.`);
        }
        db.prepare(`
          INSERT INTO brazaletes
            (folio, venta_id, turno_id, ticket_id, tipo_visitante, color,
             precio_entrada, estado, asignacion_manual, creado_en, operador_creacion)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)
        `).run(
          folio,
          saleId,
          shift.id,
          group.ticket.id,
          group.ticket.tipo_visitante,
          group.ticket.color_brazalete,
          group.ticket.precio,
          manual ? 1 : 0,
          timestamp,
          operator
        );
        wristbands.push(rowToWristband(
          db.prepare('SELECT * FROM brazaletes WHERE folio = ?').get(folio)
        ));
      }
    }

    assignExtras({
      extras: validatedExtras,
      wristbands,
      saleId,
      operator,
      timestamp
    });

    insertMovement({
      turno_id: shift.id,
      operador: operator,
      tipo: method === 'cortesia' ? 'cortesia' : 'venta',
      venta_id: saleId,
      concepto: `Venta #${saleId}`,
      monto: total,
      metodo_pago: method,
      cantidad: wristbands.length,
      timestamp,
      metadata: { folios: wristbands.map((item) => item.folio) }
    });

    return {
      venta: db.prepare('SELECT * FROM ventas WHERE id = ?').get(saleId),
      brazaletes: wristbands
    };
  });

  const createAdditionalTransaction = db.transaction((payload) => {
    const shift = requireOpenShift();
    const operator = ensureOperator(payload.operador);
    const wristband = getWristbandDetail(payload.folio);
    if (!wristband) {
      throw domainError(404, `Folio ${String(payload.folio || '').toUpperCase()} no registrado.`);
    }
    if (!['pendiente', 'adentro'].includes(wristband.estado)) {
      throw domainError(409, 'No se pueden agregar adicionales a un folio cancelado o salido.');
    }
    const method = String(payload.metodo_pago || '');
    if (!['efectivo', 'tarjeta', 'transferencia', 'cortesia'].includes(method)) {
      throw domainError(400, 'Selecciona un método de pago válido.');
    }
    const extras = validateExtras(payload.items, 1);
    if (!extras.length) throw domainError(400, 'Selecciona al menos un adicional.');
    const total = extras.reduce(
      (sum, extra) => sum + extra.service.precio * extra.quantity,
      0
    );
    if (total === 0 && method !== 'cortesia') {
      throw domainError(400, 'No se puede registrar una operación de $0.');
    }
    const timestamp = Date.now();
    const result = db.prepare(`
      INSERT INTO ventas
        (turno_id, operador, metodo_pago, subtotal, total, motivo_cortesia, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      shift.id,
      operator,
      method,
      total,
      total,
      payload.motivo_cortesia || null,
      timestamp
    );
    const saleId = Number(result.lastInsertRowid);
    assignExtras({
      extras,
      wristbands: [wristband],
      saleId,
      operator,
      timestamp
    });
    insertMovement({
      turno_id: shift.id,
      operador: operator,
      tipo: 'servicio_adicional',
      folio: wristband.folio,
      venta_id: saleId,
      concepto: `Adicionales ${wristband.folio}`,
      monto: total,
      metodo_pago: method,
      cantidad: extras.reduce((sum, item) => sum + item.quantity, 0),
      timestamp
    });
    return {
      operacion: db.prepare('SELECT * FROM ventas WHERE id = ?').get(saleId),
      brazalete: getWristbandDetail(wristband.folio)
    };
  });

  const changeAccessTransaction = db.transaction(({ folio, operador, target }) => {
    const shift = requireOpenShift();
    const operator = ensureOperator(operador);
    const normalized = String(folio || '').trim().toUpperCase();
    if (!normalized) throw domainError(400, 'El folio es obligatorio.');
    const wristband = db.prepare('SELECT * FROM brazaletes WHERE folio = ?').get(normalized);
    if (!wristband) throw domainError(404, `Folio ${normalized} no registrado en Caja.`);

    const expected = target === 'adentro' ? 'pendiente' : 'adentro';
    if (wristband.estado !== expected) {
      const message = target === 'adentro'
        ? `El folio ${normalized} no está pendiente de entrada.`
        : `El folio ${normalized} no está actualmente adentro.`;
      throw domainError(409, message);
    }
    if (target === 'adentro') {
      const inside = db.prepare(
        `SELECT COUNT(*) FROM brazaletes WHERE estado = 'adentro'`
      ).pluck().get();
      if (inside >= 50) throw domainError(409, 'Aforo máximo alcanzado (50 personas).');
    }

    const timestamp = Date.now();
    if (target === 'adentro') {
      db.prepare(`
        UPDATE brazaletes
        SET estado = 'adentro', entrada_en = ?, operador_entrada = ?
        WHERE folio = ?
      `).run(timestamp, operator, normalized);
    } else {
      const activeRentals = db.prepare(`
        SELECT fs.id, fs.cantidad, s.inventario_id
        FROM folio_servicios fs
        JOIN servicios s ON s.id = fs.servicio_id
        WHERE fs.folio = ? AND fs.tipo = 'renta' AND fs.estado = 'activo'
      `).all(normalized);
      for (const rental of activeRentals) {
        db.prepare(`
          UPDATE folio_servicios
          SET estado = 'liberado', liberado_en = ?
          WHERE id = ?
        `).run(timestamp, rental.id);
        db.prepare(`
          UPDATE inventario
          SET stock_disponible = MIN(stock_total, stock_disponible + ?)
          WHERE id = ?
        `).run(rental.cantidad, rental.inventario_id);
        insertMovement({
          turno_id: shift.id,
          operador: operator,
          tipo: 'renta_liberada',
          folio: normalized,
          venta_id: wristband.venta_id,
          concepto: 'Liberación automática de renta',
          cantidad: rental.cantidad,
          timestamp,
          metadata: { inventario_id: rental.inventario_id }
        });
      }
      db.prepare(`
        UPDATE brazaletes
        SET estado = 'salido', salida_en = ?, operador_salida = ?
        WHERE folio = ?
      `).run(timestamp, operator, normalized);
    }
    insertMovement({
      turno_id: shift.id,
      operador: operator,
      tipo: target === 'adentro' ? 'entrada' : 'salida',
      folio: normalized,
      venta_id: wristband.venta_id,
      concepto: `${target === 'adentro' ? 'Entrada' : 'Salida'} ${normalized}`,
      timestamp
    });
    const updated = getWristbandDetail(normalized);
    return target === 'salido'
      ? {
          brazalete: updated,
          rentas_liberadas: db.prepare(`
            SELECT COUNT(*) FROM folio_servicios
            WHERE folio = ? AND tipo = 'renta' AND liberado_en = ?
          `).pluck().get(normalized, timestamp)
        }
      : updated;
  });

  return {
    listarTickets() {
      return db.prepare('SELECT * FROM tickets ORDER BY precio DESC, nombre ASC')
        .all().map(rowToTicket);
    },
    listarServicios: listServices,
    listarInventario: listInventory,
    obtenerTurnoAbierto: getOpenShift,
    abrirTurno: (payload) => openShiftTransaction(payload),
    crearVenta: (payload) => createSaleTransaction(payload),
    buscarBrazalete: getWristbandDetail,
    agregarAdicionales: (payload) => createAdditionalTransaction(payload),
    registrarEntrada: (payload) => changeAccessTransaction({ ...payload, target: 'adentro' }),
    registrarSalida: (payload) => changeAccessTransaction({ ...payload, target: 'salido' }),
    listarAdentro() {
      return db.prepare(`
        SELECT * FROM brazaletes WHERE estado = 'adentro' ORDER BY entrada_en DESC
      `).all().map(rowToWristband);
    },
    obtenerDashboard() {
      const wristbands = db.prepare('SELECT * FROM brazaletes').all();
      const inside = wristbands.filter((item) => item.estado === 'adentro');
      const entries = wristbands.filter((item) => item.entrada_en);
      const exits = wristbands.filter((item) => item.salida_en);
      const tipos = { adulto: 0, niño: 0, local: 0 };
      for (const item of entries) tipos[item.tipo_visitante] += 1;
      const income = db.prepare(`
        SELECT COALESCE(SUM(total), 0) FROM ventas WHERE estado = 'confirmada'
      `).pluck().get();
      const recent = db.prepare(`
        SELECT folio, tipo, timestamp
        FROM movimientos
        WHERE tipo IN ('entrada', 'salida')
        ORDER BY timestamp DESC, id DESC
        LIMIT 6
      `).all().map((item) => {
        const wristband = db.prepare(
          'SELECT tipo_visitante FROM brazaletes WHERE folio = ?'
        ).get(item.folio);
        return {
          folio: item.folio,
          tipo: wristband?.tipo_visitante || 'adulto',
          evento: item.tipo,
          timestamp: item.timestamp
        };
      });
      return {
        adentro: inside.length,
        entradas_hoy: entries.length,
        salidas_hoy: exits.length,
        aforo_max: 50,
        porcentaje_aforo: Math.round((inside.length / 50) * 100),
        tipos,
        ingresos_hoy: Number(income) || 0,
        ultimos: recent
      };
    }
  };
}

function domainError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

let defaultRepository;
function getDefaultRepository() {
  if (!defaultRepository) defaultRepository = createDatabase();
  return defaultRepository;
}

module.exports = {
  createDatabase,
  getDefaultRepository,
  insertarRegistro: (...args) => getDefaultRepository().insertarRegistro(...args),
  obtenerRegistrosPorFecha: (...args) =>
    getDefaultRepository().obtenerRegistrosPorFecha(...args),
  obtenerAdentroAhora: (...args) =>
    getDefaultRepository().obtenerAdentroAhora(...args),
  obtenerResumenDia: (...args) => getDefaultRepository().obtenerResumenDia(...args)
};
