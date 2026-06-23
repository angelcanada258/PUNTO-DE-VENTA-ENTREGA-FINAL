const { neon } = require('@neondatabase/serverless');

function hydrate(row) {
  return {
    ...row,
    id: Number(row.id),
    timestamp: Number(row.timestamp),
    precio: Number(row.precio),
    total: Number(row.total),
    servicios: Array.isArray(row.servicios) ? row.servicios : []
  };
}

function calculateInside(registros) {
  const abiertos = new Map();

  for (const registro of registros) {
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

function createPostgresDatabase(connectionString) {
  const sql = neon(connectionString);
  let schemaPromise;

  function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = sql`
        CREATE TABLE IF NOT EXISTS registros (
          id BIGSERIAL PRIMARY KEY,
          folio TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK(tipo IN ('adulto', 'niño', 'local')),
          evento TEXT NOT NULL CHECK(evento IN ('entrada', 'salida')),
          timestamp BIGINT NOT NULL,
          fecha TEXT NOT NULL,
          tarifa TEXT NOT NULL DEFAULT '',
          precio INTEGER NOT NULL DEFAULT 0,
          servicios JSONB NOT NULL DEFAULT '[]'::jsonb,
          total INTEGER NOT NULL DEFAULT 0
        )
      `.then(async () => {
        await sql`CREATE INDEX IF NOT EXISTS idx_fecha ON registros(fecha)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_folio ON registros(folio)`;
      });
    }
    return schemaPromise;
  }

  async function insertarRegistro(registro) {
    await ensureSchema();
    const rows = await sql`
      INSERT INTO registros
        (folio, tipo, evento, timestamp, fecha, tarifa, precio, servicios, total)
      VALUES
        (
          ${registro.folio},
          ${registro.tipo},
          ${registro.evento},
          ${registro.timestamp ?? Date.now()},
          ${registro.fecha},
          ${registro.tarifa || ''},
          ${Number(registro.precio) || 0},
          ${JSON.stringify(registro.servicios || [])}::jsonb,
          ${Number(registro.total) || 0}
        )
      RETURNING *
    `;
    return hydrate(rows[0]);
  }

  async function obtenerRegistrosPorFecha(fecha) {
    await ensureSchema();
    const rows = await sql`
      SELECT id, folio, tipo, evento, timestamp, fecha, tarifa, precio, servicios, total
      FROM registros
      WHERE fecha = ${fecha}
      ORDER BY timestamp ASC, id ASC
    `;
    return rows.map(hydrate);
  }

  async function obtenerAdentroAhora(fecha) {
    return calculateInside(await obtenerRegistrosPorFecha(fecha));
  }

  async function obtenerResumenDia(fecha) {
    const registros = await obtenerRegistrosPorFecha(fecha);
    const entradas = registros.filter((registro) => registro.evento === 'entrada');
    const salidas = registros.filter((registro) => registro.evento === 'salida');
    const tipos = { adulto: 0, niño: 0, local: 0 };

    for (const registro of entradas) tipos[registro.tipo] += 1;

    return {
      adentro: calculateInside(registros),
      entradas,
      salidas,
      tipos,
      ultimos: registros.slice(-6).reverse(),
      ingresos: entradas.reduce((sum, registro) => sum + registro.total, 0)
    };
  }

  return {
    insertarRegistro,
    obtenerRegistrosPorFecha,
    obtenerAdentroAhora,
    obtenerResumenDia
  };
}

module.exports = { createPostgresDatabase };
