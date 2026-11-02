import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The game ships as ONE self-contained HTML file (viteSingleFile inlines JS and CSS),
// so it can be hosted anywhere static, including as a published artifact.
export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
