// Selección de repositorio según el entorno.
// - Local / Electron: SQLite (better-sqlite3) con la API completa (.caja, .pos…)
// - Vercel con DATABASE_URL: Postgres (Neon) — schema legacy "registros"
// - Vercel sin DATABASE_URL: stub que devuelve 503 con mensaje claro,
//   suficiente para que el deploy no truene y la UI cargue.
// No importamos better-sqlite3 en Vercel para no fallar el build serverless.

let repository;

function stubCaja() {
  const noDb = () => {
    const error = new Error(
      'Base de datos no configurada en este entorno (Vercel sin Neon). ' +
      'El POS completo requiere SQLite local (Electron) o Postgres con todo ' +
      'el schema caja_* portado.'
    );
    error.status = 503;
    throw error;
  };
  return new Proxy({}, { get: () => noDb });
}

if (process.env.DATABASE_URL) {
  const { createPostgresDatabase } = require('./database-postgres');
  const pg = createPostgresDatabase(process.env.DATABASE_URL);
  repository = { ...pg, caja: stubCaja(), pos: stubCaja() };
} else if (process.env.VERCEL) {
  repository = { caja: stubCaja(), pos: stubCaja() };
} else {
  const sqlite = require('./database');
  repository = sqlite.getDefaultRepository();
}

module.exports = repository;
