import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveDesktopBlob } from './desktopFiles';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('сохранение файлов настольного приложения', () => {
  it('передаёт содержимое в системный диалог Electron', async () => {
    const saveFile = vi.fn(async () => ({ status: 'saved', fileName: 'art.png' } as const));
    vi.stubGlobal('window', { pixelEditorDesktop: { saveFile } });

    await expect(saveDesktopBlob(new Blob(['pixels'], { type: 'image/png' }), 'art.png')).resolves.toBe('saved');
    expect(saveFile).toHaveBeenCalledWith({
      suggestedName: 'art.png',
      mimeType: 'image/png',
      data: new Uint8Array([112, 105, 120, 101, 108, 115]),
    });
  });

  it('отказывает, если мост Electron недоступен', async () => {
    vi.stubGlobal('window', {});

    await expect(saveDesktopBlob(new Blob(['project']), 'project.json'))
      .rejects.toThrow('Pixel Editor доступен только в настольном приложении.');
  });
});
