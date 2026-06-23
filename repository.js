// Selección de repositorio según el entorno.
// - Local / Electron: SQLite (better-sqlite3) con la API completa
// - Vercel: usa un repo "demo" en memoria para que la UI sea navegable
//   sin tronar (el .caja-routes espera muchos métodos que el viejo
//   adapter de Postgres no tiene). Esto es solo para presentar la UI.

let repository;

if (process.env.VERCEL) {
  const { createDemoRepository } = require('./services/demo-repository');
  repository = { caja: createDemoRepository(), pos: {} };
} else {
  const sqlite = require('./database');
  repository = sqlite.getDefaultRepository();
}

module.exports = repository;
