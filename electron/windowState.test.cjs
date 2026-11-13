const { describe, expect, it } = require('vitest');
const { restoreWindowState } = require('./windowState.cjs');

describe('window state restoration', () => {
  it('keeps saved bounds on their existing display', () => {
    const result = restoreWindowState({
      version: 1,
      bounds: { x: 1500, y: 80, width: 1200, height: 800 },
      maximized: true,
    }, [
      { x: 0, y: 0, width: 1280, height: 720 },
      { x: 1280, y: 0, width: 1920, height: 1080 },
    ]);

    expect(result).toEqual({
      bounds: { x: 1500, y: 80, width: 1200, height: 800 },
      maximized: true,
      minWidth: 900,
      minHeight: 640,
    });
  });

  it('moves and resizes off-screen windows to the nearest available display', () => {
    const result = restoreWindowState({
      version: 1,
      bounds: { x: 3500, y: 100, width: 1440, height: 920 },
      maximized: false,
    }, [{ x: 0, y: 0, width: 1280, height: 720 }]);

    expect(result.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('uses a visible default window when saved data is malformed', () => {
    const result = restoreWindowState({
      version: 1,
      bounds: { x: Number.NaN, y: 0, width: -1, height: 900 },
      maximized: true,
    }, [{ x: 0, y: 0, width: 1000, height: 700 }]);

    expect(result).toEqual({
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
      maximized: false,
      minWidth: 900,
      minHeight: 640,
    });
  });
});
