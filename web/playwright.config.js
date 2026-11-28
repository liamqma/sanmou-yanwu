const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // The lineup model searches in the browser; allow for slow CI machines.
  timeout: 120000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    timeout: 120000,
    reuseExistingServer: true,
  },
});
