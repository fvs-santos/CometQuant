const { defineConfig, devices } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium-pixel-7',
      use: { ...devices['Pixel 7'], browserName: 'chromium' }
    },
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 13'], browserName: 'webkit' }
    }
  ],
  webServer: {
    command: 'npx http-server . -p 4173 -c-1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  }
})
