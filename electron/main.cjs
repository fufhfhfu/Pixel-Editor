const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const MAX_SAVE_BYTES = 128 * 1024 * 1024;
const MAX_TITLE_LENGTH = 120;
const FILE_TYPES = {
  'application/json': { label: 'Pixel Editor project', extensions: ['pxproj', 'json'] },
  'image/png': { label: 'PNG image', extensions: ['png'] },
  'image/jpeg': { label: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  'image/webp': { label: 'WebP image', extensions: ['webp'] },
  'text/markdown': { label: 'Markdown notes', extensions: ['md', 'markdown'] },
  'text/plain': { label: 'Text notes', extensions: ['txt'] },
};

let mainWindow;
let windowStateSaveTimer;
let pendingOpenFile;
let recentProjects = [];
let rendererDirty = false;
let allowWindowClose = false;

const DEFAULT_WINDOW_STATE = { width: 1440, height: 920 };

async function loadWindowState() {
  try {
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (!Number.isInteger(state.width) || !Number.isInteger(state.height)) return DEFAULT_WINDOW_STATE;
    return {
      width: Math.max(900, Math.min(state.width, 3840)),
      height: Math.max(640, Math.min(state.height, 2160)),
      ...(Number.isInteger(state.x) ? { x: state.x } : {}),
      ...(Number.isInteger(state.y) ? { y: state.y } : {}),
      isMaximized: state.isMaximized === true,
    };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(async () => {
    const [width, height] = mainWindow.getSize();
    const [x, y] = mainWindow.getPosition();
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    try {
      await writeFile(statePath, JSON.stringify({ width, height, x, y, isMaximized: mainWindow.isMaximized() }));
    } catch (error) {
      console.error('Не удалось сохранить состояние окна:', error);
    }
  }, 150);
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pixel-editor:command', command);
}

async function confirmWindowClose() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Несохранённые изменения',
    message: 'В проекте есть несохранённые изменения.',
    detail: 'Сохранить изменения перед закрытием?',
    buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 0) sendCommand('save-and-close');
  else if (result.response === 1) {
    allowWindowClose = true;
    mainWindow.close();
  }
}

async function loadRecentProjects() {
  try {
    const file = path.join(app.getPath('userData'), 'recent-projects.json');
    const value = JSON.parse(await readFile(file, 'utf8'));
    recentProjects = Array.isArray(value) ? value.filter(isProjectPath).slice(0, 8) : [];
  } catch {
    recentProjects = [];
  }
}

function addRecentProject(filePath) {
  if (!isProjectPath(filePath)) return;
  recentProjects = [filePath, ...recentProjects.filter((item) => item !== filePath)].slice(0, 8);
  void writeFile(path.join(app.getPath('userData'), 'recent-projects.json'), JSON.stringify(recentProjects)).catch((error) => {
    console.error('Не удалось сохранить список последних проектов:', error);
  });
  buildApplicationMenu();
}

function isProjectPath(value) {
  return typeof value === 'string' && /\.(?:pxproj|json)$/iu.test(value);
}

async function sendOpenFile(filePath) {
  if (!mainWindow || mainWindow.isDestroyed() || !isProjectPath(filePath)) return;
  try {
    let data;
    let backupData;
    try {
      data = await readFile(filePath);
      backupData = await readFile(`${filePath}.bak`).catch(() => undefined);
    } catch (primaryError) {
      data = await readFile(`${filePath}.bak`);
      console.warn('Основной проект недоступен, передана резервная копия:', primaryError);
    }
    mainWindow.webContents.send('pixel-editor:open-file', {
      name: path.basename(filePath),
      data: new Uint8Array(data),
      ...(backupData ? { backupData: new Uint8Array(backupData) } : {}),
    });
    addRecentProject(filePath);
  } catch (error) {
    reportWindowFailure('Не удалось открыть проект', error instanceof Error ? error.message : String(error));
  }
}

function buildApplicationMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open') },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save') },
        {
          label: 'Последние проекты',
          submenu: recentProjects.length
            ? recentProjects.map((filePath) => ({ label: path.basename(filePath), click: () => void sendOpenFile(filePath) }))
            : [{ label: 'Нет открытых проектов', enabled: false }],
        },
        { type: 'separator' },
        { role: 'close', label: 'Закрыть окно' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendCommand('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+=', click: () => sendCommand('zoom-in') },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', click: () => sendCommand('zoom-out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
    {
      label: 'Холст',
      submenu: [
        { label: 'Вписать холст', accelerator: 'F', click: () => sendCommand('fit') },
        { label: 'Переключить сетку', accelerator: 'G', click: () => sendCommand('grid') },
        { label: 'Показать/скрыть панели', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendCommand('toggle-panels') },
        { label: 'Добавить холст', click: () => sendCommand('add-board') },
      ],
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Масштабировать окно' },
        { role: 'close', label: 'Закрыть' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Горячие клавиши', accelerator: 'F1', click: () => sendCommand('help') },
        { label: 'Заметки проекта', click: () => sendCommand('notes') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function reportWindowFailure(title, detail) {
  console.error(`${title}: ${detail}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    dialog.showErrorBox(title, detail);
  } else if (app.isReady()) {
    dialog.showErrorBox(title, detail);
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

async function createWindow() {
  const windowState = await loadWindowState();
  const { isMaximized, ...windowBounds } = windowState;
  mainWindow = new BrowserWindow({
    ...windowBounds,
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
      devTools: !app.isPackaged,
    },
  });

  if (app.isPackaged) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          ],
        },
      });
    });
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) void shell.openExternal(parsed.href);
    } catch {
      // Некорректные URL не открываются.
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedPage(url)) event.preventDefault();
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    reportWindowFailure(
      'Не удалось открыть Pixel Editor',
      `${errorDescription} (${errorCode})\n\n${validatedURL}`,
    );
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    reportWindowFailure(
      'Окно Pixel Editor завершилось с ошибкой',
      `Причина: ${details.reason}. Приложение нужно перезапустить.`,
    );
  });
  mainWindow.webContents.on('unresponsive', () => {
    reportWindowFailure(
      'Pixel Editor не отвечает',
      'Операция заняла слишком много времени. Закройте это окно и запустите приложение снова.',
    );
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenFile) {
      const filePath = pendingOpenFile;
      pendingOpenFile = undefined;
      void sendOpenFile(filePath);
    }
  });
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!rendererDirty || allowWindowClose) return;
    event.preventDefault();
    void confirmWindowClose();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  if (isMaximized) mainWindow.maximize();

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch((error) => {
      reportWindowFailure('Не удалось запустить Pixel Editor', error instanceof Error ? error.message : String(error));
    });
  } else {
    mainWindow.loadURL(DEV_SERVER_URL).catch((error) => {
      reportWindowFailure('Не удалось подключиться к серверу разработки', error instanceof Error ? error.message : String(error));
    });
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
  await writeFile(`${result.filePath}.bak`, Buffer.from(data.buffer, data.byteOffset, data.byteLength)).catch((error) => {
    console.error('Не удалось создать резервную копию проекта:', error);
  });
  addRecentProject(result.filePath);
  return 'saved';
});

ipcMain.handle('pixel-editor:save-batch', async (event, requests) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !Array.isArray(requests) || requests.length === 0 || requests.length > 64) {
    throw new TypeError('Некорректный пакетный экспорт.');
  }
  for (const request of requests) {
    if (!request || typeof request.name !== 'string' || !/^[^<>:"/\\|?*\u0000-\u001f]+\.png$/iu.test(request.name) || !(request.data instanceof Uint8Array) || request.data.byteLength > MAX_SAVE_BYTES) {
      throw new TypeError('Некорректный файл пакетного экспорта.');
    }
  }
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите папку для экспорта', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return 'cancelled';
  for (const request of requests) await writeFile(path.join(result.filePaths[0], request.name), Buffer.from(request.data));
  return 'saved';
});

ipcMain.handle('pixel-editor:export-pdf', async (event, request) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !request || typeof request.title !== 'string' || typeof request.text !== 'string') {
    throw new TypeError('Некорректные данные PDF.');
  }
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Экспорт заметок в PDF', defaultPath: 'pixel-editor-notes.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (result.canceled || !result.filePath) return 'cancelled';
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:36px;color:#20232b}h1{font-size:22px}pre{white-space:pre-wrap;font:14px/1.55 Arial}</style></head><body><h1>${escapeHtml(request.title)}</h1><pre>${escapeHtml(request.text)}</pre></body></html>`;
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    await writeFile(result.filePath, pdf);
    return 'saved';
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
  }
});

ipcMain.handle('pixel-editor:set-title', (event, title) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof title !== 'string') {
    throw new TypeError('Некорректный заголовок окна.');
  }
  mainWindow.setTitle(title.slice(0, MAX_TITLE_LENGTH));
});

ipcMain.handle('pixel-editor:set-dirty', (event, dirty) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof dirty !== 'boolean') {
    throw new TypeError('Некорректное состояние проекта.');
  }
  rendererDirty = dirty;
});

ipcMain.handle('pixel-editor:close-approved', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Неизвестное окно.');
  allowWindowClose = true;
  mainWindow.close();
});

const initialFile = process.argv.find(isProjectPath);
if (initialFile) pendingOpenFile = initialFile;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = commandLine.find(isProjectPath);
    if (filePath) void sendOpenFile(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  void loadRecentProjects().then(() => buildApplicationMenu());
  buildApplicationMenu();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
