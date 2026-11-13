const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } = require('electron');
const path = require('node:path');
const {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createFeedbackNotesStore } = require('./feedbackNotes.cjs');
const { isValidWindowState, restoreWindowState } = require('./windowState.cjs');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const MAX_SAVE_BYTES = 128 * 1024 * 1024;
const WINDOW_STATE_FILENAME = 'window-state.json';
const WINDOW_STATE_SAVE_DELAY_MS = 400;
const APP_TITLE = require('../package.json').productName;
const PROJECT_EXTENSIONS = ['.pxproj', '.json'];
const MAX_PROJECT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RECENT_PROJECTS = 10;
const RECENT_PROJECTS_FILENAME = 'recent-projects.json';
const PROJECT_BACKUP_DIRECTORY = '.pixel-editor-backups';
const PROJECT_BACKUP_RETENTION = 3;
const FILE_TYPES = {
  'application/json': { label: 'JSON project', extensions: ['json'] },
  'image/png': { label: 'PNG image', extensions: ['png'] },
  'image/jpeg': { label: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  'image/webp': { label: 'WebP image', extensions: ['webp'] },
};

let mainWindow;
let feedbackNotesStore;
let startupErrorShown = false;
let nativeMenu;
let windowStatePath;
let windowStateTimer;
let savedWindowState;
let pendingWindowStateSnapshot;
let quitAfterWindowStateSave = false;
let windowStateSaveInProgress = false;
let menuCanUndo = false;
let menuCanRedo = false;
let projectIsDirty = false;
let allowNextClose = false;
let closeDialogOpen = false;
let rendererReady = false;
let pendingProjectOpen;
let recentProjects = [];
let recentProjectsPath;
const projectHandles = new Map();
const projectExportSessions = new Map();
let startupProjectPath = findProjectPathArgument(process.argv);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

const NATIVE_MENU_COMMANDS = new Set([
  'open', 'save', 'save-as', 'export', 'batch-export', 'project-notes', 'recent-projects', 'save-before-close',
  'undo', 'redo', 'select-all', 'selection-action:copy', 'selection-action:cut', 'selection-action:paste',
  'toggle-grid', 'fit', 'center', 'zoom-in', 'zoom-out',
  'delete-board',
  'add-layer', 'duplicate-layer', 'delete-layer',
  'frame-previous', 'frame-next', 'frame-add', 'frame-duplicate', 'frame-remove', 'animation-play',
  'tool:pencil', 'tool:eraser', 'tool:fill', 'tool:picker', 'tool:line', 'tool:rect',
  'tool:filledRect', 'tool:circle', 'tool:filledCircle', 'tool:ellipse', 'tool:filledEllipse',
  'tool:triangle', 'tool:filledTriangle', 'tool:polygon', 'tool:filledPolygon', 'tool:gradient', 'tool:dither',
  'workspace-drawing', 'workspace-animation', 'workspace-tileset', 'workspace-minimal',
  'toggle-tools', 'toggle-palette', 'toggle-timeline', 'settings', 'help',
]);

function sendMenuCommand(command) {
  if (!NATIVE_MENU_COMMANDS.has(command)) {
    console.error(`Отклонена неизвестная команда нативного меню: ${String(command)}`);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pixel-editor:menu-command', command);
  }
}

function findProjectPathArgument(argumentsList) {
  return argumentsList.find((argument) =>
    typeof argument === 'string' &&
    !argument.startsWith('-') &&
    PROJECT_EXTENSIONS.includes(path.extname(argument).toLowerCase()),
  ) ?? null;
}

function assertProjectPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 32_000) {
    throw new TypeError('Некорректный путь к проекту.');
  }
  const resolvedPath = path.resolve(filePath);
  if (!PROJECT_EXTENSIONS.includes(path.extname(resolvedPath).toLowerCase())) {
    throw new TypeError('Поддерживаются только файлы проектов .pxproj и .json.');
  }
  return resolvedPath;
}

async function getProjectFileInfo(filePath) {
  const resolvedPath = assertProjectPath(filePath);
  const canonicalPath = await realpath(resolvedPath);
  const details = await stat(canonicalPath);
  if (!details.isFile()) throw new TypeError('Выбранный путь не является файлом.');
  if (details.size === 0 || details.size > MAX_PROJECT_FILE_BYTES) {
    throw new RangeError('Размер файла проекта недопустим.');
  }
  return { path: canonicalPath, fileName: path.basename(canonicalPath), size: details.size };
}

