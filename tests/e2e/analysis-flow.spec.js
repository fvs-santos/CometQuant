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
    const total = completion === 'complete' ? 100 : 0
    replicate.gels.push({
      blindCode,
      treatment: row.treatment,
      treatmentIndex,
      gelNumber,
      class0: completion === 'complete' ? total - score : 0,
      class1: 0,
      class2: 0,
      class3: 0,
      class4: completion === 'complete' ? score : 0,
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

async function confirmAllRepetitions(page) {
  await expect(page.getByRole('dialog', { name: 'Select repetitions' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to analysis' }).click()
}

test('selects repetitions explicitly and requires a reason for exclusions', async ({ page }) => {
  await page.addInitScript(experiment => localStorage.setItem('cometquant-experiments', JSON.stringify([experiment])), referenceExperiment())
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Statistical Analysis' }).click()

  const dialog = page.getByRole('dialog', { name: 'Select repetitions' })
  await expect(dialog.getByRole('checkbox')).toHaveCount(3)
  await dialog.getByRole('button', { name: 'Clear all' }).click()
  await dialog.getByRole('button', { name: 'Continue to analysis' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Select at least one repetition.')

  await dialog.getByRole('checkbox').nth(0).check()
  await dialog.getByRole('checkbox').nth(2).check()
  await dialog.getByRole('button', { name: 'Continue to analysis' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a general reason for the excluded repetitions.')
  await dialog.getByLabel('General reason for excluding repetitions').fill('Predefined instrument exclusion')
  await dialog.getByRole('button', { name: 'Continue to analysis' }).click()

  await expect(page.locator('#screen-analysis')).toHaveClass(/active/)
  await expect(page.locator('#analysis-selection-summary-text')).toContainText('Selected: 1, 3. Excluded: 2.')
  await expect(page.locator('#analysis-selection-summary-reason')).toContainText('Predefined instrument exclusion')
})

test('runs the extracted Python engine in Pyodide with reference results', async ({ page, browserName }, testInfo) => {
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
  await confirmAllRepetitions(page)

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
  await confirmAllRepetitions(page)
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
  await expect(page.locator('#section-analysis-non-parametric .result-title')).toHaveText('Non-parametric Sensitivity')
  await expect(page.locator('#analysis-non-parametric')).not.toContainText('analysis.v2.')
  await expect(page.locator('#section-analysis-transformed .result-title')).toHaveText('Transformed Sensitivity')
  await expect(page.locator('#analysis-transformed')).not.toContainText('analysis.v2.')
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
    'report.html', 'data/analysis.json', 'data/study_design.csv', 'data/population.csv', 'data/block_anova.csv',
    'data/primary_comparisons.csv', 'data/control_response.csv', 'data/dose_trend.csv',
    'data/non_parametric.csv', 'data/transformed_analysis.csv', 'data/slide_corrections.csv',
    'charts/block_scores.png', 'charts/primary_differences.png', 'charts/class_distribution.png'
  ]) {
    expect(archivedNames.some(name => name.endsWith(suffix))).toBe(true)
  }
  const analysisEntry = archive.file(archivedNames.find(name => name.endsWith('data/analysis.json')))
  const analysisJson = JSON.parse(await analysisEntry.async('string'))
  expect(analysisJson.analysisSchemaVersion).toBe(3)
  expect(analysisJson.selection).toMatchObject({
    performed: true,
    availableBlockNumbers: [1, 2, 3],
    selectedBlockNumbers: [1, 2, 3],
    excludedBlockNumbers: [],
    exclusionReason: null
  })
  expect(analysisJson.nonParametric.performed).toBe(true)
  expect(analysisJson.nonParametric.friedman.pExact).toBeCloseTo(expected.nonParametric.friedman.pExact, 7)
  expect(analysisJson.nonParametric.pageTrend.direction).toBe('increasing')
  expect(analysisJson.transformedAnalysis.scale).toBe('arcsin_sqrt')
  const reportEntry = archive.file(archivedNames.find(name => name.endsWith('report.html')))
  const reportHtml = await reportEntry.async('string')
  expect(reportHtml).toContain('Síntese das evidências')
  expect(reportHtml).toContain('Efeito na direção esperada detectado')
  expect(reportHtml).toContain('Relação dose-resposta')
  expect(reportHtml).toContain('<svg viewBox="0 0 900 500"')
  expect(reportHtml).toContain('<svg viewBox="0 0 900 520"')
  expect(reportHtml).not.toMatch(/<link\b|<script\b|https?:\/\//)
  const reportPath = testInfo.outputPath('CometQuant_reference_report_pt.html')
  fs.writeFileSync(reportPath, reportHtml)
  await testInfo.attach('reference-report', { path: reportPath, contentType: 'text/html' })

  const reportPage = await page.context().newPage()
  const reportRequests = []
  reportPage.on('request', request => reportRequests.push(request.url()))
  await reportPage.setContent(reportHtml)
  await expect(reportPage.locator('.status-card')).toHaveCount(3)
  await expect(reportPage.locator('.dose-chart svg .chart-label')).toHaveCount(5)
  await expect(reportPage.locator('.dose-chart .data-point')).toHaveCount(15)
  await expect(reportPage.locator('.column-chart .column-bar')).toHaveCount(analysisJson.primaryComparisons.comparisons.length + 1)
  await expect(reportPage.locator('.column-chart .holm-marker')).toHaveCount(analysisJson.primaryComparisons.comparisons.filter(row => row.significant).length)
  await expect(reportPage.locator('.column-chart .sr-only')).toContainText('experimentos independentes')
  await expect(reportPage.locator('.report-footer')).toContainText('analysis-reference')
  await expect(reportPage.locator('.report-footer')).toContainText('2.2.0')
  const indexLinks = reportPage.locator('.report-index a')
  expect(await indexLinks.count()).toBeGreaterThan(10)
  for (let index = 0; index < await indexLinks.count(); index += 1) {
    const href = await indexLinks.nth(index).getAttribute('href')
    await expect(reportPage.locator(href)).toHaveCount(1)
  }
  await expect(reportPage.locator('link, script, iframe, object, embed')).toHaveCount(0)
  expect(reportRequests).toEqual([])
  await expect(reportPage.locator('#raw details')).not.toHaveAttribute('open', '')
  await reportPage.close()

  await page.getByRole('button', { name: 'Alterar seleção' }).click()
  const selectionDialog = page.getByRole('dialog', { name: 'Selecionar repetições' })
  await selectionDialog.getByRole('checkbox').nth(1).uncheck()
  await selectionDialog.getByLabel('Justificativa geral para excluir repetições').fill('Falha instrumental predefinida')
  await selectionDialog.getByRole('button', { name: 'Continuar para análise' }).click()
  await expect(page.locator('#analysis-results')).toBeHidden()
  await page.getByRole('button', { name: 'Rodar Análise' }).click()
  await expect(page.locator('#analysis-results')).toBeVisible({ timeout: 60000 })
  const subset = await page.evaluate(() => ({ selection: analysisResults.selection, population: analysisResults.population }))
  expect(subset.selection).toMatchObject({
    selectedBlockNumbers: [1, 3], excludedBlockNumbers: [2], exclusionReason: 'Falha instrumental predefinida'
  })
  expect(subset.population.primary.includedBlockNumbers).toEqual([1, 3])
  expect(subset.population.validation.includedBlockNumbers).toEqual([1, 3])
  expect(subset.population.blocks.find(block => block.replicateNumber === 2)).toMatchObject({
    selected: false, primaryEligible: true, primaryIncluded: false, validationEligible: true, validationIncluded: false
  })
  expect(remoteRequests).toHaveLength(installedRequestCount)
})
