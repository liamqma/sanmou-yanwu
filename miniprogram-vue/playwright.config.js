const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:5173',
    timeout: 30000,
    reuseExistingServer: true,
  },
});
