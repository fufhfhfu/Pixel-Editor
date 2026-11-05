import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { AutosaveRepository, getBrowserIndexedDB } from './core/autosave';
import { loadEditorPreferences } from './core/preferences';
import { getBrowserStorage } from './core/storage';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Не найден корневой элемент #app.');
}

const appTarget = target;
document.documentElement.dataset.theme = loadEditorPreferences(getBrowserStorage()).theme;

async function bootstrap(): Promise<void> {
  const legacyStorage = getBrowserStorage();
  const autosaveRepository = new AutosaveRepository(getBrowserIndexedDB(), legacyStorage);
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
  appTarget.textContent = 'Не удалось запустить редактор. Обновите страницу или сохраните резервную копию проекта.';
});
