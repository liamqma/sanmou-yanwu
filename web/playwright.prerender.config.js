const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests-production',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
