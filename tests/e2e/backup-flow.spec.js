const fs = require('node:fs')
const { test, expect } = require('@playwright/test')

test('exports and restores a blinded experiment only through encrypted backup', async ({ page }) => {
  const experiment = {
    schemaVersion: 3,
    id: 'encrypted-backup-test',
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
    replicates: [{
      replicateNumber: 1,
      date: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      gels: [],
      assignments: [{ blindCode: 'ABCD-01', treatmentIndex: 0, gelNumber: 1, status: 'pending' }]
    }]
  }
  const passphrase = 'a secure backup password'
  await page.goto('/')
  await page.evaluate(data => localStorage.setItem('cometquant-experiments', JSON.stringify([data])), experiment)
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Encrypted Blinded Backup' }).click()
  const passwordDialog = page.locator('#backup-password-dialog')
  await expect(passwordDialog).toBeVisible()
  await expect(page.locator('#backup-password')).toHaveAttribute('type', 'password')
  await expect(page.locator('#backup-password-confirmation')).toHaveAttribute('type', 'password')
  await page.locator('#backup-password').fill(passphrase)
  await page.locator('#backup-password-confirmation').fill(passphrase)
  await passwordDialog.getByRole('button', { name: 'Continue' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  const contents = fs.readFileSync(downloadPath, 'utf8')
  const envelope = JSON.parse(contents)
  expect(download.suggestedFilename()).toMatch(/^CometQuant_blinded_.*\.cqbackup\.json$/)
  expect(envelope.format).toBe('cometquant-encrypted-backup')
  expect(contents).not.toContain(experiment.agent)
  expect(contents).not.toContain(experiment.negControl)
  expect(contents).not.toContain('ABCD-01')

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.locator('#input-load-files').setInputFiles(downloadPath)
  await expect(passwordDialog).toBeVisible()
  await expect(page.locator('#backup-password')).toHaveAttribute('type', 'password')
  await page.locator('#backup-password').fill(passphrase)
  await passwordDialog.getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.experiment-card h3')).toHaveText(experiment.agent)

  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('cometquant-experiments'))[0])
  expect(restored.treatments).toEqual(experiment.treatments)
  expect(restored.replicates[0].assignments[0].blindCode).toBe('ABCD-01')
})
