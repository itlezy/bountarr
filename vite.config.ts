import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from 'unocss/vite';

export default defineConfig({
  plugins: [UnoCSS(), sveltekit()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
