import { defineConfig, type UserConfig } from 'vitest/config';
import baseConfig from './vite.config';

const resolvedBaseConfig = baseConfig as UserConfig;

export default defineConfig({
  ...resolvedBaseConfig,
  test: {
    ...(resolvedBaseConfig.test ?? {}),
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
});
