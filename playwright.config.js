const { defineConfig, devices } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173', ...devices['Pixel 7'] },
  webServer: { command: 'npx http-server . -p 4173 -c-1', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
})
