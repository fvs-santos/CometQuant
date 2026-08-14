const { test, expect } = require('@playwright/test')

const experiment = {
  schemaVersion: 3,
  id: 'multi-tab-test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'in-progress',
  researcher: '',
  agent: 'Concurrent agent',
  cells: 'CHO-K1',
  negControl: 'PBS',
  posControl: '',
  solControl: '',
  nucleoidsPerGel: 10,
  slidesPerTreatment: 1,
  concUnit: 'uM',
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

async function openCodeEntry(page) {
  await page.getByRole('button', { name: 'Resume Experiment' }).click()
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Analyze Slides' }).click()
}

test('stops stale editing when another tab commits the experiment', async ({ context, page }) => {
  await context.addInitScript(data => localStorage.setItem('cometquant-experiments', JSON.stringify([data])), experiment)
  await page.goto('/')
  await openCodeEntry(page)

  const secondPage = await context.newPage()
  await secondPage.goto('/')
  await openCodeEntry(secondPage)

  let conflictMessage = ''
  secondPage.once('dialog', async dialog => {
    conflictMessage = dialog.message()
    await dialog.accept()
  })
  await page.locator('#input-blind-code').fill('ABCD-01')
  await page.getByRole('button', { name: 'Start Counting' }).click()

  await expect(secondPage.locator('#screen-experiments')).toHaveClass(/active/)
  expect(conflictMessage).toContain('changed in another tab')
})
