const { test, expect } = require('@playwright/test')

test('creates a blinded mobile experiment and blocks revealing summary', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: 'PT' }).click()
  await page.getByRole('button', { name: 'Novo Experimento' }).click()
  await page.locator('#input-agent').fill('Agente teste')
  await page.locator('#input-cells').fill('CHO-K1')
  await page.locator('#input-neg-control').fill('PBS')
  await page.locator('#input-nucleoids').fill('10')
  await page.locator('#input-slides-per-treatment').fill('1')
  await page.locator('#input-conditions').fill('1')
  await page.locator('#input-conc-unit').selectOption('µM')
  await page.locator('#input-conc-0').fill('5')
  await page.getByRole('button', { name: 'Salvar Experimento e Gerar Códigos' }).click()
  await expect(page.locator('#screen-blind-codes')).toHaveClass(/active/)
  await expect(page.locator('.blind-code-card')).toHaveCount(2)
  await page.getByRole('button', { name: /Identifiquei as lâminas/ }).click()
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
  await page.goto('/')
  await page.evaluate(experiment => localStorage.setItem('cometquant-experiments', JSON.stringify([experiment])), data)
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
  await page.locator('#input-blind-code').fill('abcd-01')
  await page.getByRole('button', { name: 'Start Counting' }).click()
  await page.locator('#card-class-2').click()
  await expect(page.locator('#count-2')).toHaveText('1')
  await page.reload()
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Continue Counting' }).click()
  await expect(page.locator('#counter-treatment-name')).toHaveText('ABCD-01')
  await expect(page.locator('#count-2')).toHaveText('1')
  await page.getByRole('button', { name: /Undo last/ }).click()
  await expect(page.locator('#count-2')).toHaveText('0')
})
