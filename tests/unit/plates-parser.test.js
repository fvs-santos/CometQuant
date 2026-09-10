const parser = require('../../js/plates/parser.js')

function reportHtml({ referenceRole = 'Controle negativo', referenceName = 'Controle', referenceResult = 'REFERÊNCIA', referenceScores = [8, 10, 12], referenceEngineMean = 10, referenceReportedMean = 10, referenceReportedSd = 2, extraRows = [] } = {}) {
  const rows = [
    ...referenceScores.map((score, index) => [referenceName, referenceRole, '-', index + 1, score, referenceEngineMean]),
    ['1,0 µM', 'Concentração teste', '1,0 µM', 1, 18, 20],
    ['1,0 µM', 'Concentração teste', '1,0 µM', 2, 20, 20],
    ['1,0 µM', 'Concentração teste', '1,0 µM', 3, 22, 20],
    ['MMS', 'Controle positivo', '-', 1, 48, 50],
    ['MMS', 'Controle positivo', '-', 2, 50, 50],
    ['MMS', 'Controle positivo', '-', 3, 52, 50],
    ...extraRows
  ]
  return `<!doctype html><html><body>
    <header><div class="metadata"><p><strong>Agente:</strong> Composto X</p><p><strong>Tipo celular:</strong> V79</p></div></header>
    <script>globalThis.platesScriptExecuted = true</script>
    <section id="dose-overview"><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Papel</th><th>Concentração</th><th>Repetição</th><th>Score visual</th><th>Média do motor</th>
    </tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    <section id="primary-means"><div class="column-chart"><svg>
      <rect class="column-bar" x="10" width="10"></rect><rect class="column-bar" x="30" width="10"></rect>
      <text class="holm-marker" x="35">*</text>
    </svg><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Média</th><th>DP</th><th>n (experimentos independentes)</th><th>p Holm</th><th>Resultado estatístico</th>
    </tr></thead><tbody>
      <tr><td>${referenceName}</td><td>${referenceReportedMean}</td><td>${referenceReportedSd}</td><td>${referenceScores.length}</td><td>-</td><td>${referenceResult}</td></tr>
      <tr><td>1,0 µM</td><td>20</td><td>2</td><td>3</td><td>0,01</td><td>SIGNIFICATIVO</td></tr>
    </tbody></table></div></div></section>
    <section id="control"><table><thead><tr><th>Tratamento</th><th>Resultado estatístico</th></tr></thead><tbody><tr><td>MMS</td><td>SIGNIFICATIVO</td></tr></tbody></table></section>
  </body></html>`
}

