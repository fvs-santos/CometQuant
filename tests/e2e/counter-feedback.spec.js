const { test, expect } = require('@playwright/test')

function experimentFixture(target = 3) {
  return {
    schemaVersion: 3,
    id: 'counter-feedback-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in-progress',
    researcher: '',
    agent: 'Agent',
    cells: 'CHO-K1',
    negControl: 'PBS',
    posControl: '',
    solControl: '',
    nucleoidsPerGel: target,
    slidesPerTreatment: 1,
    concUnit: 'µM',
    treatments: ['PBS'],
    progress: null,
    replicates: [{
      replicateNumber: 1,
      date: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      gels: [],
      assignments: [{ blindCode: 'ABCD-01', treatmentIndex: 0, gelNumber: 1, status: 'pending' }]
    }]
  }
}

async function preparePage(page, {
  target = 3,
  vibrationSupported = true,
  vibrationThrows = false,
  soundSupported = true,
  soundThrows = false
} = {}) {
  await page.addInitScript(({ experiment, vibrationSupported, vibrationThrows, soundSupported, soundThrows }) => {
    if (!localStorage.getItem('cometquant-experiments')) {
      localStorage.setItem('cometquant-experiments', JSON.stringify([experiment]))
    }
    window.__vibrations = []
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrationSupported ? function (duration) {
        window.__vibrations.push(duration)
        if (vibrationThrows) throw new Error('Vibration unavailable')
        return true
      } : undefined
    })
    window.__sounds = []
    const audioParam = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {}
    }
    class MockAudioContext {
      constructor() {
        this.state = 'running'
        this.currentTime = 0
        this.destination = {}
      }

      resume() {
        return Promise.resolve()
      }

      createOscillator() {
        if (soundThrows) throw new Error('Audio unavailable')
        return {
          type: 'sine',
          frequency: audioParam,
          connect() {},
          start() { window.__sounds.push('click') },
          stop() {}
        }
      }

      createGain() {
        return { gain: audioParam, connect() {} }
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: soundSupported ? MockAudioContext : undefined
    })
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      value: undefined
    })
  }, { experiment: experimentFixture(target), vibrationSupported, vibrationThrows, soundSupported, soundThrows })
  await page.goto('/')
}

async function openCounter(page) {
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await page.locator('#input-blind-code').fill('ABCD-01')
  await page.getByRole('button', { name: 'Start Counting' }).click()
}

test('loads optimized class icons at 320 px and keeps them in the offline cache', async ({ page, context, browserName }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await preparePage(page)
  await openCounter(page)

  const icons = page.locator('.comet-image')
  await expect(icons).toHaveCount(5)
  await expect.poll(() => icons.evaluateAll(images => images.map(image => ({
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight
  })))).toEqual(Array.from({ length: 5 }, () => ({ complete: true, width: 512, height: 512 })))
  expect(await page.locator('.comet-classes-grid').evaluate(grid => grid.scrollWidth <= grid.clientWidth)).toBe(true)

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  if (browserName === 'webkit') {
    const cachedIcons = await page.evaluate(async () => Promise.all(
      Array.from({ length: 5 }, (_, index) => caches.match(`./icons/class_${index}.png`).then(Boolean))
    ))
    expect(cachedIcons).toEqual([true, true, true, true, true])
    return
  }
  await context.setOffline(true)
  await page.reload()
  await expect.poll(() => icons.evaluateAll(images => images.map(image => image.complete && image.naturalWidth))).toEqual([512, 512, 512, 512, 512])
  await context.setOffline(false)
})

test('provides feedback once for each accepted count and ignores counts beyond the target', async ({ page }) => {
  await preparePage(page, { target: 1 })
  await expect(page.locator('#input-haptic-feedback')).toBeChecked()
  await expect(page.locator('#input-sound-feedback')).toBeChecked()
  await openCounter(page)

  await page.locator('#card-class-2').click()
  await expect(page.locator('#count-2')).toHaveText('1')
  await expect.poll(() => page.evaluate(() => window.__vibrations)).toEqual([30])
  await expect.poll(() => page.evaluate(() => window.__sounds)).toEqual(['click'])

  await page.locator('#card-class-2').click()
  await expect(page.locator('#count-2')).toHaveText('1')
  await page.waitForTimeout(50)
  expect(await page.evaluate(() => window.__vibrations)).toEqual([30])
  expect(await page.evaluate(() => window.__sounds)).toEqual(['click'])
})

test('persists the disabled haptic preference', async ({ page }) => {
  await preparePage(page)
  const preference = page.locator('#input-haptic-feedback')
  await expect(preference).toBeChecked()
  await preference.uncheck()
  expect(await page.evaluate(() => localStorage.getItem('cometquant-haptic-feedback'))).toBe('false')

  await page.reload()
  await expect(preference).not.toBeChecked()
  await openCounter(page)
  await page.locator('#card-class-1').click()
  await expect(page.locator('#count-1')).toHaveText('1')
  expect(await page.evaluate(() => window.__vibrations)).toEqual([])
})

test('persists the disabled sound preference', async ({ page }) => {
  await preparePage(page)
  const preference = page.locator('#input-sound-feedback')
  await expect(preference).toBeChecked()
  await preference.uncheck()
  expect(await page.evaluate(() => localStorage.getItem('cometquant-sound-feedback'))).toBe('false')

  await page.reload()
  await expect(preference).not.toBeChecked()
  await openCounter(page)
  await page.locator('#card-class-1').click()
  await expect(page.locator('#count-1')).toHaveText('1')
  expect(await page.evaluate(() => window.__sounds)).toEqual([])
})

test('keeps autosave working when the vibration API fails', async ({ page }) => {
  await preparePage(page, { vibrationThrows: true })
  await openCounter(page)
  await page.locator('#card-class-4').click()
  await expect(page.locator('#count-4')).toHaveText('1')
  await expect(page.locator('#save-status')).toHaveText('Saved')

  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Continue Counting' }).click()
  await expect(page.locator('#count-4')).toHaveText('1')
})

test('keeps autosave working when sound playback fails', async ({ page }) => {
  await preparePage(page, { soundThrows: true })
  await openCounter(page)
  await page.locator('#card-class-3').click()
  await expect(page.locator('#count-3')).toHaveText('1')
  await expect(page.locator('#save-status')).toHaveText('Saved')

  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Continue Counting' }).click()
  await expect(page.locator('#count-3')).toHaveText('1')
})

test('disables haptic feedback without API support and keeps counting', async ({ page }) => {
  await preparePage(page, { vibrationSupported: false })
  const preference = page.locator('#input-haptic-feedback')
  await expect(preference).toBeDisabled()
  await expect(preference).not.toBeChecked()

  await openCounter(page)
  await page.locator('#card-class-0').click()
  await expect(page.locator('#count-0')).toHaveText('1')
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect(await page.evaluate(() => window.__vibrations)).toEqual([])
  expect(await page.evaluate(() => window.__sounds)).toEqual(['click'])
})

test('disables sound feedback without Web Audio support and keeps counting', async ({ page }) => {
  await preparePage(page, { soundSupported: false })
  const preference = page.locator('#input-sound-feedback')
  await expect(preference).toBeDisabled()
  await expect(preference).not.toBeChecked()

  await openCounter(page)
  await page.locator('#card-class-0').click()
  await expect(page.locator('#count-0')).toHaveText('1')
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect(await page.evaluate(() => window.__sounds)).toEqual([])
})
