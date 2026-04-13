import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.BOUNTARR_INTEGRATION_PORT ?? '4311', 10);
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/live-ui',
  timeout: 240_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      `pwsh -NoLogo -NoProfile -File .\\helpers\\helper-test-live-ui-server.ps1 ` +
      `-HostName ${host} -Port ${port}`,
    url: baseURL,
    timeout: 240_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'live-chromium',
      use: {
        browserName: 'chromium',
        viewport: {
          width: 1440,
          height: 1080,
        },
      },
    },
  ],
});
