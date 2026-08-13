const { defineConfig } = require('vitest/config')

module.exports = defineConfig({
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'jsdom',
    coverage: { provider: 'v8', include: ['js/core.js', 'js/export.js'] }
  }
})
