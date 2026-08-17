const { test, expect } = require('@playwright/test')
const expected = require('../reference/v1/expected.json')

function referenceExperiment() {
  const treatments = Object.keys(expected.scores)
  const codes = ['ABCD', 'EFGH', 'JKLM', 'NPQR']
  const replicates = Array.from({ length: 5 }, (_, replicateIndex) => {
    const recordedAt = `2026-01-0${replicateIndex + 1}T12:00:00.000Z`
    const assignments = treatments.map((treatment, treatmentIndex) => ({
      blindCode: `${codes[treatmentIndex]}-01`,
      treatmentIndex,
      gelNumber: 1,
      status: 'counted',
      recordedAt
    }))
    const gels = treatments.map((treatment, treatmentIndex) => {
      const score = expected.scores[treatment][replicateIndex]
      return {
        blindCode: `${codes[treatmentIndex]}-01`,
        treatment,
        treatmentIndex,
        gelNumber: 1,
        class0: 100 - score,
        class1: 0,
        class2: 0,
        class3: 0,
        class4: score,
        total: 100,
        status: 'counted',
        completion: 'complete',
        recordedAt
      }
    })
    return {
      replicateNumber: replicateIndex + 1,
      date: `2026-01-0${replicateIndex + 1}`,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      assignments,
      gels
    }
  })

  return {
    schemaVersion: 3,
    id: 'analysis-reference',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T12:00:00.000Z',
    status: 'completed',
    researcher: 'Reference',
    agent: 'Reference agent',
    cells: 'CHO-K1',
    negControl: 'Control',
    posControl: '',
    solControl: '',
    nucleoidsPerGel: 100,
    slidesPerTreatment: 1,
    concUnit: 'uM',
    treatments,
    progress: null,
    replicates
  }
}

test('runs the extracted Python engine in Pyodide with reference results', async ({ page, browserName }) => {
  test.setTimeout(360000)
  const remoteRequests = []
  page.on('request', request => {
    if (request.url().includes('cdn.jsdelivr.net/pyodide')) remoteRequests.push(request.url())
  })
  await page.addInitScript(experiment => localStorage.setItem('cometquant-experiments', JSON.stringify([experiment])), referenceExperiment())
  await page.goto('/')
  expect(remoteRequests).toEqual([])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Statistical Analysis' }).click()

  await page.getByRole('button', { name: /Prepare Offline Analysis/ }).click()
  await expect.poll(() => page.locator('#pyodide-message').textContent(), { timeout: 240000 })
    .toMatch(/Scientific environment ready|Could not prepare/)
  const preparationError = await page.locator('#analysis-error').textContent()
  expect(preparationError).toBe('')
  await expect(page.locator('#pyodide-message')).toHaveText('Scientific environment ready for offline use.')
  expect(remoteRequests.length).toBeGreaterThan(0)
  const installedRequestCount = remoteRequests.length
  await expect.poll(() => page.evaluate(() => analysisRuntimeVersions)).toEqual({
    pyodide: '0.26.2', python: '3.12.1', numpy: '1.26.4', scipy: '1.12.0', matplotlib: '3.5.2'
  })

  if (browserName !== 'webkit') await page.context().setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Statistical Analysis' }).click()
  await expect(page.locator('#pyodide-message')).toHaveText('Scientific environment ready for offline use.', { timeout: 180000 })
  await page.getByRole('button', { name: 'Run Analysis' }).click()
  await page.evaluate(() => setLanguage('pt'))
  await expect(page.locator('#pyodide-message')).toHaveText('Ambiente científico pronto para uso offline.', { timeout: 60000 })
  await expect(page.locator('#analysis-results')).toBeHidden()
  await page.evaluate(() => setLanguage('en'))
  await page.getByRole('button', { name: 'Run Analysis' }).click()
  await expect(page.locator('#analysis-results')).toBeVisible({ timeout: 60000 })

  const anovaCells = await page.locator('#anova-table tbody td').allTextContents()
  expect(anovaCells).toEqual([
    String(expected.anova.SS),
    String(expected.anova.DF),
    String(expected.anova.MS),
    String(expected.anova.F),
    '< 0.00001'
  ])
  await expect(page.locator('#tukey-table tbody tr')).toHaveCount(expected.tukey.length)
  await expect(page.locator('#charts-container img')).toHaveCount(2)
  expect(remoteRequests).toHaveLength(installedRequestCount)
})
