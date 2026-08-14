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

test('runs the extracted Python engine in Pyodide with reference results', async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('/')
  await page.evaluate(experiment => localStorage.setItem('cometquant-experiments', JSON.stringify([experiment])), referenceExperiment())
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Statistical Analysis' }).click()

  await expect(page.locator('#pyodide-message')).toHaveText('Analysis complete', { timeout: 180000 })
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
})
