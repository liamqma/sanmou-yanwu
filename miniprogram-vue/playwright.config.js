const { defineConfig } = require('playwright/test');

const PORT = 5199;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `npx uni --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 60000,
    reuseExistingServer: true,
  },
});
