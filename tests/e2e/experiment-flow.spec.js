const fs = require('node:fs')
const { test, expect } = require('@playwright/test')

async function seedLegacyData(page, experiments) {
  await page.addInitScript(data => {
    localStorage.setItem('cometquant-experiments', JSON.stringify(data))
  }, experiments)
  await page.goto('/')
}

function completedCompactExperiment(id = 'compact-code-test') {
  return {
    schemaVersion: 4, id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'completed', researcher: '', agent: 'Agent', cells: 'CHO-K1', negControl: 'PBS', posControl: '', solControl: '',
    nucleoidsPerGel: 1, slidesPerTreatment: 1, concUnit: 'µM', treatments: ['PBS'], progress: null,
    replicates: [{
      replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      assignments: [{ blindCode: 'AB1', treatmentIndex: 0, gelNumber: 1, status: 'counted', recordedAt: '2026-01-01T00:00:00.000Z' }],
      gels: [{ blindCode: 'AB1', treatment: 'PBS', treatmentIndex: 0, gelNumber: 1, class0: 1, class1: 0, class2: 0, class3: 0, class4: 0, total: 1, status: 'counted', completion: 'complete', recordedAt: '2026-01-01T00:00:00.000Z' }]
    }]
  }
}

function completedLegacyAnalysisExperiment() {
  const treatments = ['Positive', 'Negative', '1 µM']
  const codes = ['AB1', 'AC1', 'AD1']
  return {
    schemaVersion: 4, id: 'legacy-analysis-plan', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'completed', researcher: '', agent: 'Legacy agent', cells: 'CHO-K1', negControl: 'Negative', posControl: 'Positive', solControl: '',
    nucleoidsPerGel: 100, slidesPerTreatment: 1, concUnit: 'µM', treatments, progress: null,
    replicates: [{
      replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      assignments: treatments.map((_, treatmentIndex) => ({ blindCode: codes[treatmentIndex], treatmentIndex, gelNumber: 1, status: 'counted' })),
      gels: treatments.map((treatment, treatmentIndex) => ({
        blindCode: codes[treatmentIndex], treatment, treatmentIndex, gelNumber: 1,
        class0: 90 - treatmentIndex, class1: 0, class2: 0, class3: 0, class4: 10 + treatmentIndex,
        total: 100, status: 'counted', completion: 'complete'
      }))
    }]
  }
}

