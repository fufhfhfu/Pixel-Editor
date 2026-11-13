import { describe, expect, it } from 'vitest';
import { hasPublisherName } from './updateConfig.cjs';

describe('update configuration signature verification', () => {
  it('requires a non-empty publisher name', () => {
    expect(hasPublisherName('provider: github\npublisherName: Pixel Editor, Inc.')).toBe(true);
    expect(hasPublisherName('publisherName:\n  - Pixel Editor, Inc.\n  - Pixel Editor LLC')).toBe(true);
    expect(hasPublisherName('provider: github')).toBe(false);
    expect(hasPublisherName('publisherName: "  "')).toBe(false);
  });

  it('surfaces invalid update configuration', () => {
    expect(() => hasPublisherName('publisherName: [')).toThrow();
  });
});
