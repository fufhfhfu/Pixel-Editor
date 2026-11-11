import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { AutosaveRepository, getAppIndexedDB } from './core/autosave';
import { loadEditorPreferences } from './core/preferences';
import { getAppStorage } from './core/storage';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Не найден корневой элемент #app.');
}

const appTarget = target;
if (!window.pixelEditorDesktop) {
  appTarget.textContent = 'Pixel Editor работает только как настольное приложение. Запустите его командой npm run dev.';
} else {
  document.documentElement.dataset.theme = loadEditorPreferences(getAppStorage()).theme;

  async function bootstrap(): Promise<void> {
    const legacyStorage = getAppStorage();
    const autosaveRepository = new AutosaveRepository(getAppIndexedDB(), legacyStorage);
    appTarget.textContent = 'Загрузка проекта…';
    const startup = await autosaveRepository.load();
    mount(App, {
      target: appTarget,
      props: {
        initialProject: startup.project,
        initialLoadError: startup.error,
        initialStorageMode: startup.mode,
        autosaveRepository,
      },
    });
  }

  void bootstrap().catch((error: unknown) => {
    console.error('Не удалось запустить Pixel Editor.', error);
    appTarget.textContent = 'Не удалось запустить редактор. Перезапустите приложение.';
  });
}
