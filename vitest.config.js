const { defineConfig } = require('vitest/config')

module.exports = defineConfig({
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['js/core.js', 'js/repository.js', 'js/backup.js', 'js/export.js'],
      thresholds: { statements: 80, branches: 50, functions: 80, lines: 80 }
    }
  }
})
