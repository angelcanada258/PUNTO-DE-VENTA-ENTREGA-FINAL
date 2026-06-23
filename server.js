const app = require('./index');
const port = Number(process.env.PORT) || 3000;

// Solo escuchamos en loopback (127.0.0.1). La interfaz se abre desde la misma
// PC vía Electron, así que NO exponemos el POS a otros equipos de la red WiFi
// (evita que cualquiera con la IP registre ventas o lea la caja).
const host = process.env.POS_HOST || '127.0.0.1';

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Kaan Luum disponible en http://localhost:${port}`);
  });
}

module.exports = app;
