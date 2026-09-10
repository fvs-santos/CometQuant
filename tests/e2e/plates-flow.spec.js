const { test, expect } = require('@playwright/test')

function reportHtml() {
  const doseRows = [
    ['Controle', 'Controle negativo', '-', 1, 8, 10],
    ['Controle', 'Controle negativo', '-', 2, 10, 10],
    ['Controle', 'Controle negativo', '-', 3, 12, 10],
    ['1,0 µM', 'Concentração teste', '1,0 µM', 1, 18, 20],
    ['1,0 µM', 'Concentração teste', '1,0 µM', 2, 20, 20],
    ['1,0 µM', 'Concentração teste', '1,0 µM', 3, 22, 20],
    ['MMS', 'Controle positivo', '-', 1, 48, 50],
    ['MMS', 'Controle positivo', '-', 2, 50, 50],
    ['MMS', 'Controle positivo', '-', 3, 52, 50]
  ]
  const rows = doseRows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="pt-BR"><body>
    <header><div class="metadata"><p><strong>Agente:</strong> Composto X</p><p><strong>Tipo celular:</strong> V79</p></div></header>
    <section id="dose-overview"><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Papel</th><th>Concentração</th><th>Repetição</th><th>Score visual</th><th>Média do motor</th>
    </tr></thead><tbody>${rows}</tbody></table></div></section>
    <section id="primary-means"><div class="column-chart"><svg>
      <rect class="column-bar" x="10" width="10"></rect><rect class="column-bar" x="30" width="10"></rect>
      <text class="holm-marker" x="35">*</text>
    </svg><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Média</th><th>DP</th><th>n (experimentos independentes)</th><th>p Holm</th><th>Resultado estatístico</th>
    </tr></thead><tbody>
      <tr><td>Controle</td><td>10</td><td>2</td><td>3</td><td>-</td><td>REFERÊNCIA</td></tr>
      <tr><td>1,0 µM</td><td>20</td><td>2</td><td>3</td><td>0,01</td><td>SIGNIFICATIVO</td></tr>
    </tbody></table></div></div></section>
    <section id="control"><table><thead><tr><th>Tratamento</th><th>Resultado estatístico</th></tr></thead><tbody><tr><td>MMS</td><td>SIGNIFICATIVO</td></tr></tbody></table></section>
  </body></html>`
}

function antigenotoxicReportHtml() {
  const metadata = ' data-assay-type="antigenotoxicity" data-primary-reference="1" data-validation-reference="0" data-validation-treatment="1"'
  const doseRows = [
    [0, 'Control', 'Negative control', 'validation', '-', 1, 8, 10],
    [0, 'Control', 'Negative control', 'validation', '-', 2, 10, 10],
    [0, 'Control', 'Negative control', 'validation', '-', 3, 12, 10],
    [1, 'MMS', 'Positive control', 'primary', '-', 1, 48, 50],
    [1, 'MMS', 'Positive control', 'primary', '-', 2, 50, 50],
    [1, 'MMS', 'Positive control', 'primary', '-', 3, 52, 50],
    [2, '1.0 uM', 'Test concentration', 'primary', '1.0 uM', 1, 18, 20],
    [2, '1.0 uM', 'Test concentration', 'primary', '1.0 uM', 2, 20, 20],
    [2, '1.0 uM', 'Test concentration', 'primary', '1.0 uM', 3, 22, 20]
  ]
  const rows = doseRows.map(row => `<tr data-treatment-index="${row[0]}" data-role="${row[2].toLowerCase().replace(/ /g, '-')}" data-population="${row[3]}">${row.slice(1, 3).concat(row.slice(4)).map(value => `<td>${value}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><body>
    <header><div class="metadata"><p><strong>Agent:</strong> Compound X</p><p><strong>Cell type:</strong> V79</p></div></header>
    <section id="dose-overview"${metadata}><div class="sr-only"><table><thead><tr>
      <th>Treatment</th><th>Role</th><th>Concentration</th><th>Replicate</th><th>Visual score</th><th>Engine mean</th>
    </tr></thead><tbody>${rows}</tbody></table></div></section>
    <section id="primary-means"${metadata}><div class="column-chart"><svg>
      <rect class="column-bar" x="10" width="10"></rect><rect class="column-bar" x="30" width="10"></rect><text class="holm-marker" x="35">*</text>
    </svg><div class="sr-only"><table><thead><tr>
      <th>Treatment</th><th>Mean</th><th>SD</th><th>n (independent experiments)</th><th>Holm p</th><th>Statistical result</th>
    </tr></thead><tbody>
      <tr data-treatment-index="1" data-role="positive-control" data-primary-reference="true"><td>MMS</td><td>50</td><td>2</td><td>3</td><td>-</td><td>REFERENCE</td></tr>
      <tr data-treatment-index="2" data-role="test-concentration" data-primary-reference="false"><td>1.0 uM</td><td>20</td><td>2</td><td>3</td><td>0.01</td><td>SIGNIFICANT</td></tr>
    </tbody></table></div></div></section>
    <section id="control"${metadata}><table><thead><tr><th>Reference</th><th>Treatment</th><th>Statistical result</th></tr></thead><tbody><tr data-validation-reference="0" data-validation-treatment="1"><td>Control</td><td>MMS</td><td>SIGNIFICANT</td></tr></tbody></table></section>
  </body></html>`
}

function inspectTiff(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  expect(view.getUint16(0, true)).toBe(0x4949)
  expect(view.getUint16(2, true)).toBe(42)
  const ifd = view.getUint32(4, true)
  const count = view.getUint16(ifd, true)
  const tags = new Map()
  for (let index = 0; index < count; index += 1) {
    const offset = ifd + 2 + index * 12
    const id = view.getUint16(offset, true)
    const type = view.getUint16(offset + 2, true)
    tags.set(id, type === 3 ? view.getUint16(offset + 8, true) : view.getUint32(offset + 8, true))
  }
  return tags
}

test('opens the isolated plate generator from the home screen', async ({ page }) => {
  await page.goto('/index.html')
  const link = page.getByRole('link', { name: 'Generate Plates' })
  await expect(link).toHaveAttribute('href', './plates.html')
  await link.click()
  await expect(page).toHaveURL(/\/plates\.html$/)
  await expect(page.getByRole('heading', { name: 'Pranchas CometQuant' })).toBeVisible()
  await expect(page.getByText('Use preferencialmente um computador desktop.')).toBeVisible()
})

test('validates a report and generates a standards-compliant TIFF', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/plates.html')
  await page.locator('#plate-files').setInputFiles({
    name: 'cometquant_report.html',
    mimeType: 'text/html',
    buffer: Buffer.from(reportHtml())
  })

  await expect(page.locator('#metadata-section')).toBeVisible()
  await expect(page.locator('#metadata-body input').nth(0)).toHaveValue('Composto X')
  await expect(page.locator('#metadata-body input').nth(1)).toHaveValue('V79')
  await page.locator('#height-cm').fill('1')
  await page.locator('#width-cm').fill('1')
  await page.locator('#grid-rows').fill('1')
  await page.locator('#grid-cols').fill('1')
  await page.locator('#grid-cols').blur()
  await page.getByRole('button', { name: 'Validar layout' }).click()
  await expect(page.locator('#plate-message')).toContainText('Layout válido')

  await page.getByRole('button', { name: 'Gerar TIFF' }).click()
  await expect(page.locator('#plate-message')).toContainText('Prancha gerada e validada', { timeout: 30000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Baixar prancha.tiff' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const tags = inspectTiff(Buffer.concat(chunks))

  expect(tags.get(256)).toBe(236)
  expect(tags.get(257)).toBe(236)
  expect(tags.get(258)).toBe(8)
  expect(tags.get(259)).toBe(5)
  expect(tags.get(262)).toBe(1)
  expect(tags.get(277)).toBe(1)
  expect(tags.get(296)).toBe(2)
})

test('detects antigenotoxicity and places the basal validation control on the left', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/plates.html')
  await page.locator('#plate-files').setInputFiles({
    name: 'antigenotoxicity_report.html',
    mimeType: 'text/html',
    buffer: Buffer.from(antigenotoxicReportHtml())
  })

  await expect(page.locator('#metadata-body select')).toHaveValue('antigenotoxicity')
  await expect(page.locator('#positive-position')).toHaveValue('left')
  await page.locator('#height-cm').fill('1')
  await page.locator('#width-cm').fill('1')
  await page.locator('#grid-rows').fill('1')
  await page.locator('#grid-cols').fill('1')
  await page.getByRole('button', { name: 'Validar layout' }).click()
  await expect(page.locator('#plate-message')).toContainText('Layout válido')
})