function createProjectHandle(filePath) {
  const handle = randomUUID();
  projectHandles.set(handle, filePath);
  return handle;
}

function getPublicRecentProjects() {
  return recentProjects.map(({ id, fileName }) => ({ id, fileName }));
}

async function persistRecentProjects() {
  const temporaryPath = `${recentProjectsPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(recentProjects));
    await rename(temporaryPath, recentProjectsPath);
  } catch (error) {
    console.error('Не удалось сохранить список недавних проектов.', error);
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Не удалось удалить временный список проектов.', cleanupError);
    }
  }
}

async function loadRecentProjects() {
  try {
    const stored = JSON.parse(await readFile(recentProjectsPath, 'utf8'));
    if (!Array.isArray(stored)) throw new TypeError('Список проектов должен быть массивом.');
    recentProjects = stored
      .filter((entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.fileName === 'string' &&
        typeof entry.path === 'string' &&
        PROJECT_EXTENSIONS.includes(path.extname(entry.path).toLowerCase()) &&
        path.basename(entry.path) === entry.fileName,
      )
      .slice(0, MAX_RECENT_PROJECTS);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    console.error('Не удалось прочитать список недавних проектов; он будет создан заново.', error);
    recentProjects = [];
  }
}

async function addRecentProject(filePath) {
  const info = await getProjectFileInfo(filePath);
  const normalizedPath = info.path.toLowerCase();
  recentProjects = [
    { id: randomUUID(), path: info.path, fileName: info.fileName },
    ...recentProjects.filter((entry) => entry.path.toLowerCase() !== normalizedPath),
  ].slice(0, MAX_RECENT_PROJECTS);
  await persistRecentProjects();
  return getPublicRecentProjects();
}

async function getProjectBackups(filePath) {
  const backupDirectory = path.join(path.dirname(filePath), PROJECT_BACKUP_DIRECTORY);
  const prefix = `${path.basename(filePath)}.`;
  let entries;
  try {
    entries = await readdir(backupDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.bak')) continue;
    const backupPath = path.join(backupDirectory, entry.name);
    const details = await stat(backupPath);
    if (details.size > 0 && details.size <= MAX_PROJECT_FILE_BYTES) {
      backups.push({ path: backupPath, modifiedAt: details.mtimeMs });
    }
  }
  return backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

async function backupExistingProject(filePath) {
  let existing;
  try {
    existing = await stat(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!existing.isFile() || existing.size === 0 || existing.size > MAX_PROJECT_FILE_BYTES) {
    throw new RangeError('Существующий файл проекта нельзя безопасно сохранить в резервную копию.');
  }

  const backupDirectory = path.join(path.dirname(filePath), PROJECT_BACKUP_DIRECTORY);
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(filePath)}.${Date.now()}-${randomUUID().slice(0, 8)}.bak`,
  );
  await copyFile(filePath, backupPath);

  const backups = await getProjectBackups(filePath);
  for (const backup of backups.slice(PROJECT_BACKUP_RETENTION)) {
    await unlink(backup.path);
  }
}

function queueProjectOpen(payload) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pixel-editor:open-project', payload);
  } else {
    pendingProjectOpen = payload;
  }
}

async function openProjectPath(filePath) {
  try {
    queueProjectOpen(await readProjectPayload(filePath));
  } catch (error) {
    console.error('Не удалось открыть проект из Windows.', error);
    dialog.showErrorBox('Не удалось открыть проект', error instanceof Error ? error.message : String(error));
  }
}

function nativeCommand(label, command) {
  return {
    label,
    click: () => sendMenuCommand(command),
  };
}

function updateNativeMenuState(state = {}) {
  if (typeof state.canUndo === 'boolean') menuCanUndo = state.canUndo;
  if (typeof state.canRedo === 'boolean') menuCanRedo = state.canRedo;
  const undoItem = nativeMenu?.getMenuItemById('edit-undo');
  const redoItem = nativeMenu?.getMenuItemById('edit-redo');
  if (undoItem) undoItem.enabled = menuCanUndo;
  if (redoItem) redoItem.enabled = menuCanRedo;
  const fullscreenItem = nativeMenu?.getMenuItemById('view-fullscreen');
  if (fullscreenItem) fullscreenItem.checked = Boolean(mainWindow?.isFullScreen());
}

