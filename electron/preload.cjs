const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pixelEditorDesktop', {
  saveFile(request) {
    return ipcRenderer.invoke('pixel-editor:save-file', request);
  },
  saveProjectFile(request) {
    return ipcRenderer.invoke('pixel-editor:save-project', request);
  },
  registerSelectedProject(file) {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) throw new Error('Не удалось получить путь выбранного файла проекта.');
    return ipcRenderer.invoke('pixel-editor:register-selected-project', filePath);
  },
  setCurrentProject(handle) {
    return ipcRenderer.invoke('pixel-editor:set-current-project', handle);
  },
  listRecentProjects() {
    return ipcRenderer.invoke('pixel-editor:list-recent-projects');
  },
  openRecentProject(id) {
    return ipcRenderer.invoke('pixel-editor:open-recent-project', id);
  },
  getLatestProjectBackup(handle) {
    return ipcRenderer.invoke('pixel-editor:latest-project-backup', handle);
  },
  takePendingProject() {
    return ipcRenderer.invoke('pixel-editor:take-pending-project');
  },
  onOpenProject(callback) {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on('pixel-editor:open-project', listener);
    return () => ipcRenderer.removeListener('pixel-editor:open-project', listener);
  },
  beginBatchExport() {
    return ipcRenderer.invoke('pixel-editor:begin-batch-export');
  },
  writeBatchExport(sessionId, fileName, data) {
    return ipcRenderer.invoke('pixel-editor:write-batch-export', sessionId, fileName, data);
  },
  endBatchExport(sessionId) {
    return ipcRenderer.invoke('pixel-editor:end-batch-export', sessionId);
  },
  closeWindowAfterSave() {
    return ipcRenderer.invoke('pixel-editor:close-after-save');
  },
  updateWindowState(state) {
    ipcRenderer.send('pixel-editor:window-state', state);
  },
  onMenuCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('pixel-editor:menu-command', listener);
    return () => ipcRenderer.removeListener('pixel-editor:menu-command', listener);
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
