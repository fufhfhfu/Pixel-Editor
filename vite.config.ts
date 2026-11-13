import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  plugins: [
    svelte(),
    ...(command === 'serve'
      ? [{
          name: 'pixel-editor-dev-csp',
          transformIndexHtml(html: string) {
            return html.replace(
              "connect-src 'self';",
              "connect-src 'self' ws://127.0.0.1:5173;",
            );
          },
        }]
      : []),
  ],
  base: './',
  // Svelte-компоненты в jsdom должны использовать DOM-совместимый runtime.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
