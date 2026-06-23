const path = require('node:path');
const express = require('express');
const cors = require('cors');
const repository = require('./repository');
const { createCajaRouter } = require('./routes/caja-routes');
const { createRespaldos } = require('./services/respaldos');

function createApp(dataRepository = repository) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Respaldos automáticos y reportes imprimibles. Activos solo si Electron
  // (electron-main.js) define KAAN_DATA_DIR — en `npm start` queda en no-op.
  const respaldos = createRespaldos({
    dataDir: process.env.KAAN_DATA_DIR,
    repository: dataRepository.caja
  });

  app.use('/api/caja', createCajaRouter(dataRepository.caja, { respaldos }));

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint no encontrado.' });
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    const status =
      error.status ||
      (error instanceof SyntaxError && 'body' in error ? 400 : 500);
    const message =
      status === 500 ? 'Ocurrió un error interno en el servidor.' : error.message;
    if (status === 500) console.error(error);
    res.status(status).json({ success: false, error: message });
  });

  return app;
}

module.exports = { createApp };
