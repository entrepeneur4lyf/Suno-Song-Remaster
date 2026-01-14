const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  saveFile: () => ipcRenderer.invoke('save-file'),
  processAudio: (options) => ipcRenderer.invoke('process-audio', options),
  analyzeAudio: (filePath) => ipcRenderer.invoke('analyze-audio', filePath),
  onProgress: (callback) => ipcRenderer.on('processing-progress', (event, progress) => callback(progress)),
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close')
});
