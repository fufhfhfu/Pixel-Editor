const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { createFeedbackNotesStore } = require('./feedbackNotes.cjs');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const MAX_SAVE_BYTES = 128 * 1024 * 1024;
const FILE_TYPES = {
  'application/json': { label: 'JSON project', extensions: ['json'] },
  'image/png': { label: 'PNG image', extensions: ['png'] },
  'image/jpeg': { label: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  'image/webp': { label: 'WebP image', extensions: ['webp'] },
};

let mainWindow;
let feedbackNotesStore;

function assertMainWindowSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Запрос заметок поступил из неизвестного окна.');
  }
}

function isAllowedPage(url) {
  if (app.isPackaged) return url === pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  try {
    return new URL(url).origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800,
          height: 700,
          minWidth: 320,
          minHeight: 240,
          backgroundColor: '#30323a',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (url !== 'about:blank') event.preventDefault();
    });
    childWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedPage(url)) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    void mainWindow.loadURL(DEV_SERVER_URL);
    if (process.env.PIXEL_EDITOR_DEVTOOLS === '1') void mainWindow.webContents.openDevTools();
  }
}

function validateSaveRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Некорректный запрос сохранения.');
  }

  const { suggestedName, mimeType, data } = request;
  const fileType = FILE_TYPES[mimeType];
  if (
    typeof suggestedName !== 'string' ||
    suggestedName.length === 0 ||
    suggestedName.length > 160 ||
    path.basename(suggestedName) !== suggestedName ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(suggestedName) ||
    suggestedName === '.' ||
    suggestedName === '..'
  ) {
    throw new TypeError('Некорректное имя файла.');
  }
  if (!fileType) throw new TypeError('Этот формат файла не поддерживается.');

  const extension = path.extname(suggestedName).slice(1).toLowerCase();
  if (!fileType.extensions.includes(extension)) throw new TypeError('Расширение файла не соответствует его формату.');
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_SAVE_BYTES) {
    throw new RangeError('Размер файла недопустим.');
  }

  return { suggestedName, mimeType, data, fileType };
}

ipcMain.handle('pixel-editor:save-file', async (event, request) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Запрос сохранения поступил из неизвестного окна.');
  }

  const { suggestedName, data, fileType } = validateSaveRequest(request);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить работу',
    defaultPath: suggestedName,
    filters: [{ name: fileType.label, extensions: fileType.extensions }],
  });
  if (result.canceled || !result.filePath) return 'cancelled';

  await writeFile(result.filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  return 'saved';
});

ipcMain.handle('pixel-editor:feedback-notes:list', (event) => {
  assertMainWindowSender(event);
  return feedbackNotesStore.list();
});

ipcMain.handle('pixel-editor:feedback-notes:create', (event, draft) => {
  assertMainWindowSender(event);
  return feedbackNotesStore.create(draft);
});

ipcMain.handle('pixel-editor:feedback-notes:update', (event, number, draft) => {
  assertMainWindowSender(event);
  return feedbackNotesStore.update(number, draft);
});

app.whenReady().then(() => {
  feedbackNotesStore = createFeedbackNotesStore(app.getPath('userData'));
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