function buildNativeMenu() {
  nativeMenu = Menu.buildFromTemplate([
    { label: 'Файл', submenu: [
      nativeCommand('Открыть…', 'open'),
      nativeCommand('Сохранить проект', 'save'),
      nativeCommand('Сохранить как…', 'save-as'),
      nativeCommand('Экспорт изображения', 'export'),
      nativeCommand('Пакетный экспорт холстов…', 'batch-export'),
      { type: 'separator' },
      nativeCommand('Недавние проекты…', 'recent-projects'),
      nativeCommand('Заметки проекта…', 'project-notes'),
    ] },
    { label: 'Правка', submenu: [
      { ...nativeCommand('Отменить', 'undo'), id: 'edit-undo', enabled: false },
      { ...nativeCommand('Повторить', 'redo'), id: 'edit-redo', enabled: false },
      { type: 'separator' },
      nativeCommand('Выбрать всё', 'select-all'),
      nativeCommand('Копировать', 'selection-action:copy'),
      nativeCommand('Вырезать', 'selection-action:cut'),
      nativeCommand('Вставить', 'selection-action:paste'),
    ] },
    { label: 'Вид', submenu: [
      nativeCommand('Показать или скрыть сетку', 'toggle-grid'),
      nativeCommand('Вписать холсты', 'fit'),
      nativeCommand('Центрировать холст', 'center'),
      { type: 'separator' },
      nativeCommand('Увеличить', 'zoom-in'),
      nativeCommand('Уменьшить', 'zoom-out'),
      { type: 'separator' },
      {
        id: 'view-fullscreen',
        label: 'Полноэкранный режим',
        type: 'checkbox',
        accelerator: 'F11',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
      },
    ] },
    { label: 'Холст', submenu: [nativeCommand('Удалить активный холст', 'delete-board')] },
    { label: 'Слой', submenu: [
      nativeCommand('Новый слой', 'add-layer'),
      nativeCommand('Дублировать активный слой', 'duplicate-layer'),
      nativeCommand('Удалить активный слой', 'delete-layer'),
    ] },
    { label: 'Кадр', submenu: [
      nativeCommand('Предыдущий кадр', 'frame-previous'),
      nativeCommand('Следующий кадр', 'frame-next'),
      { type: 'separator' },
      nativeCommand('Добавить кадр', 'frame-add'),
      nativeCommand('Дублировать кадр', 'frame-duplicate'),
      nativeCommand('Удалить кадр', 'frame-remove'),
    ] },
    { label: 'Анимация', submenu: [
      nativeCommand('Воспроизвести или остановить', 'animation-play'),
      nativeCommand('Показать или скрыть Timeline', 'toggle-timeline'),
    ] },
    { label: 'Инструменты', submenu: [
      nativeCommand('Карандаш', 'tool:pencil'),
      nativeCommand('Ластик', 'tool:eraser'),
      nativeCommand('Заливка', 'tool:fill'),
      nativeCommand('Пипетка', 'tool:picker'),
      nativeCommand('Линия', 'tool:line'),
      nativeCommand('Прямоугольник', 'tool:rect'),
      nativeCommand('Окружность', 'tool:circle'),
      nativeCommand('Градиент', 'tool:gradient'),
      nativeCommand('Дизеринг', 'tool:dither'),
    ] },
    { label: 'Окно', submenu: [
      nativeCommand('Рабочее пространство: Рисование', 'workspace-drawing'),
      nativeCommand('Рабочее пространство: Анимация', 'workspace-animation'),
      nativeCommand('Рабочее пространство: Tileset', 'workspace-tileset'),
      nativeCommand('Рабочее пространство: Минимальное', 'workspace-minimal'),
      { type: 'separator' },
      nativeCommand('Показать или скрыть инструменты', 'toggle-tools'),
      nativeCommand('Показать или скрыть палитру', 'toggle-palette'),
      nativeCommand('Настройки…', 'settings'),
      nativeCommand('Справка', 'help'),
    ] },
  ]);
  Menu.setApplicationMenu(nativeMenu);
}

