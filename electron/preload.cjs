const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelEditorDesktop', {
  saveFile(request) {
    return ipcRenderer.invoke('pixel-editor:save-file', request);
  },
  saveBatch(requests) {
    return ipcRenderer.invoke('pixel-editor:save-batch', requests);
  },
  exportPdf(request) {
    return ipcRenderer.invoke('pixel-editor:export-pdf', request);
  },
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('pixel-editor:command', listener);
    return () => ipcRenderer.removeListener('pixel-editor:command', listener);
  },
  setTitle(title) {
    return ipcRenderer.invoke('pixel-editor:set-title', title);
  },
  setDirty(dirty) {
    return ipcRenderer.invoke('pixel-editor:set-dirty', dirty);
  },
  closeApproved() {
    return ipcRenderer.invoke('pixel-editor:close-approved');
  },
  onOpenFile(callback) {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on('pixel-editor:open-file', listener);
    return () => ipcRenderer.removeListener('pixel-editor:open-file', listener);
  },
});
