const { test, expect } = require('@playwright/test')
const { experiment } = require('../fixtures/experiment.js')

async function installShareMock(page, { canShare = true } = {}) {
  await page.addInitScript(({ canShare }) => {
    Object.defineProperty(navigator, 'canShare', { value: () => canShare, configurable: true })
    Object.defineProperty(navigator, 'share', {
      value: async data => {
        const file = data.files[0]
        window.__shared = { name: file.name, type: file.type, text: await file.text(), title: data.title, body: data.text }
      },
      configurable: true
    })
  }, { canShare })
}

async function installNoShareMock(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })
}

function pendingExperiment() {
  return {
    schemaVersion: 6,
    id: 'share-pending-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in-progress',
    researcher: 'Sensitive researcher',
    agent: 'Sensitive agent',
    cells: 'CHO-K1',
    negControl: 'Secret control',
    posControl: '',
    solControl: '',
    nucleoidsPerGel: 1,
    slidesPerTreatment: 1,
    concUnit: 'uM',
    treatments: ['Secret control'],
    progress: null,
    treatmentMetadata: [{ treatmentIndex: 0, role: 'negative-control', concentration: null }],
    studyDesign: { version: 1, status: 'unconfigured', assayType: null, primaryReferenceTreatmentIndex: null, primaryTreatmentIndices: [], validationComparison: null, alpha: 0.05, alternative: 'two-sided', pAdjustment: 'holm', trendReferenceAsZero: true, configurationSource: null },
    slideEditHistory: [],
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

test('shares the summary JSON as a .txt file', async ({ page }) => {
  const data = experiment({ id: 'share-summary-test', agent: 'Share Agent', treatments: ['Control'], negControl: 'Control' })
  await installShareMock(page)
  await page.addInitScript(d => localStorage.setItem('cometquant-experiments', JSON.stringify([d])), data)
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await page.getByRole('button', { name: 'Share Data (.json)' }).click()

  const shared = await page.evaluate(() => window.__shared)
  expect(shared.name).toMatch(/^CometQuant_Share_Agent_.*\.json\.txt$/)
  expect(shared.type).toBe('text/plain')
  expect(shared.text).toContain('"agent": "Share Agent"')
})

test('shares only the encrypted backup for a pending experiment', async ({ page }) => {
  const data = pendingExperiment()
  const passphrase = 'a secure backup password'
  await installShareMock(page)
  await page.addInitScript(d => localStorage.setItem('cometquant-experiments', JSON.stringify([d])), data)
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).click()

  const passwordDialog = page.locator('#backup-password-dialog')
  await expect(passwordDialog).toBeVisible()
  await page.locator('#backup-password').fill(passphrase)
  await page.locator('#backup-password-confirmation').fill(passphrase)
  await passwordDialog.getByRole('button', { name: 'Continue' }).click()
  await page.waitForFunction(() => window.__shared !== undefined)

  const shared = await page.evaluate(() => window.__shared)
  expect(shared.name).toMatch(/^CometQuant_blinded_.*\.cqbackup\.txt$/)
  expect(shared.type).toBe('text/plain')
  expect(shared.text).not.toContain('Sensitive agent')
  expect(shared.text).not.toContain('Secret control')
  expect(shared.text).not.toContain('ABCD-01')
})

test('confirms before sharing plaintext mapping during blinding', async ({ page }) => {
  await installShareMock(page)
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

  let confirmMessage = ''
  page.once('dialog', async dialog => {
    confirmMessage = dialog.message()
    await dialog.accept()
  })
  await page.locator('#btn-share-blind-json').click()
  expect(confirmMessage).toContain('texto claro')
})

test('falls back with guidance when the file cannot be shared', async ({ page }) => {
  const data = experiment({ id: 'share-fallback-test', agent: 'Share Agent', treatments: ['Control'], negControl: 'Control' })
  await installShareMock(page, { canShare: false })
  await page.addInitScript(d => localStorage.setItem('cometquant-experiments', JSON.stringify([d])), data)
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()

  let message = ''
  page.once('dialog', async dialog => {
    message = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Share Data (.json)' }).click()
  expect(message).toContain('file manager')
})

test('hides share buttons when the Web Share API is unavailable', async ({ page }) => {
  const data = experiment({ id: 'share-hidden-test', agent: 'Share Agent', treatments: ['Control'], negControl: 'Control' })
  await installNoShareMock(page)
  await page.addInitScript(d => localStorage.setItem('cometquant-experiments', JSON.stringify([d])), data)
  await page.goto('/')
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Open Experiment Summary' }).click()
  await expect(page.locator('#btn-share-experiment')).toBeHidden()
})
