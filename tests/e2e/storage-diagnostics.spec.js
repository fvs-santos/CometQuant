const fs = require('node:fs')
const { test, expect } = require('@playwright/test')

test('reports storage estimates without requesting persistence', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    window.__persistCalls = 0
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 10 * 1024 * 1024, quota: 200 * 1024 * 1024 }),
        persisted: async () => false,
        persist: async () => {
          window.__persistCalls++
          return true
        }
      }
    })
  })
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.getByRole('button', { name: 'Storage Diagnostics' }).click()

  await expect(page.locator('#screen-storage-diagnostics')).toHaveClass(/active/)
  await expect(page.locator('#storage-diagnostics-title')).toBeFocused()
  await expect(page.locator('[data-diagnostic="usage"]')).toHaveText('10 MB')
  await expect(page.locator('[data-diagnostic="quota"]')).toHaveText('200 MB')
  await expect(page.locator('[data-diagnostic="availableSpace"]')).toHaveText('190 MB')
  await expect(page.locator('[data-diagnostic="persistent"]')).toHaveText('No')
  await expect(page.locator('[data-diagnostic="offlineShell"]')).toHaveText('Available')
  expect(await page.evaluate(() => window.__persistCalls)).toBe(0)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Report' }).click()
  const download = await downloadPromise
  const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  expect(report).toMatchObject({
    estimate: { usage: 10 * 1024 * 1024, quota: 200 * 1024 * 1024 },
    persistence: { persisted: false },
    caches: { shellReady: true },
    repository: { status: 'available', error: null }
  })
  expect(report.repository).not.toHaveProperty('experiments')

  await page.getByRole('button', { name: /Back/ }).click()
  await expect(page.getByRole('button', { name: 'Storage Diagnostics' })).toBeFocused()
  await page.getByRole('button', { name: 'PT' }).click()
  await page.getByRole('button', { name: 'Diagnóstico de Armazenamento' }).click()
  await expect(page.getByRole('heading', { name: 'Diagnóstico de Armazenamento' })).toBeVisible()
  await expect(page.locator('[data-diagnostic="usage"]')).toHaveText('10 MB')
})

test('keeps diagnostics available when IndexedDB and StorageManager are unavailable', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Storage Diagnostics' }).click()

  await expect(page.locator('[data-diagnostic="repository"]')).toHaveText('Unavailable')
  await expect(page.locator('[data-diagnostic="indexedDB"]')).toHaveText('Unavailable')
  await expect(page.locator('[data-diagnostic="usage"]')).toHaveText('Unknown')
  await expect(page.locator('#storage-diagnostics-status')).toHaveText('Diagnostics completed with partial information.')
})

test('reports a real IndexedDB open failure separately from API support', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          const request = { error: new Error('Open failed\nwith detail') }
          setTimeout(() => request.onerror?.(), 0)
          return request
        }
      }
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Storage Diagnostics' }).click()

  await expect(page.locator('[data-diagnostic="repository"]')).toHaveText('Unavailable')
  await expect(page.locator('[data-diagnostic="indexedDB"]')).toHaveText('Available')
  await expect(page.locator('#storage-diagnostics-status')).toHaveText('Diagnostics completed with partial information.')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Report' }).click()
  const download = await downloadPromise
  const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  expect(report.repository.error).toBe('Open failed with detail')
})

test('marks empty StorageManager estimates as partial information', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({}),
        persisted: async () => true
      }
    })
  })
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.getByRole('button', { name: 'Storage Diagnostics' }).click()

  await expect(page.locator('[data-diagnostic="usage"]')).toHaveText('Unknown')
  await expect(page.locator('[data-diagnostic="quota"]')).toHaveText('Unknown')
  await expect(page.locator('#storage-diagnostics-status')).toHaveText('Diagnostics completed with partial information.')
})
