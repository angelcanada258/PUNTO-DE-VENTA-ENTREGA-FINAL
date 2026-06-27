/**
 * electron-preload.js
 * Expone al frontend SOLO lo necesario (contextBridge).
 * window.electronPrint() → IPC → main → webContents.print()
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  silentPrint: () => ipcRenderer.invoke('silent-print'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onConfirmQuit: (callback) => ipcRenderer.on('confirm-quit', () => callback()),
  isElectron: true,
});
