const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')
const expected = require('../reference/v2/expected.json')

function referenceExperiment() {
  const lines = fs.readFileSync(path.resolve(__dirname, '../reference/v2/slides.csv'), 'utf8').trim().split(/\r?\n/)
  const headers = lines.shift().split(',')
  const rows = lines.map(line => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])))
  const treatments = Array.from(new Set(rows.map(row => row.treatment)))
  const replicates = []
  rows.forEach(row => {
    const replicateNumber = Number(row.replicate_number)
    const treatmentIndex = Number(row.treatment_index)
    const gelNumber = Number(row.slide)
    const score = Number(row.score)
    const baseNumber = (replicateNumber - 1) * treatments.length + treatmentIndex
    const blindCode = `A${String.fromCharCode(65 + baseNumber)}${gelNumber}`
    const recordedAt = `2026-01-0${replicateNumber}T12:00:00.000Z`
    let replicate = replicates.find(item => item.replicateNumber === replicateNumber)
    if (!replicate) {
      replicate = {
        replicateNumber,
        date: `2026-01-0${replicateNumber}`,
        createdAt: recordedAt,
        updatedAt: recordedAt,
        assignments: [],
        gels: []
      }
      replicates.push(replicate)
    }
    replicate.assignments.push({ blindCode, treatmentIndex, gelNumber, status: 'counted', recordedAt })
    const completion = row.completion
    const total = completion === 'complete' ? 100 : 99
    replicate.gels.push({
      blindCode,
      treatment: row.treatment,
      treatmentIndex,
      gelNumber,
      class0: total - score,
      class1: 0,
      class2: 0,
      class3: 0,
      class4: score,
      total,
      status: 'counted',
      completion,
      ...(completion === 'incomplete' ? { incompleteReason: { code: 'technical-error', detail: '' } } : {}),
      recordedAt
    })
  })

  return {
    schemaVersion: 5,
    id: 'analysis-reference',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T12:00:00.000Z',
    status: 'completed',
    researcher: 'Reference',
    agent: 'Reference agent',
    cells: 'CHO-K1',
    negControl: 'Negative control',
    posControl: 'Positive control',
    solControl: '',
    nucleoidsPerGel: 100,
    slidesPerTreatment: 2,
    concUnit: 'uM',
    treatments,
    treatmentMetadata: [
      { treatmentIndex: 0, role: 'negative-control', concentration: null },
      { treatmentIndex: 1, role: 'positive-control', concentration: null },
      { treatmentIndex: 2, role: 'test-concentration', concentration: 1 },
      { treatmentIndex: 3, role: 'test-concentration', concentration: 5 },
      { treatmentIndex: 4, role: 'test-concentration', concentration: 10 }
    ],
    studyDesign: {
      version: 1,
      status: 'configured',
      assayType: 'genotoxicity',
      primaryReferenceTreatmentIndex: 0,
      primaryTreatmentIndices: [2, 3, 4],
      validationComparison: { referenceTreatmentIndex: 0, treatmentIndex: 1 },
      alpha: 0.05,
      alternative: 'two-sided',
      pAdjustment: 'holm',
      trendReferenceAsZero: true,
      configurationSource: 'pre-collection'
    },
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

  const treatmentCells = await page.locator('#analysis-rcbd-anova tbody tr').first().locator('td').allTextContents()
  expect(treatmentCells).toEqual([
    'Treatment',
    expected.blockAnova.terms[0].SS.toFixed(4),
    String(expected.blockAnova.terms[0].DF),
    expected.blockAnova.terms[0].MS.toFixed(4),
    expected.blockAnova.terms[0].F.toFixed(4),
    '< 0.00001'
  ])
  await expect(page.locator('#analysis-primary-comparisons tbody tr')).toHaveCount(expected.primaryComparisons.length)
  await expect(page.locator('#analysis-v2-charts img')).toHaveCount(3)
  await page.evaluate(() => setLanguage('pt'))
  await expect(page.locator('#analysis-results')).toBeHidden()
  await page.getByRole('button', { name: 'Rodar Análise' }).click()
  await expect(page.locator('#analysis-results')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('#section-analysis-primary-comparisons .result-title')).toHaveText('Comparações Planejadas')
  await expect(page.locator('#analysis-primary-comparisons')).not.toContainText('analysis.v2.')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar Tudo (.zip)' }).click()
  const download = await downloadPromise
  const archive = await JSZip.loadAsync(fs.readFileSync(await download.path()))
  const archivedNames = Object.keys(archive.files)
  for (const suffix of [
    'data/analysis.json', 'data/study_design.csv', 'data/population.csv', 'data/block_anova.csv',
    'data/primary_comparisons.csv', 'data/control_response.csv', 'data/dose_trend.csv',
    'charts/block_scores.png', 'charts/primary_differences.png', 'charts/class_distribution.png'
  ]) {
    expect(archivedNames.some(name => name.endsWith(suffix))).toBe(true)
  }
  const analysisEntry = archive.file(archivedNames.find(name => name.endsWith('data/analysis.json')))
  expect(JSON.parse(await analysisEntry.async('string')).analysisSchemaVersion).toBe(2)
  expect(remoteRequests).toHaveLength(installedRequestCount)
})
