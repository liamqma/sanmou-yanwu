const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    timeout: 120000,
    reuseExistingServer: true,
  },
});