async function loadWindowState() {
  try {
    const content = await readFile(windowStatePath, 'utf8');
    const state = JSON.parse(content);
    if (!isValidWindowState(state)) {
      console.error('Состояние окна повреждено; будет использовано стандартное положение.');
      return null;
    }
    return state;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    console.error('Не удалось прочитать состояние окна; будет использовано стандартное положение.', error);
    return null;
  }
}

function getWindowState(window) {
  return {
    version: 1,
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
  };
}

async function saveWindowState() {
  if (!windowStatePath) return;
  const state = mainWindow && !mainWindow.isDestroyed()
    ? getWindowState(mainWindow)
    : pendingWindowStateSnapshot;
  if (!state) return;
  const temporaryPath = `${windowStatePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state));
    await rename(temporaryPath, windowStatePath);
    savedWindowState = state;
    pendingWindowStateSnapshot = null;
  } catch (error) {
    console.error('Не удалось сохранить состояние окна.', error);
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Не удалось удалить временный файл состояния окна.', cleanupError);
    }
  }
}

function scheduleWindowStateSave() {
  clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = undefined;
    if (windowStateSaveInProgress) {
      scheduleWindowStateSave();
      return;
    }
    windowStateSaveInProgress = true;
    void saveWindowState().finally(() => {
      windowStateSaveInProgress = false;
    });
  }, WINDOW_STATE_SAVE_DELAY_MS);
}

async function flushWindowStateSave() {
  clearTimeout(windowStateTimer);
  windowStateTimer = undefined;
  while (windowStateSaveInProgress) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  windowStateSaveInProgress = true;
  try {
    await saveWindowState();
  } finally {
    windowStateSaveInProgress = false;
  }
}

function showStartupError(message, error) {
  if (startupErrorShown) return;
  startupErrorShown = true;

  const details = error instanceof Error ? error.message : String(error);
  console.error(message, error);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  dialog.showErrorBox(
    'Не удалось запустить Pixel Editor',
    `${message}\n\nПодробности: ${details}\n\nПерезапустите приложение. Если ошибка повторится, переустановите его.`,
  );
  app.quit();
}

function assertMainWindowSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Запрос поступил из неизвестного окна.');
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

function updateWindowState(event, state) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    console.error('Отклонено изменение состояния окна из неизвестного renderer.');
    return;
  }
  if (
    typeof state !== 'object' ||
    state === null ||
    (state.fileName !== null && (
      typeof state.fileName !== 'string' ||
      state.fileName.length === 0 ||
      state.fileName.length > 255 ||
      path.basename(state.fileName) !== state.fileName ||
      /[\u0000-\u001f]/u.test(state.fileName)
    )) ||
    typeof state.dirty !== 'boolean' ||
    typeof state.canUndo !== 'boolean' ||
    typeof state.canRedo !== 'boolean'
  ) {
    console.error('Отклонено некорректное состояние окна.');
    return;
  }

  const projectLabel = state.fileName ?? (state.dirty ? 'Новый проект' : null);
  projectIsDirty = state.dirty;
  mainWindow.setTitle(
    `${APP_TITLE}${projectLabel ? ` — ${projectLabel}` : ''}${state.dirty ? ' *' : ''}`,
  );
  updateNativeMenuState(state);
}

function createWindow() {
  const displays = screen.getAllDisplays();
  const initialState = restoreWindowState(
    savedWindowState,
    displays.map((display) => display.workArea),
  );
  mainWindow = new BrowserWindow({
    ...initialState.bounds,
    minWidth: initialState.minWidth,
    minHeight: initialState.minHeight,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (initialState.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (allowNextClose) {
      allowNextClose = false;
    } else if (projectIsDirty) {
      event.preventDefault();
      if (closeDialogOpen) return;
      closeDialogOpen = true;
      void dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: APP_TITLE,
        message: 'В проекте есть несохранённые изменения.',
        detail: 'Сохранить изменения перед закрытием?',
        buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }).then(({ response }) => {
        closeDialogOpen = false;
        if (response === 0) sendMenuCommand('save-before-close');
        else if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
          allowNextClose = true;
          mainWindow.close();
        }
      }).catch((error) => {
        closeDialogOpen = false;
        console.error('Не удалось показать подтверждение закрытия.', error);
        dialog.showErrorBox('Не удалось закрыть Pixel Editor', error instanceof Error ? error.message : String(error));
      });
      return;
    }
    pendingWindowStateSnapshot = getWindowState(mainWindow);
    scheduleWindowStateSave();
  });
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('maximize', scheduleWindowStateSave);
  mainWindow.on('unmaximize', scheduleWindowStateSave);
  mainWindow.on('enter-full-screen', () => updateNativeMenuState());
  mainWindow.on('leave-full-screen', () => updateNativeMenuState());
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
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    showStartupError(
      'Процесс окна редактора аварийно завершился.',
      new Error(`Причина: ${details.reason}; код завершения: ${details.exitCode}.`),
    );
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
      .catch((error) => showStartupError('Не удалось загрузить интерфейс приложения.', error));
  } else {
    void mainWindow.loadURL(DEV_SERVER_URL)
      .catch((error) => showStartupError('Не удалось подключиться к серверу разработки.', error));
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

function validateProjectSaveRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Некорректный запрос сохранения проекта.');
  }
  const { suggestedName, data, handle, forceDialog } = request;
  if (
    typeof suggestedName !== 'string' ||
    suggestedName.length === 0 ||
    suggestedName.length > 160 ||
    path.basename(suggestedName) !== suggestedName ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(suggestedName)
  ) {
    throw new TypeError('Некорректное имя файла проекта.');
  }
  if (handle !== null && typeof handle !== 'string') {
    throw new TypeError('Некорректный идентификатор открытого проекта.');
  }
  if (typeof forceDialog !== 'boolean') throw new TypeError('Некорректный режим сохранения проекта.');
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new RangeError('Размер проекта недопустим.');
  }
  return { suggestedName, data, handle, forceDialog };
}

async function saveProjectFile(request) {
  const { suggestedName, data, handle, forceDialog } = validateProjectSaveRequest(request);
  let targetPath;
  if (!forceDialog && handle !== null) {
    targetPath = projectHandles.get(handle);
    if (!targetPath) throw new Error('Файл проекта больше недоступен. Используйте «Сохранить как…».');
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: forceDialog ? 'Сохранить проект как' : 'Сохранить проект',
      defaultPath: suggestedName,
      filters: [{
        name: 'Проект Pixel Editor',
        extensions: ['pxproj', 'json'],
      }],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    targetPath = result.filePath;
    if (!path.extname(targetPath)) targetPath += '.pxproj';
    if (!PROJECT_EXTENSIONS.includes(path.extname(targetPath).toLowerCase())) {
      throw new TypeError('Проект можно сохранить только как .pxproj или .json.');
    }
  }

  const resolvedPath = path.resolve(targetPath);
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
  await backupExistingProject(resolvedPath);
  try {
    await writeFile(temporaryPath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Не удалось удалить временный файл проекта.', cleanupError);
    }
    throw error;
  }

  const fileInfo = await getProjectFileInfo(resolvedPath);
  const nextHandle = createProjectHandle(fileInfo.path);
  projectIsDirty = false;
  const updatedRecents = await addRecentProject(fileInfo.path);
  return {
    status: 'saved',
    fileName: fileInfo.fileName,
    handle: nextHandle,
    recentProjects: updatedRecents,
  };
}

async function readProjectPayload(filePath) {
  const info = await getProjectFileInfo(filePath);
  const contents = await readFile(info.path);
  if (contents.byteLength !== info.size || contents.byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new RangeError('Файл проекта изменился или превышает допустимый размер.');
  }
  return {
    handle: createProjectHandle(info.path),
    fileName: info.fileName,
    data: new Uint8Array(contents),
  };
}

ipcMain.handle('pixel-editor:save-project', async (event, request) => {
  assertMainWindowSender(event);
  return saveProjectFile(request);
});

ipcMain.handle('pixel-editor:register-selected-project', async (event, filePath) => {
  assertMainWindowSender(event);
  const info = await getProjectFileInfo(filePath);
  return { handle: createProjectHandle(info.path), fileName: info.fileName };
});

ipcMain.handle('pixel-editor:set-current-project', async (event, handle) => {
  assertMainWindowSender(event);
  const filePath = projectHandles.get(handle);
  if (!filePath) throw new Error('Файл проекта больше недоступен.');
  return addRecentProject(filePath);
});

ipcMain.handle('pixel-editor:list-recent-projects', (event) => {
  assertMainWindowSender(event);
  return getPublicRecentProjects();
});

ipcMain.handle('pixel-editor:open-recent-project', async (event, id) => {
  assertMainWindowSender(event);
  const recent = recentProjects.find((entry) => entry.id === id);
  if (!recent) throw new Error('Проект отсутствует в списке недавних файлов.');
  return readProjectPayload(recent.path);
});

ipcMain.handle('pixel-editor:latest-project-backup', async (event, handle) => {
  assertMainWindowSender(event);
  const filePath = projectHandles.get(handle);
  if (!filePath) throw new Error('Файл проекта больше недоступен.');
  const backups = await getProjectBackups(filePath);
  const latest = backups[0];
  if (!latest) return null;
  const contents = await readFile(latest.path);
  return { data: new Uint8Array(contents), fileName: path.basename(filePath) };
});

ipcMain.handle('pixel-editor:take-pending-project', (event) => {
  assertMainWindowSender(event);
  rendererReady = true;
  const payload = pendingProjectOpen ?? null;
  pendingProjectOpen = undefined;
  return payload;
});

ipcMain.handle('pixel-editor:begin-batch-export', async (event) => {
  assertMainWindowSender(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выбрать папку пакетного экспорта',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sessionId = randomUUID();
  projectExportSessions.set(sessionId, {
    directory: await realpath(result.filePaths[0]),
    filesWritten: 0,
    totalBytes: 0,
    createdNames: new Set(),
  });
  return sessionId;
});

ipcMain.handle('pixel-editor:write-batch-export', async (event, sessionId, fileName, data) => {
  assertMainWindowSender(event);
  const session = projectExportSessions.get(sessionId);
  if (!session) throw new Error('Сеанс пакетного экспорта больше недоступен.');
  if (
    typeof fileName !== 'string' ||
    !/^pixel-editor-\d{13}-canvas-\d{1,2}-\d+x\d+\.png$/u.test(fileName) ||
    path.basename(fileName) !== fileName ||
    !(data instanceof Uint8Array) ||
    data.byteLength === 0 ||
    data.byteLength > MAX_SAVE_BYTES
  ) {
    throw new TypeError('Некорректный файл пакетного экспорта.');
  }
  if (session.filesWritten >= 32 || session.totalBytes + data.byteLength > 512 * 1024 * 1024) {
    throw new RangeError('Пакетный экспорт превышает допустимый объём.');
  }
  if (session.createdNames.has(fileName)) throw new Error('Имя файла повторяется в пакете экспорта.');
  const targetPath = path.join(session.directory, fileName);
  await writeFile(targetPath, Buffer.from(data.buffer, data.byteOffset, data.byteLength), { flag: 'wx' });
  session.filesWritten++;
  session.totalBytes += data.byteLength;
  session.createdNames.add(fileName);
});

ipcMain.handle('pixel-editor:end-batch-export', (event, sessionId) => {
  assertMainWindowSender(event);
  projectExportSessions.delete(sessionId);
});

ipcMain.handle('pixel-editor:close-after-save', (event) => {
  assertMainWindowSender(event);
  if (projectIsDirty) throw new Error('Сначала необходимо сохранить все изменения проекта.');
  allowNextClose = true;
  mainWindow.close();
});

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
  if (result.canceled || !result.filePath) return { status: 'cancelled' };

  await writeFile(result.filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  return { status: 'saved', fileName: path.basename(result.filePath) };
});

ipcMain.on('pixel-editor:window-state', updateWindowState);

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

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = findProjectPathArgument(commandLine.slice(1));
    if (filePath) void openProjectPath(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void openProjectPath(filePath);
  });
} else {
  app.quit();
}

app.whenReady().then(async () => {
  feedbackNotesStore = createFeedbackNotesStore(app.getPath('userData'));
  windowStatePath = path.join(app.getPath('userData'), WINDOW_STATE_FILENAME);
  recentProjectsPath = path.join(app.getPath('userData'), RECENT_PROJECTS_FILENAME);
  await loadRecentProjects();
  savedWindowState = await loadWindowState();
  buildNativeMenu();
  createWindow();
  if (startupProjectPath) {
    void openProjectPath(startupProjectPath);
    startupProjectPath = null;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => showStartupError('Не удалось подготовить приложение к запуску.', error));

app.on('before-quit', (event) => {
  if (quitAfterWindowStateSave) return;
  event.preventDefault();
  quitAfterWindowStateSave = true;
  void flushWindowStateSave().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
