import { mergeConfig, defineConfig } from 'vitest/config';
import baseConfig from './vite.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
    },
  }),
);
