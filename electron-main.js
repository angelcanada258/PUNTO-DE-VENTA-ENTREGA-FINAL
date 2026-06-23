/**
 * electron-main.js
 * Punto de entrada de Electron para Kaan Luum POS.
 * Levanta el servidor Express localmente y abre la ventana en modo kiosko.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Puerto del servidor Express ──────────────────────────────────────────────
const PORT = 3000;

// ── Variables globales ───────────────────────────────────────────────────────
let mainWindow = null;
let serverStarted = false;

// ── 0. Una sola instancia ────────────────────────────────────────────────────
// Evita que se abran dos copias del POS (p. ej. acceso directo + arranque
// automático), lo que provocaría "puerto en uso" y posibles datos duplicados.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Resolver carpeta de datos junto al .exe ──────────────────────────────────
// En la app instalada queda visible: <directorio del exe>/datos/. En desarrollo
// (npm run electron) se usa <proyecto>/datos-dev/ para no contaminar repo.
function resolveDataDir() {
  if (app.isPackaged) return path.join(path.dirname(process.execPath), 'datos');
  return path.join(__dirname, 'datos-dev');
}

// Si existe la BD en la ubicación vieja (%APPDATA%/Kaan Luum POS/) y la nueva
// aún está vacía, la migramos para no perder los datos del cliente.
function migrarDesdeAppData(nuevoDir) {
  try {
    const viejoDir = app.getPath('userData');
    const viejoDb = path.join(viejoDir, 'kaan_luum.db');
    const nuevoDb = path.join(nuevoDir, 'kaan_luum.db');
    if (viejoDir === nuevoDir) return;
    if (!fs.existsSync(viejoDb) || fs.existsSync(nuevoDb)) return;
    for (const sufijo of ['', '-wal', '-shm']) {
      const o = viejoDb + sufijo;
      if (fs.existsSync(o)) fs.copyFileSync(o, nuevoDb + sufijo);
    }
    console.log(`[Kaan Luum] BD migrada de ${viejoDir} a ${nuevoDir}`);
  } catch (err) {
    console.error('[Kaan Luum] No se pudo migrar la BD desde %APPDATA%:', err);
  }
}

// Crea todas las subcarpetas necesarias al arrancar el .exe.
function prepararCarpetas(dataDir) {
  const subdirs = [
    dataDir,
    path.join(dataDir, 'backups'),
    path.join(dataDir, 'reportes'),
    path.join(dataDir, 'reportes', 'cortes'),
    path.join(dataDir, 'reportes', 'diarios')
  ];
  for (const d of subdirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ── 1. Arrancar Express en proceso principal ─────────────────────────────────
function startServer() {
  if (serverStarted) return;
  serverStarted = true;

  const dataDir = resolveDataDir();
  try {
    prepararCarpetas(dataDir);
    migrarDesdeAppData(dataDir);
  } catch (err) {
    console.error('[Kaan Luum] Error preparando carpeta de datos:', err);
  }

  process.env.ELECTRON_APP_DATA = dataDir;     // mantenido por compatibilidad
  process.env.KAAN_DATA_DIR = dataDir;          // ruta canónica para respaldos/reportes
  process.env.PORT = String(PORT);
  process.env.POS_HOST = '127.0.0.1'; // solo esta PC, nunca expuesto a la red

  try {
    const expressApp = require('./server.js');
    expressApp.listen(PORT, '127.0.0.1', () => {
      console.log(`[Kaan Luum] Servidor Express en puerto ${PORT}`);
      console.log(`[Kaan Luum] Carpeta de datos: ${dataDir}`);
    });
  } catch (err) {
    console.error('[Kaan Luum] Error al iniciar servidor:', err);
  }
}

// ── 2. Arranque automático al encender Windows ───────────────────────────────
// Per-usuario, sin permisos de administrador. El POS quedará listo solo al
// iniciar sesión en Windows.
function configurarArranqueAutomatico() {
  try {
    if (process.platform !== 'win32') return;
    if (!app.isPackaged) return; // solo en la app instalada, no en desarrollo
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: []
    });
  } catch (err) {
    console.error('[Kaan Luum] No se pudo configurar el arranque automático:', err);
  }
}

// ── 3. Crear la ventana principal ────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,            // Pantalla completa real — sin barra de título/dirección
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Esperar a que Express esté listo (reintenta hasta ~10 s)
  let attempts = 0;
  const load = () => {
    const http = require('http');
    const req = http.get(`http://localhost:${PORT}/`, (res) => {
      if (res.statusCode < 500) {
        mainWindow.loadURL(`http://localhost:${PORT}/`);
      } else {
        retry();
      }
    });
    req.on('error', retry);
  };
  const retry = () => {
    attempts++;
    if (attempts < 20) setTimeout(load, 500);
  };
  load();

  // Deshabilitar atajos que podrían romper el kiosko
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const blocked = (input.alt && input.key === 'F4') ||
                    (input.control && input.key === 'w') ||
                    (input.control && input.key === 'r') ||
                    (input.key === 'F5') ||
                    (input.key === 'F11');
    if (blocked) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── 4. IPC: impresión silenciosa ─────────────────────────────────────────────
ipcMain.handle('silent-print', async () => {
  if (!mainWindow) return { ok: false, error: 'Sin ventana' };
  return new Promise((resolve) => {
    mainWindow.webContents.print(
      {
        silent: true,           // Sin diálogo de impresión
        printBackground: true,  // Imprime fondos CSS (colores de ticket)
        deviceName: ''          // Impresora predeterminada del sistema
      },
      (success, errorType) => {
        resolve({ ok: success, error: errorType || null });
      }
    );
  });
});

// ── 5. IPC: salir de la aplicación (botón "Salir" protegido con PIN admin) ────
// El frontend valida el PIN de administrador ANTES de invocar esto.
ipcMain.handle('quit-app', async () => {
  app.quit();
  return { ok: true };
});

// ── 6. Ciclo de vida de la app ───────────────────────────────────────────────
app.whenReady().then(() => {
  configurarArranqueAutomatico();
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