function antigenotoxicReportHtml({ basalRole = 'Controle negativo', basalName = 'Controle basal', extraRows = [], structured = true, validation = true, replicateCount = 3 } = {}) {
  const metadata = structured ? ' data-assay-type="antigenotoxicity" data-primary-reference="1" data-validation-reference="0" data-validation-treatment="1"' : ''
  const repetitions = Array.from({ length: replicateCount }, (_, index) => index + 1)
  const treatmentRows = [
    ...repetitions.map((replicate, index) => [1, 'Positive control', 'Controle positivo', 'primary', '-', replicate, 48 + index * 2, 50]),
    ...repetitions.map((replicate, index) => [2, '1,0 µM', 'Concentração teste', 'primary', '1,0 µM', replicate, 18 + index * 2, 20]),
    ...(validation ? repetitions.map((replicate, index) => [0, basalName, basalRole, 'validation', '-', replicate, 8 + index * 2, 10]) : []),
    ...extraRows
  ]
  const doseRows = treatmentRows.map(row => {
    const attrs = structured ? ` data-treatment-index="${row[0]}" data-role="${parser.normalize(row[2]).includes('positivo') ? 'positive-control' : parser.normalize(row[2]).includes('solvente') ? 'solvent-control' : parser.normalize(row[2]).includes('negativo') ? 'negative-control' : 'test-concentration'}" data-population="${row[3]}"` : ''
    return `<tr${attrs}>${row.slice(1, 3).concat(row.slice(4)).map(value => `<td>${value}</td>`).join('')}</tr>`
  }).join('')
  const sd = replicateCount > 1 ? '2' : 'Não estimável'
  const primaryAttrs = index => structured ? ` data-treatment-index="${index}" data-role="${index === 1 ? 'positive-control' : 'test-concentration'}" data-primary-reference="${index === 1}"` : ''
  const control = validation
    ? `<section id="control"${metadata}><table><thead><tr><th>Referência</th><th>Tratamento</th><th>Resultado estatístico</th></tr></thead><tbody><tr${structured ? ' data-validation-reference="0" data-validation-treatment="1"' : ''}><td>${basalName}</td><td>Positive control</td><td>SIGNIFICATIVO</td></tr></tbody></table></section>`
    : '<section id="control"><table><thead><tr><th>Referência</th><th>Tratamento</th><th>Resultado estatístico</th></tr></thead><tbody><tr><td>-</td><td>-</td><td>Não realizado</td></tr></tbody></table></section>'
  return `<!doctype html><html><body>
    <header><div class="metadata"><p><strong>Agente:</strong> Composto X</p><p><strong>Tipo celular:</strong> V79</p></div></header>
    <section id="dose-overview"${metadata}><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Papel</th><th>Concentração</th><th>Repetição</th><th>Score visual</th><th>Média do motor</th>
    </tr></thead><tbody>${doseRows}</tbody></table></div></section>
    <section id="primary-means"${metadata}><div class="column-chart"><svg>
      <rect class="column-bar" x="10" width="10"></rect><rect class="column-bar" x="30" width="10"></rect>
      <text class="holm-marker" x="35">*</text>
    </svg><div class="sr-only"><table><thead><tr>
      <th>Tratamento</th><th>Média</th><th>DP</th><th>n (experimentos independentes)</th><th>p Holm</th><th>Resultado estatístico</th>
    </tr></thead><tbody>
      <tr${primaryAttrs(1)}><td>Positive control</td><td>50</td><td>${sd}</td><td>${replicateCount}</td><td>-</td><td>REFERÊNCIA</td></tr>
      <tr${primaryAttrs(2)}><td>1,0 µM</td><td>20</td><td>${sd}</td><td>${replicateCount}</td><td>0,01</td><td>SIGNIFICATIVO</td></tr>
    </tbody></table></div></div></section>
    <section id="protocol"><table><tbody><tr><td>Tipo de ensaio</td><td>Antigenotoxicidade</td></tr><tr><td>Tratamento de referência principal</td><td>Positive control</td></tr><tr><td>Comparação de validação</td><td>0 / 1</td></tr></tbody></table></section>
    ${control}
  </body></html>`
}