test('creates a blinded mobile experiment and blocks revealing summary', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: 'PT' }).click()
  await page.getByRole('button', { name: 'Novo Experimento' }).click()
  await page.locator('#input-agent').fill('Agente teste')
  await page.locator('#input-cells').fill('CHO-K1')
  await page.locator('#input-assay-type').selectOption('genotoxicity')
  await page.locator('#input-neg-control').fill('PBS')
  await page.locator('#input-pos-control').fill('H2O2')
  await page.locator('#input-basal-reference').selectOption('negative-control')
  await page.locator('#input-nucleoids').fill('10')
  await page.locator('#input-slides-per-treatment').fill('2')
  await page.locator('#input-conditions').fill('1')
  await page.locator('#input-conc-unit').selectOption('µM')
  await page.locator('#input-conc-0').fill('5')
  await page.getByRole('button', { name: 'Salvar Experimento e Gerar Códigos' }).click()
  await expect(page.locator('#screen-blind-codes')).toHaveClass(/active/)
  await expect(page.locator('.blind-code-card')).toHaveCount(3)
  await expect(page.locator('#blind-backup-reminder-title')).toHaveText('Proteja a relação código-tratamento')
  await expect(page.locator('#screen-blind-codes')).toContainText('restaurar o dispositivo')
  await expect(page.locator('#screen-blind-codes')).toContainText('texto claro')
  const generatedCodes = await page.locator('.blind-code-card').evaluateAll(cards => cards.map(card => (
    Array.from(card.querySelectorAll('code'), code => code.textContent)
  )))
  generatedCodes.forEach(codes => {
    expect(codes).toHaveLength(2)
    expect(codes[0]).toMatch(/^[A-Z]{2}1$/)
    expect(codes[1]).toBe(`${codes[0].slice(0, 2)}2`)
  })
  expect(new Set(generatedCodes.map(codes => codes[0].slice(0, 2))).size).toBe(3)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#btn-export-blind-json').click()
  const download = await downloadPromise
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  expect(download.suggestedFilename()).toMatch(/^CometQuant_Agente_teste_.*\.json$/)
  expect(exported.treatments).toEqual(['H2O2', 'PBS', '5 µM'])
  expect(exported.replicates[0].assignments.map(item => item.blindCode).sort())
    .toEqual(generatedCodes.flat().sort())

  await page.getByRole('button', { name: /Identifiquei as lâminas/ }).click()
  await expect(page.locator('#replicate-backup-reminder')).toBeHidden()
  let replicateMessage = ''
  page.once('dialog', async dialog => {
    replicateMessage = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Gerar Códigos para Próxima Repetição' }).click()
  expect(replicateMessage).toContain('Conclua todas as lâminas pendentes')
  await expect(page.locator('#screen-replicates')).toHaveClass(/active/)
  let message = ''
  page.once('dialog', async dialog => {
    message = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Abrir Resumo do Experimento' }).click()
  expect(message).toContain('Conclua todas as lâminas')
})

test('autosaves each count and restores the current blinded slide', async ({ page }) => {
  const data = {
    schemaVersion: 3, id: 'resume-test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in-progress', researcher: '', agent: 'Agent', cells: 'CHO-K1', negControl: 'PBS', posControl: '', solControl: '',
    nucleoidsPerGel: 10, slidesPerTreatment: 1, concUnit: 'µM', treatments: ['PBS'],
    progress: null,
    replicates: [{ replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', gels: [], assignments: [{ blindCode: 'ABCD-01', treatmentIndex: 0, gelNumber: 1, status: 'pending' }] }]
  }
  await seedLegacyData(page, [data])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await page.locator('#input-blind-code').fill('abcd-01')
  await page.getByRole('button', { name: 'Start Counting' }).click()
  await page.locator('#card-class-2').click({ clickCount: 2 })
  await expect(page.locator('#count-2')).toHaveText('2')
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Continue Counting' }).click()
  await expect(page.locator('#counter-treatment-name')).toHaveText('ABCD-01')
  await expect(page.locator('#count-2')).toHaveText('2')
  await page.getByRole('button', { name: /Undo last/ }).click()
  await expect(page.locator('#count-2')).toHaveText('1')
})

test('reveals generated mappings before continuing a partial legacy experiment', async ({ page }) => {
  const legacy = {
    schemaVersion: 2, id: 'legacy-partial', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'completed', researcher: '', agent: 'Legacy', cells: 'CHO-K1', negControl: 'Control', posControl: '', solControl: '',
    nucleoidsPerGel: 1, slidesPerTreatment: 1, concUnit: 'uM', treatments: ['Control', '1 uM'], progress: null,
    replicates: [{
      replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      gels: [{ treatment: 'Control', gelNumber: 1, class0: 1, class1: 0, class2: 0, class3: 0, class4: 0, total: 1, status: 'counted', completion: 'complete' }]
    }]
  }
  await seedLegacyData(page, [legacy])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('#replicate-backup-reminder')).toBeHidden()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await expect(page.locator('#screen-blind-codes')).toHaveClass(/active/)
  await expect(page.locator('.blind-code-card')).toHaveCount(2)
  await page.getByRole('button', { name: /I labeled the slides/ }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await expect(page.locator('#screen-code-entry')).toHaveClass(/active/)
})

test('requires and persists a one-time analytical plan for a completed legacy experiment', async ({ page }) => {
  await seedLegacyData(page, [completedLegacyAnalysisExperiment()])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Statistical Analysis' }).click()

  await expect(page.locator('#legacy-study-design-dialog')).toBeVisible()
  await page.locator('#legacy-input-assay-type').selectOption('antigenotoxicity')
  await page.locator('#legacy-input-basal-reference').selectOption('1')
  await page.locator('#btn-save-legacy-study-design').click()
  await expect(page.getByRole('dialog', { name: 'Select repetitions' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to analysis' }).click()
  await expect(page.locator('#screen-analysis')).toHaveClass(/active/)

  const storedDesign = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments'))
    .find(item => item?.id === 'legacy-analysis-plan').studyDesign)
  expect(storedDesign).toMatchObject({
    status: 'configured',
    assayType: 'antigenotoxicity',
    primaryReferenceTreatmentIndex: 0,
    primaryTreatmentIndices: [2],
    validationComparison: { referenceTreatmentIndex: 1, treatmentIndex: 0 },
    configurationSource: 'legacy-post-collection'
  })
})

test('does not reuse compact bases across replicates and accepts spaced lowercase input', async ({ page }) => {
  const data = completedCompactExperiment()
  await seedLegacyData(page, [data])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Add Replicate' }).click()

  const generatedCode = await page.locator('.blind-code-values code').textContent()
  expect(generatedCode).toMatch(/^[A-Z]{2}1$/)
  expect(generatedCode.slice(0, 2)).not.toBe('AB')

  await page.getByRole('button', { name: /I labeled the slides/ }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await page.locator('#input-blind-code').fill(generatedCode.toLowerCase().split('').join(' '))
  await page.getByRole('button', { name: 'Start Counting' }).click()
  await expect(page.locator('#counter-treatment-name')).toHaveText(generatedCode)
})

test('edits a completed slide with an append-only correction history', async ({ page }) => {
  await seedLegacyData(page, [completedCompactExperiment('slide-edit-test')])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()

  await page.getByRole('button', { name: /Edit slide/ }).click()
  await expect(page.locator('#slide-edit-dialog')).toBeVisible()
  await expect(page.locator('#slide-edit-previous')).toContainText('1/0/0/0/0')
  await page.locator('#slide-edit-class0').fill('0')
  await page.locator('#slide-edit-class4').fill('1')
  await page.locator('#slide-edit-by').fill('Quality reviewer')
  await page.locator('#slide-edit-reason').fill('The source worksheet showed class 4.')
  await page.getByRole('button', { name: 'Save correction' }).click()

  await expect(page.locator('#slide-edit-dialog')).toBeHidden()
  await expect(page.locator('#summary-slide-edit-history')).toContainText('Quality reviewer')
  await expect(page.locator('#summary-slide-edit-history')).toContainText('The source worksheet showed class 4.')

  await page.getByRole('button', { name: /Edit slide/ }).click()
  await page.locator('#slide-edit-status').selectOption('absent')
  await page.locator('#slide-edit-absence-reason').selectOption('quality')
  await page.locator('#slide-edit-by').fill('Quality reviewer')
  await page.locator('#slide-edit-reason').fill('The slide was rejected during review.')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.locator('#summary-slide-edit-history details')).toHaveCount(2)

  await page.getByRole('button', { name: /Edit slide/ }).click()
  await page.locator('#slide-edit-status').selectOption('counted')
  await page.locator('#slide-edit-class2').fill('1')
  await page.locator('#slide-edit-by').fill('Quality reviewer')
  await page.locator('#slide-edit-reason').fill('Counts were recovered from the source worksheet.')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.locator('#summary-slide-edit-history details')).toHaveCount(3)

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments')).find(item => item.id === 'slide-edit-test'))
  expect(stored.replicates[0].assignments[0].status).toBe('counted')
  expect(stored.replicates[0].gels).toHaveLength(1)
  expect(stored.slideEditHistory).toHaveLength(3)
  expect(stored.slideEditHistory[0].before.gel.class0).toBe(1)
  expect(stored.slideEditHistory[1].after.gel).toBeNull()
  expect(stored.slideEditHistory[1].after.assignment.recordedAt).toBe(stored.slideEditHistory[1].editedAt)
  expect(stored.slideEditHistory[2].before.gel).toBeNull()
  expect(stored.slideEditHistory[2].after.gel.class2).toBe(1)
  expect(stored.slideEditHistory[2].after.gel.recordedAt).toBe(stored.slideEditHistory[2].editedAt)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Data (.json)' }).click()
  const exported = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'))
  expect(exported.slideEditHistory).toHaveLength(3)
})

test('blocks a new replicate when compact bases are exhausted', async ({ page }) => {
  await seedLegacyData(page, [completedCompactExperiment('exhausted-code-test')])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.evaluate(() => { CometQuantCore.availableBlindCodeBases = () => [] })

  let message = ''
  page.once('dialog', async dialog => {
    message = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Add Replicate' }).click()
  expect(message).toContain('not enough blind codes')
  await expect(page.locator('#screen-summary')).toHaveClass(/active/)
})

test('keeps the previous state when storage commits fail and allows retry', async ({ page }) => {
  const data = {
    schemaVersion: 3, id: 'transaction-test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in-progress', researcher: '', agent: 'Agent', cells: 'CHO-K1', negControl: 'PBS', posControl: '', solControl: '',
    nucleoidsPerGel: 1, slidesPerTreatment: 1, concUnit: 'µM', treatments: ['PBS'], progress: null,
    replicates: [{ replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', gels: [], assignments: [{ blindCode: 'ABCD-01', treatmentIndex: 0, gelNumber: 1, status: 'pending' }] }]
  }
  page.once('dialog', dialog => dialog.accept())
  await seedLegacyData(page, [null, data, { schemaVersion: 999, id: 'future-version' }])
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await expect(page.getByRole('button', { name: 'Export Storage Recovery' })).toBeVisible()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await page.locator('#input-blind-code').fill('ABCD-01')
  await page.getByRole('button', { name: 'Start Counting' }).click()

  await page.evaluate(() => {
    window.__failStorageWrites = true
    window.__originalRepositoryPut = CometQuantRepository.put
    CometQuantRepository.put = function (...args) {
      if (window.__failStorageWrites) return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
      return window.__originalRepositoryPut(...args)
    }
  })

  await page.locator('#card-class-2').click()
  await expect(page.locator('#count-2')).toHaveText('0')
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments')).find(item => item?.id === 'transaction-test'))
  expect(stored.progress.counts).toEqual([0, 0, 0, 0, 0])

  await page.evaluate(() => { window.__failStorageWrites = false })
  await page.locator('#card-class-2').click()
  await expect(page.locator('#count-2')).toHaveText('1')

  await page.evaluate(() => { window.__failStorageWrites = true })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Finish Slide' }).click()
  await expect(page.locator('#screen-counter')).toHaveClass(/active/)
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments')).find(item => item?.id === 'transaction-test'))
  expect(stored.replicates[0].assignments[0].status).toBe('counting')
  expect(stored.replicates[0].gels).toHaveLength(0)

  await page.evaluate(() => { window.__failStorageWrites = false })
  await page.getByRole('button', { name: 'Finish Slide' }).click()
  await expect(page.locator('#screen-replicates')).toHaveClass(/active/)
  await expect(page.locator('#replicate-backup-reminder')).toBeVisible()
  await expect(page.locator('#replicate-backup-reminder')).toContainText('At least one replicate is complete')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#btn-export-replicate-json').click()
  const download = await downloadPromise
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  expect(exported.replicates[0].assignments[0]).toMatchObject({ blindCode: 'ABCD-01', treatmentIndex: 0, status: 'counted' })

  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()

  await page.evaluate(() => { window.__failStorageWrites = true })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Add Replicate' }).click()
  await expect(page.locator('#screen-summary')).toHaveClass(/active/)
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments')).find(item => item?.id === 'transaction-test'))
  expect(stored.replicates).toHaveLength(1)

  await page.evaluate(() => { window.__failStorageWrites = false })
  await page.getByRole('button', { name: 'Add Replicate' }).click()
  await expect(page.locator('#screen-blind-codes')).toHaveClass(/active/)
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments')).find(item => item?.id === 'transaction-test'))
  expect(stored.replicates).toHaveLength(2)
  const quarantined = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('cometquant', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const getAll = request.result.transaction('quarantine', 'readonly').objectStore('quarantine').getAll()
      getAll.onerror = () => reject(getAll.error)
      getAll.onsuccess = () => resolve(getAll.result)
    }
  }))
  expect(quarantined).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: expect.stringContaining('invalid') }),
    expect.objectContaining({ reason: 'future-schema-version' })
  ]))
})
