const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelEditorDesktop', {
  saveFile(request) {
    return ipcRenderer.invoke('pixel-editor:save-file', request);
  },
});
