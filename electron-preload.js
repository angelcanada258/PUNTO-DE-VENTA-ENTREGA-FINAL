/**
 * electron-preload.js
 * Expone al frontend SOLO lo necesario (contextBridge).
 * window.electronPrint() → IPC → main → webContents.print()
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Imprime silenciosamente a la impresora predeterminada.
   * Devuelve Promise<{ ok: boolean, error: string|null }>
   */
  silentPrint: () => ipcRenderer.invoke('silent-print'),

  /**
   * Cierra la aplicación. El frontend DEBE validar el PIN de administrador
   * antes de llamar esto (botón "Salir" del modo kiosko).
   * Devuelve Promise<{ ok: boolean }>
   */
  quitApp: () => ipcRenderer.invoke('quit-app'),

  /** True cuando el frontend corre dentro de Electron */
  isElectron: true,
});