describe('plates report parser', () => {
  it('parses current Portuguese genotoxicity reports without executing scripts', () => {
    delete globalThis.platesScriptExecuted
    const report = parser.parseReport(reportHtml(), { filename: 'report.html' }, { DOMParser })

    expect(report).toMatchObject({ agent: 'Composto X', cellType: 'V79', referenceMean: 10, positiveControlSignificant: true })
    expect(report.treatments).toHaveLength(2)
    expect(report.treatments[1]).toMatchObject({ concentration: 1, concentrationUnit: 'µM', mean: 20, sd: 2, isSignificant: true })
    expect(report.positiveControl).toMatchObject({ label: 'MMS', mean: 50, sd: 2, role: 'positive_control' })
    expect(globalThis.platesScriptExecuted).toBeUndefined()
  })

  it('accepts a solvent control as the report reference', () => {
    const report = parser.parseReport(reportHtml({ referenceRole: 'Controle do solvente', referenceName: 'DMSO' }), { filename: 'solvent.html' }, { DOMParser })
    expect(report.treatments[0]).toMatchObject({ label: 'DMSO', role: 'solvent_control', isReference: true })
  })

  it.each([
    ['G-N', reportHtml(), 'genotoxicity', 'MMS', 'positive_control'],
    ['G-S', reportHtml({ referenceRole: 'Controle do solvente', referenceName: 'DMSO' }), 'genotoxicity', 'MMS', 'positive_control'],
    ['G-NS', reportHtml({ extraRows: [['DMSO', 'Controle do solvente', '-', 1, 9, 9], ['DMSO', 'Controle do solvente', '-', 2, 9, 9], ['DMSO', 'Controle do solvente', '-', 3, 9, 9]] }), 'genotoxicity', 'MMS', 'positive_control'],
    ['A-N', antigenotoxicReportHtml(), 'antigenotoxicity', 'Controle basal', 'negative_control'],
    ['A-S', antigenotoxicReportHtml({ basalRole: 'Controle do solvente', basalName: 'DMSO' }), 'antigenotoxicity', 'DMSO', 'solvent_control'],
    ['A-NS', antigenotoxicReportHtml({ extraRows: [[3, 'DMSO', 'Controle do solvente', 'validation', '-', 1, 9, 9], [3, 'DMSO', 'Controle do solvente', 'validation', '-', 2, 9, 9], [3, 'DMSO', 'Controle do solvente', 'validation', '-', 3, 9, 9]] }), 'antigenotoxicity', 'Controle basal', 'negative_control']
  ])('resolves the %s study design without duplicating the primary reference', (_, html, assayType, supplementalLabel, supplementalRole) => {
    const report = parser.parseReport(html, { filename: `${assayType}.html` }, { DOMParser })
    expect(report.assayType).toBe(assayType)
    expect(report.positiveControl).toMatchObject({ label: supplementalLabel, role: supplementalRole })
    expect(report.treatments.some(item => item.id === report.supplementalTreatmentId)).toBe(false)
  })

  it('uses the protocol and visible validation pair for an older antigenotoxicity report', () => {
    const report = parser.parseReport(antigenotoxicReportHtml({ structured: false }), { filename: 'legacy-anti.html' }, { DOMParser })
    expect(report).toMatchObject({ assayType: 'antigenotoxicity', positiveControlSignificant: true })
    expect(report.positiveControl).toMatchObject({ label: 'Controle basal', role: 'negative_control' })
  })

  it('keeps a primary-only report usable when validation is not estimable and tolerates n=1', () => {
    const report = parser.parseReport(antigenotoxicReportHtml({ validation: false, replicateCount: 1 }), { filename: 'partial.html' }, { DOMParser })
    expect(report.positiveControl).toBeNull()
    expect(report.positiveControlSignificant).toBeNull()
    expect(report.treatments.every(item => item.sd === null)).toBe(true)
  })

  it('does not duplicate a validation endpoint already present in the primary set', () => {
    const html = reportHtml()
      .replace('</svg><div class="sr-only">', '<rect class="column-bar" x="50" width="10"></rect></svg><div class="sr-only">')
      .replace('</tbody></table></div></div></section>', '<tr><td>MMS</td><td>50</td><td>2</td><td>3</td><td>0,2</td><td>NÃO SIGNIFICATIVO</td></tr></tbody></table></div></div></section>')
    const report = parser.parseReport(html, { filename: 'shared-endpoint.html' }, { DOMParser })
    expect(report.treatments).toHaveLength(3)
    expect(report.positiveControl).toBeNull()
    expect(report.supplementalTreatmentId).toBeNull()
  })

  it('rejects conflicting structured assay metadata', () => {
    const html = antigenotoxicReportHtml().replace('<section id="primary-means" data-assay-type="antigenotoxicity"', '<section id="primary-means" data-assay-type="genotoxicity"')
    expect(() => parser.parseReport(html, { filename: 'conflict.html' }, { DOMParser })).toThrow('data-assay-type divergentes')
  })

  it('rejects duplicated replicates and treatment-index label conflicts', () => {
    const duplicate = reportHtml().replace('<td>Controle</td><td>Controle negativo</td><td>-</td><td>2</td>', '<td>Controle</td><td>Controle negativo</td><td>-</td><td>1</td>')
    expect(() => parser.parseReport(duplicate, { filename: 'duplicate.html' }, { DOMParser })).toThrow('repetição duplicada')

    const identityConflict = antigenotoxicReportHtml().replace('<td>Positive control</td><td>50</td><td>2</td>', '<td>Outro tratamento</td><td>50</td><td>2</td>')
    expect(() => parser.parseReport(identityConflict, { filename: 'identity.html' }, { DOMParser })).toThrow('rótulos divergentes')
  })

  it('accepts the bounded rounding difference in older accessible report tables', () => {
    const html = reportHtml({ referenceScores: [0, 6.67], referenceEngineMean: 3.335, referenceReportedMean: 3.34, referenceReportedSd: 4.71 })
    const report = parser.parseReport(html, { filename: 'rounded.html' }, { DOMParser })
    expect(report.treatments[0]).toMatchObject({ mean: 3.34, sd: 4.71, n: 2 })
  })

  it('rejects unknown structured identities, inconsistent n and out-of-range scores', () => {
    const unknownIdentity = antigenotoxicReportHtml().replace('data-treatment-index="1" data-role="positive-control" data-primary-reference="true"', 'data-treatment-index="9" data-role="positive-control" data-primary-reference="true"')
    expect(() => parser.parseReport(unknownIdentity, { filename: 'unknown-id.html' }, { DOMParser })).toThrow('ausente em dose-overview')

    const inconsistentN = reportHtml().replace('<td>Controle</td><td>10</td><td>2</td><td>3</td>', '<td>Controle</td><td>10</td><td>2</td><td>4</td>')
    expect(() => parser.parseReport(inconsistentN, { filename: 'bad-n.html' }, { DOMParser })).toThrow('n divergente')

    const invalidScore = reportHtml().replace('<td>8</td><td>10</td>', '<td>101</td><td>10</td>')
    expect(() => parser.parseReport(invalidScore, { filename: 'bad-score.html' }, { DOMParser })).toThrow('fora do intervalo')
  })

  it('rejects hybrid reports with treatment identities in only one table', () => {
    const html = antigenotoxicReportHtml().replace(/ data-treatment-index="\d+" data-role="[^"]+" data-population="[^"]+"/g, '')
    expect(() => parser.parseReport(html, { filename: 'hybrid.html' }, { DOMParser })).toThrow('identidades estruturadas devem estar presentes conjuntamente')
  })

  it('recognizes the equivalent English report vocabulary', () => {
    let html = reportHtml()
    ;[
      ['Média do motor', 'Engine mean'], ['n (experimentos independentes)', 'n (independent experiments)'],
      ['Resultado estatístico', 'Statistical result'], ['Controle negativo', 'Negative control'],
      ['Concentração teste', 'Test concentration'], ['Controle positivo', 'Positive control'],
      ['Tipo celular', 'Cell type'], ['Score visual', 'Visual score'], ['Tratamento', 'Treatment'],
      ['Concentração', 'Concentration'], ['Repetição', 'Replicate'], ['Agente', 'Agent'],
      ['Papel', 'Role'], ['Média', 'Mean'], ['DP', 'SD'], ['p Holm', 'Holm p'],
      ['REFERÊNCIA', 'REFERENCE'], ['SIGNIFICATIVO', 'SIGNIFICANT']
    ].forEach(([source, target]) => { html = html.replaceAll(source, target) })
    const report = parser.parseReport(html, { filename: 'english.html' }, { DOMParser })
    expect(report).toMatchObject({ agent: 'Composto X', cellType: 'V79', positiveControlSignificant: true })
    expect(report.treatments[1].isSignificant).toBe(true)
  })

  it('rejects disagreement between the accessible table and SVG markers', () => {
    const html = reportHtml().replace('<text class="holm-marker" x="35">*</text>', '')
    expect(() => parser.parseReport(html, { filename: 'bad.html' }, { DOMParser })).toThrow('divergência de significância')
  })
})
