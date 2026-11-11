const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelEditorDesktop', {
  saveFile(request) {
    return ipcRenderer.invoke('pixel-editor:save-file', request);
  },
  listFeedbackNotes() {
    return ipcRenderer.invoke('pixel-editor:feedback-notes:list');
  },
  createFeedbackNote(draft) {
    return ipcRenderer.invoke('pixel-editor:feedback-notes:create', draft);
  },
  updateFeedbackNote(number, draft) {
    return ipcRenderer.invoke('pixel-editor:feedback-notes:update', number, draft);
  },
});
