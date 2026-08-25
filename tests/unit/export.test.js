const JSZip = require('jszip')
const exporter = require('../../js/export.js')
const { experiment } = require('../fixtures/experiment.js')

function v2Analysis(overrides = {}) {
  const comparison = {
    referenceTreatmentIndex: 0, referenceTreatment: 'Control', treatmentIndex: 1, treatment: '1 uM', blockCount: 3,
    referenceMean: 10, treatmentMean: 20, difference: 10, standardError: 1.5, t: 6.6667, DF: 4,
    ciLow: 5.835, ciHigh: 14.165, pRaw: 0.0026, pAdjusted: 0.0052, significant: true, direction: 'higher'
  }
  const blockAnova = {
    performed: true, model: 'score ~ treatment + block', blockCount: 3, treatmentIndices: [0, 1], residualDF: 2, MSE: 3,
    terms: [
      { term: 'treatment', SS: 150, DF: 1, MS: 150, F: 50, p: 0.0194 },
      { term: 'block', SS: 8, DF: 2, MS: 4, F: 1.3333, p: 0.4286 },
      { term: 'residual', SS: 6, DF: 2, MS: 3 }
    ]
  }
  return {
    analysisSchemaVersion: 2,
    protocol: {
      studyDesignVersion: 1, assayType: 'genotoxicity', primaryReferenceTreatmentIndex: 0, primaryReferenceTreatment: 'Control',
      primaryTreatmentIndices: [1], validationComparison: { referenceTreatmentIndex: 0, treatmentIndex: 1 }, alpha: 0.05,
      alternative: 'two-sided', multiplicityAdjustment: 'holm', confidenceLevel: 0.95, includePrimaryReferenceAsZero: true
    },
    population: {
      unit: 'independent_experiment', technicalSlidesAveragedWithinCell: true,
      blocks: [{
        replicateNumber: 1, primaryIncluded: true, primaryExclusionReasons: [],
        cells: [{ treatmentIndex: 0, treatment: 'Control', expectedSlides: 2, validSlides: 2, invalidSlides: 0, absentSlides: 0, score: 10, technicalReplicationComplete: true }]
      }],
      primary: { includedBlockNumbers: [1], includedBlockCount: 1, excludedBlocks: [] },
      validation: { includedBlockNumbers: [1], includedBlockCount: 1, excludedBlocks: [] }
    },
    scores: { performed: true, population: 'primary_complete_blocks', cells: [] },
    blockAnova,
    primaryComparisons: {
      performed: true, family: 'each_primary_concentration_vs_reference', familySize: 1, adjustment: 'holm',
      confidenceLevel: 0.95, comparisons: [comparison]
    },
    controlResponse: { performed: true, purpose: 'separate_validation_comparison', blockNumbers: [1, 2, 3], blockAnova, comparison: { ...comparison, pAdjusted: undefined } },
    doseTrend: {
      performed: true, model: 'score ~ block + concentration (linear)', trendKind: 'linear', blockCount: 3, observationCount: 6, residualDF: 2, MSE: 3,
      treatmentDoses: [{ treatmentIndex: 0, concentration: 0 }, { treatmentIndex: 1, concentration: 1 }], referenceIncludedAsZero: true,
      slope: 10, standardError: 1.5, t: 6.6667, DF: 2, ciLow: 3.546, ciHigh: 16.454, p: 0.0217, r2: 0.95, r2Partial: 0.9, significant: true
    },
    descriptive: {
      performed: true, population: 'primary_complete_blocks',
      treatments: [{ treatmentIndex: 0, treatment: 'Control', blockCount: 3, mean: 10, standardDeviation: 2, coefficientOfVariation: 20, minimum: 8, maximum: 12 }],
      heterogeneityFlag: { performed: true, flagged: false, maximumStandardDeviation: 2, minimumStandardDeviation: 2, ratio: 1, code: 'homogeneous_variance' }
    },
    nonParametric: {
      performed: true, population: 'primary_complete_blocks',
      friedman: { performed: true, blockCount: 3, treatmentIndices: [0, 1], statistic: 9, df: 3, pExact: 0.0017, exactArrangements: 13824 },
      pageTrend: { performed: true, blockCount: 3, treatmentIndices: [0, 1], direction: 'increasing', directionSource: 'assay_type', statistic: 90, pExact: 0.00007, pExactOpposite: 1, exactArrangements: 13824 }
    },
    transformedAnalysis: {
      performed: true, scale: 'arcsin_sqrt',
      blockAnova,
      primaryComparisons: { performed: true, comparisons: [comparison] },
      doseTrend: { performed: true, slope: 0.5, p: 0.01, r2Partial: 0.8 }
    },
    charts: { scores: 'iVBORw0KGgoAAA==', differences: 'iVBORw0KGgoAAA==', classes: 'iVBORw0KGgoAAA==' },
    ...overrides
  }
}

function reportScenario() {
  const data = experiment({
    treatments: ['Negative control', 'Positive control', 'Compound 1 uM', 'Compound 5 uM'],
    treatmentMetadata: [
      { treatmentIndex: 0, role: 'negative-control', concentration: null },
      { treatmentIndex: 1, role: 'positive-control', concentration: null },
      { treatmentIndex: 2, role: 'test-concentration', concentration: 1 },
      { treatmentIndex: 3, role: 'test-concentration', concentration: 5 }
    ],
    concUnit: 'uM'
  })
  const analysis = v2Analysis()
  const comparison = analysis.primaryComparisons.comparisons[0]
  Object.assign(comparison, {
    referenceTreatmentIndex: 0, referenceTreatment: 'Negative control', treatmentIndex: 2, treatment: 'Compound 1 uM',
    referenceMean: 10, treatmentMean: 20, pRaw: 0.04, pAdjusted: 0.068, significant: false
  })
  Object.assign(analysis.protocol, {
    primaryReferenceTreatmentIndex: 0, primaryReferenceTreatment: 'Negative control', primaryTreatmentIndices: [2, 3],
    validationComparison: { referenceTreatmentIndex: 0, treatmentIndex: 1 }
  })
  Object.assign(analysis.controlResponse.comparison, {
    referenceTreatmentIndex: 0, referenceTreatment: 'Negative control', treatmentIndex: 1, treatment: 'Positive control',
    referenceMean: 10, treatmentMean: 48, difference: 38, pRaw: 0.003, significant: true, direction: 'higher'
  })
  analysis.primaryComparisons.familySize = 2
  analysis.primaryComparisons.comparisons.push({
    ...comparison, treatmentIndex: 3, treatment: 'Compound 5 uM', treatmentMean: 30, difference: 20, pRaw: 0.0005, pAdjusted: 0.001, significant: true
  })
  analysis.transformedAnalysis.primaryComparisons.comparisons = analysis.primaryComparisons.comparisons.map(row => ({ ...row, significant: true, pAdjusted: Math.min(row.pAdjusted, 0.04) }))
  analysis.transformedAnalysis.doseTrend.significant = true
  analysis.doseTrend.treatmentDoses = [{ treatmentIndex: 0, concentration: 0 }, { treatmentIndex: 2, concentration: 1 }, { treatmentIndex: 3, concentration: 5 }]
  analysis.nonParametric.friedman.treatmentIndices = [0, 2, 3]
  analysis.nonParametric.pageTrend.treatmentIndices = [0, 2, 3]
  analysis.descriptive.treatments = [
    { treatmentIndex: 0, treatment: 'Negative control', blockCount: 3, mean: 10, standardDeviation: 2, coefficientOfVariation: 20, minimum: 8, maximum: 12 },
    { treatmentIndex: 2, treatment: 'Compound 1 uM', blockCount: 3, mean: 20, standardDeviation: 3, coefficientOfVariation: 15, minimum: 17, maximum: 23 },
    { treatmentIndex: 3, treatment: 'Compound 5 uM', blockCount: 3, mean: 30, standardDeviation: 4, coefficientOfVariation: 13.33, minimum: 26, maximum: 34 }
  ]
  analysis.descriptive.heterogeneityFlag = { performed: true, flagged: true, maximumStandardDeviation: 6.4, minimumStandardDeviation: 2, ratio: 3.2, code: 'heterogeneous_variance' }
  analysis.population.blocks = [1, 2, 3].map((replicateNumber, index) => ({
    replicateNumber,
    primaryIncluded: true,
    primaryExclusionReasons: [],
    cells: [
      { treatmentIndex: 0, treatment: 'Negative control', score: [8, 10, 12][index] },
      { treatmentIndex: 1, treatment: 'Positive control', score: [45, 48, 51][index] },
      { treatmentIndex: 2, treatment: 'Compound 1 uM', score: [17, 20, 23][index] },
      { treatmentIndex: 3, treatment: 'Compound 5 uM', score: [26, 30, 34][index] }
    ]
  }))
  analysis.population.primary = { includedBlockNumbers: [1, 2, 3], includedBlockCount: 3, excludedBlocks: [] }
  analysis.population.validation = { includedBlockNumbers: [1, 2, 3], includedBlockCount: 3, excludedBlocks: [] }
  return { data, analysis }
}

describe('safe exports', () => {
  it('escapes HTML payloads in reports', () => {
    const data = experiment({ agent: '<img src=x onerror=alert(1)>', treatments: ['<script>alert(1)</script>'] })
    data.replicates[0].gels[0].treatment = data.treatments[0]
    const html = exporter.buildReportHtml(data, null, 'en')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('quotes CSV and neutralizes spreadsheet formulas', () => {
    const data = experiment({ agent: '=HYPERLINK("bad")', treatments: ['Control, "quoted"'] })
    data.replicates[0].gels[0].treatment = data.treatments[0]
    const csv = exporter.buildRawCsv(data)
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
    expect(csv).toContain('"Control, ""quoted"""')
    expect(csv).toContain('\r\n')
  })

  it('exports slide corrections separately and safely in CSV and HTML', () => {
    const data = experiment()
    const assignment = data.replicates[0].assignments[0]
    const gel = data.replicates[0].gels[0]
    const before = require('../../js/core.js').createSlideEditSnapshot(assignment, gel)
    gel.class2 = 90
    gel.class3 = 10
    const after = require('../../js/core.js').createSlideEditSnapshot(assignment, gel)
    data.slideEditHistory.push({
      version: 1, editId: 'edit-1', editedAt: '2026-01-03T00:00:00.000Z', editedBy: '=DANGEROUS()',
      reason: '<img src=x onerror=alert(1)>',
      slide: { replicateNumber: 1, blindCode: 'AA1', treatmentIndex: 0, gelNumber: 1 }, before, after
    })

    const csv = exporter.buildSlideEditCsv(data)
    expect(csv).toContain('"slide_corrections"'.replace('slide_corrections', 'edit_id'))
    expect(csv).toContain('"\'=DANGEROUS()"')
    expect(csv).toContain('"before_class2"')
    expect(csv).toContain('"before_assignment_recorded_at"')
    expect(csv).toContain('"before_gel_recorded_at"')
    expect(exporter.buildRawRows(data)).toHaveLength(1)

    const html = exporter.buildReportHtml(data, v2Analysis(), 'en')
    expect(html).toContain('Slide correction history')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('shows an incomplete-reason-only correction distinctly in the report', () => {
    const data = experiment()
    const assignment = data.replicates[0].assignments[0]
    const gel = data.replicates[0].gels[0]
    Object.assign(gel, { class2: 90, total: 90, completion: 'incomplete', incompleteReason: { code: 'poor-quality', detail: '' } })
    const before = require('../../js/core.js').createSlideEditSnapshot(assignment, gel)
    gel.incompleteReason = { code: 'technical-error', detail: '' }
    const after = require('../../js/core.js').createSlideEditSnapshot(assignment, gel)
    data.slideEditHistory.push({
      version: 1, editId: 'edit-reason', editedAt: '2026-01-03T00:00:00.000Z', editedBy: 'Reviewer', reason: 'Reason corrected.',
      slide: { replicateNumber: 1, blindCode: 'AA1', treatmentIndex: 0, gelNumber: 1 }, before, after
    })
    const html = exporter.buildReportHtml(data, v2Analysis(), 'en')
    expect(html).toContain('incomplete_reason=poor-quality')
    expect(html).toContain('incomplete_reason=technical-error')
  })

  it('exports an off-target counted slide with its effective-total score', () => {
    const data = experiment()
    Object.assign(data.replicates[0].gels[0], {
      class0: 26, class1: 34, class2: 23, class3: 9, class4: 7, total: 99,
      status: 'counted', completion: 'incomplete', incompleteReason: { code: 'legacy-unjustified', detail: '' }
    })

    const [row] = exporter.buildRawRows(data)
    expect(row.included_in_analysis).toBe('true')
    expect(row.visual_score).toBe('34.0909')
    expect(exporter.buildRawCsv(data)).toContain('"34.0909"')
    expect(exporter.buildReportHtml(data, null, 'en')).toContain('34.0909')
  })

  it('builds safe CSVs for every analysis v2 result', () => {
    const data = experiment({
      treatments: ['Control', '=DANGEROUS()'],
      treatmentMetadata: [
        { treatmentIndex: 0, role: 'negative-control', concentration: null },
        { treatmentIndex: 1, role: 'test', concentration: 1 }
      ]
    })
    const analysis = v2Analysis()
    analysis.primaryComparisons.comparisons[0].treatment = '=DANGEROUS()'
    const outputs = {
      population: exporter.buildPopulationCsv(analysis),
      anova: exporter.buildBlockAnovaCsv(analysis),
      comparisons: exporter.buildComparisonsCsv(analysis),
      control: exporter.buildControlResponseCsv(analysis),
      trend: exporter.buildDoseTrendCsv(analysis),
      nonParametric: exporter.buildNonParametricCsv(analysis),
      transformed: exporter.buildTransformedAnalysisCsv(analysis),
      design: exporter.buildStudyDesignCsv(data, analysis)
    }

    Object.values(outputs).forEach(csv => {
      expect(csv.startsWith('\uFEFF')).toBe(true)
      expect(csv).toContain('\r\n')
    })
    expect(outputs.population).toContain('"replicate_number"')
    expect(outputs.anova).toContain('"treatment"')
    expect(outputs.comparisons).toContain('"p_holm"')
    expect(outputs.comparisons).toContain('"\'=DANGEROUS()"')
    expect(outputs.control).toContain('"p_raw"')
    expect(outputs.trend).toContain('"concentration"')
    expect(outputs.trend).toContain('"r2_partial"')
    expect(outputs.nonParametric).toContain('"friedman"')
    expect(outputs.nonParametric).toContain('"page"')
    expect(outputs.nonParametric).toContain('"p_exact"')
    expect(outputs.transformed).toContain('"arcsin_sqrt"')
    expect(outputs.transformed).toContain('"section"')
    expect(outputs.design).toContain('"\'=DANGEROUS()"')
  })

  it('renders the human v2 report and escapes statistical labels', () => {
    const data = experiment()
    const analysis = v2Analysis()
    analysis.primaryComparisons.comparisons[0].treatment = '<img src=x onerror=alert(1)>'
    const html = exporter.buildReportHtml(data, analysis, 'en')
    expect(html).toContain('Scientific protocol')
    expect(html).toContain('Randomized complete block ANOVA')
    expect(html).toContain('Planned primary comparisons')
    expect(html).toContain('Control response')
    expect(html).toContain('Block-adjusted dose trend')
    expect(html).toContain('Differences with 95% CI')
    expect(html).toContain('Non-parametric sensitivity')
    expect(html).toContain('Transformed sensitivity')
    expect(html).toContain('Per-treatment dispersion')
    expect(html).toContain('Description:')
    expect(html).not.toContain('Plain-language reading')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('puts a plain-language conclusion and individual replicate chart before technical details', () => {
    const { data, analysis } = reportScenario()
    const html = exporter.buildReportHtml(data, analysis, 'pt')

    expect(html).toContain('Síntese das evidências')
    expect(html).toContain('Resposta do controle positivo')
    expect(html).toContain('Resposta esperada detectada')
    expect(html).toContain('Efeito na direção esperada detectado')
    expect(html).toContain('1 de 2 concentrações mostraram aumento de dano (Compound 5 uM)')
    expect(html).toContain('Compound 1 uM não mostrou diferença (p Holm=0,068)')
    expect(html).toContain('Tendência consistente')
    expect(html).toContain('não classifica automaticamente a substância')
    expect(html).toContain('JSON e CSV preservam a precisão integral')
    expect(html.indexOf('id="evidence-summary"')).toBeLessThan(html.indexOf('id="raw"'))
    expect(html).toContain('<details>')
    expect(html).toContain('Detalhamento técnico')
    expect(html).toContain('Descrição:')
    expect(html).not.toContain('Leitura simples')
    expect(html).toContain('<svg viewBox="0 0 900 500"')
    expect(html).toContain('<svg viewBox="0 0 900 520"')
    expect(html).toContain('Experimento independente 1: 8,00')
    expect(html).toContain('Média do motor: 20,00')
    expect(html).toContain('Nenhum limite universal de CV elevado foi aplicado')
    expect(html).toContain('O motor sinalizou variabilidade desigual entre tratamentos')
    expect(html).toContain('2 de 2 comparações foram significativas na escala transformada')
    expect(html).toContain('a decisão de significância mudou após a transformação para Compound 1 uM')
    expect(html).not.toContain('p=<')
    expect(html).toContain('scope="col"')
    expect(html).toContain('name="viewport"')
    expect(html).toContain('Dados acessíveis do gráfico')
    expect(html).toContain('Coluna = média; haste = DP entre experimentos independentes')
    expect(html).toContain('* p ajustado por Holm &lt; 0,05')
    expect(html).not.toContain('Conclusão em 30 segundos')
    expect(html).not.toContain('Validade do ensaio')
    expect(html).not.toMatch(/<(?:link|script|iframe|object|embed)\b/i)
    expect(html).not.toMatch(/\b(?:src|href)=["'](?:https?:)?\/\//i)
  })

  it('adds navigable traceability and a Holm-annotated primary column chart', () => {
    const { data, analysis } = reportScenario()
    const generatedAt = '2026-08-25T12:34:56.000Z'
    const html = exporter.buildReportHtml(data, analysis, 'pt', { generatedAt, appVersion: '2.1.0' })
    const document = new DOMParser().parseFromString(html, 'text/html')

    const links = [...document.querySelectorAll('.report-index a')]
    expect(links.length).toBeGreaterThan(10)
    links.forEach(link => expect(document.querySelector(link.getAttribute('href'))).not.toBeNull())
    expect(new Set(links.map(link => link.getAttribute('href'))).size).toBe(links.length)

    const pointLabels = [...document.querySelectorAll('.dose-chart svg .chart-label')].map(node => node.textContent)
    expect(pointLabels).toEqual(['Negative control', 'Positive control', 'Compound 1 uM', 'Compound 5 uM'])
    expect(document.querySelector('.dose-chart svg').textContent).not.toContain('Controle do solvente')
    const positiveControlAccessibleRow = [...document.querySelectorAll('.dose-chart .sr-only tbody tr')].find(row => row.cells[0].textContent === 'Positive control')
    expect(positiveControlAccessibleRow.cells[2].textContent).toBe('-')

    const columnChart = document.querySelector('.column-chart')
    expect(columnChart).not.toBeNull()
    expect(columnChart.querySelectorAll('.column-bar')).toHaveLength(3)
    expect(columnChart.querySelectorAll('.holm-marker')).toHaveLength(1)
    expect(columnChart.textContent).toContain('n=3')
    expect(columnChart.textContent).toContain('Compound 5 uM')
    expect(columnChart.querySelector('.column-label').textContent).toBe('Negative control (Referência)')
    expect(columnChart.querySelector('desc').textContent).toContain('p ajustado por Holm menor que 0,05')
    expect(columnChart.querySelector('.sr-only').textContent).toContain('NÃO SIGNIFICATIVO')
    expect(columnChart.querySelector('.sr-only').textContent).toContain('SIGNIFICATIVO')

    const footer = document.querySelector('.report-footer')
    expect(footer.textContent).toContain('exp-1')
    expect(footer.textContent).toContain('2.1.0')
    expect(footer.querySelector(`time[datetime="${generatedAt}"]`)).not.toBeNull()
    expect(footer.querySelector('time[datetime="2026-01-02T00:00:00.000Z"]')).not.toBeNull()
    expect(footer.textContent).toContain('UTC')
    expect(html).toContain('Tipo de ensaio')
    expect(html).toContain('genotoxicidade')
    expect(html).toContain('experimento (bloco)')
  })

  it('preserves the engine threshold and does not present zero SD as estimable with n=1', () => {
    const { data, analysis } = reportScenario()
    analysis.primaryComparisons.comparisons[1].pAdjusted = 0.05
    analysis.primaryComparisons.comparisons[1].significant = false
    Object.assign(analysis.descriptive.treatments[2], { blockCount: 1, standardDeviation: 0 })

    const html = exporter.buildReportHtml(data, analysis, 'pt')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const chart = document.querySelector('.column-chart')
    expect(chart.querySelectorAll('.holm-marker')).toHaveLength(0)
    expect(chart.querySelectorAll('.error-bar')).toHaveLength(6)
    expect(chart.querySelector('.sr-only').textContent).toContain('Não estimável')
    expect(chart.querySelector('.sr-only').textContent).toContain('0,05')
    const dispersionRow = [...document.querySelectorAll('#dispersion tbody tr')].find(row => row.cells[0].textContent === 'Compound 5 uM')
    expect([...dispersionRow.cells].map(cell => cell.textContent)).toEqual(['Compound 5 uM', '30,00', 'Não estimável', 'Não estimável', '1'])
  })

  it('keeps many primary columns readable with a scrollable dynamic width', () => {
    const { data, analysis } = reportScenario()
    const extraIndices = [4, 5, 6, 7]
    extraIndices.forEach((treatmentIndex, offset) => {
      data.treatmentMetadata.push({ treatmentIndex, role: 'test-concentration', concentration: 10 + offset * 5 })
      analysis.descriptive.treatments.push({ treatmentIndex, treatment: `Dose ${treatmentIndex}`, blockCount: 3, mean: 40 + offset, standardDeviation: 2, coefficientOfVariation: 5 })
      analysis.primaryComparisons.comparisons.push({ treatmentIndex, treatment: `Dose ${treatmentIndex}`, pAdjusted: 0.1, significant: false })
    })
    analysis.protocol.primaryTreatmentIndices.push(...extraIndices)

    const html = exporter.buildReportHtml(data, analysis, 'en')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const svg = document.querySelector('.column-chart svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 1190 520')
    expect(svg.getAttribute('style')).toContain('min-width:1190px')
    expect(svg.querySelectorAll('.column-bar')).toHaveLength(7)
  })

  it('escapes report traceability values', () => {
    const data = experiment({ id: '<img src=x onerror=alert(1)>', updatedAt: '2026-01-02T00:00:00.000Z' })
    const html = exporter.buildReportHtml(data, v2Analysis(), 'en', {
      generatedAt: '2026-08-25T12:34:56.000Z',
      appVersion: '<script>alert(1)</script>'
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('localizes a zero-difference direction in Portuguese', () => {
    const analysis = v2Analysis()
    analysis.primaryComparisons.comparisons[0].direction = 'equal'
    const html = exporter.buildReportHtml(experiment(), analysis, 'pt')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('#comparisons').textContent).toContain('igual')
    expect(document.querySelector('#comparisons').textContent).not.toContain('equal')
  })

  it('adapts effect direction and wording for antigenotoxicity', () => {
    const { data, analysis } = reportScenario()
    analysis.protocol.assayType = 'antigenotoxicity'
    analysis.protocol.primaryReferenceTreatmentIndex = 1
    analysis.protocol.primaryReferenceTreatment = 'Positive control'
    analysis.primaryComparisons.comparisons = analysis.primaryComparisons.comparisons.map((comparison, index) => ({
      ...comparison,
      referenceTreatmentIndex: 1, referenceTreatment: 'Positive control', referenceMean: 48,
      treatmentMean: index === 0 ? 20 : 10, difference: index === 0 ? -28 : -38, direction: 'lower', significant: true
    }))
    analysis.doseTrend.slope = -10
    analysis.doseTrend.treatmentDoses = [{ treatmentIndex: 1, concentration: 0 }, { treatmentIndex: 2, concentration: 1 }, { treatmentIndex: 3, concentration: 5 }]
    analysis.nonParametric.pageTrend.direction = 'decreasing'
    analysis.descriptive.treatments = [
      { treatmentIndex: 1, treatment: 'Positive control', blockCount: 3, mean: 48, standardDeviation: 3, coefficientOfVariation: 6.25 },
      { treatmentIndex: 2, treatment: 'Compound 1 uM', blockCount: 3, mean: 20, standardDeviation: 3, coefficientOfVariation: 15 },
      { treatmentIndex: 3, treatment: 'Compound 5 uM', blockCount: 3, mean: 10, standardDeviation: 2, coefficientOfVariation: 20 }
    ]

    const html = exporter.buildReportHtml(data, analysis, 'pt')
    expect(html).toContain('Sinal de antigenotoxicidade')
    expect(html).toContain('redução de dano')
    expect(html).toContain('tendência significativa, ordenada')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('.column-chart .reference-bar title').textContent).toContain('Positive control')
  })

  it('flags a significant but non-monotonic response as weak and irregular', () => {
    const { data, analysis } = reportScenario()
    analysis.primaryComparisons.comparisons[1].treatmentMean = 15
    analysis.primaryComparisons.comparisons[1].difference = 5
    analysis.primaryComparisons.comparisons[1].pAdjusted = 0.02

    const html = exporter.buildReportHtml(data, analysis, 'pt')
    expect(html).toContain('Tendência parcial ou irregular')
    expect(html).toContain('1 reversão(ões) entre médias de doses sucessivas')
    expect(html).toContain('Uma dose maior apresentou média de dano menos favorável')
  })

  it('provides content suitable for the complete ZIP', async () => {
    const data = experiment()
    const analysis = v2Analysis()
    const zip = new JSZip()
    zip.file('report.html', exporter.buildReportHtml(data, analysis, 'en'))
    zip.file('data/experiment.json', JSON.stringify(data))
    zip.file('data/analysis.json', JSON.stringify(analysis))
    zip.file('data/raw_slides.csv', exporter.buildRawCsv(data))
    zip.file('data/replicate_scores.csv', exporter.buildAggregateCsv(data))
    zip.file('data/population.csv', exporter.buildPopulationCsv(analysis))
    zip.file('data/block_anova.csv', exporter.buildBlockAnovaCsv(analysis))
    zip.file('data/primary_comparisons.csv', exporter.buildComparisonsCsv(analysis))
    zip.file('data/control_response.csv', exporter.buildControlResponseCsv(analysis))
    zip.file('data/dose_trend.csv', exporter.buildDoseTrendCsv(analysis))
    zip.file('data/non_parametric.csv', exporter.buildNonParametricCsv(analysis))
    zip.file('data/transformed_analysis.csv', exporter.buildTransformedAnalysisCsv(analysis))
    zip.file('data/study_design.csv', exporter.buildStudyDesignCsv(data, analysis))
    zip.file('charts/block_scores.png', analysis.charts.scores, { base64: true })
    zip.file('charts/primary_differences.png', analysis.charts.differences, { base64: true })
    zip.file('charts/class_distribution.png', analysis.charts.classes, { base64: true })
    const archive = await zip.generateAsync({ type: 'nodebuffer' })
    const opened = await JSZip.loadAsync(archive)
    expect(Object.keys(opened.files)).toEqual(expect.arrayContaining([
      'report.html', 'data/experiment.json', 'data/analysis.json', 'data/raw_slides.csv', 'data/replicate_scores.csv',
      'data/population.csv', 'data/block_anova.csv', 'data/primary_comparisons.csv', 'data/control_response.csv',
      'data/dose_trend.csv', 'data/non_parametric.csv', 'data/transformed_analysis.csv', 'data/study_design.csv',
      'charts/block_scores.png', 'charts/primary_differences.png', 'charts/class_distribution.png'
    ]))
  })
})

describe('web share helpers', () => {
  const originalNavigator = globalThis.navigator

  const readFileText = file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalNavigator) globalThis.navigator = originalNavigator
  })

  it('builds a text/plain File from JSON data with the given name', async () => {
    const file = exporter.buildShareTextFile({ id: 'exp-1', agent: 'Agent' }, 'CometQuant_Agent_2026-08-25.json.txt')
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('CometQuant_Agent_2026-08-25.json.txt')
    expect(file.type).toBe('text/plain')
    await expect(readFileText(file)).resolves.toContain('"agent": "Agent"')
  })

  it('builds a shareable File for HTML and CSV', async () => {
    const html = exporter.buildShareFile('<h1>Report</h1>', 'report.html', 'text/html')
    const csv = exporter.buildShareFile('\uFEFFa,b', 'raw.csv', 'text/csv')
    expect(html.type).toBe('text/html')
    expect(csv.type).toBe('text/csv')
    expect(csv.size).toBe(6)
    await expect(readFileText(csv)).resolves.toBe('a,b')
    await expect(readFileText(html)).resolves.toBe('<h1>Report</h1>')
  })

  it('detects file share support only when share and canShare are present', () => {
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => false) })
    expect(exporter.canShareFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).toBe(false)

    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => true) })
    expect(exporter.canShareFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).toBe(true)

    vi.stubGlobal('navigator', { share: vi.fn() })
    expect(exporter.canShareFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])).toBe(false)
  })

  it('maps share outcomes by error name', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })

    vi.stubGlobal('navigator', { share: vi.fn(async () => undefined), canShare: vi.fn(() => true) })
    await expect(exporter.shareFiles([file])).resolves.toEqual({ status: 'shared' })

    vi.stubGlobal('navigator', { share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }), canShare: vi.fn(() => true) })
    await expect(exporter.shareFiles([file])).resolves.toEqual({ status: 'cancelled' })

    vi.stubGlobal('navigator', { share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }), canShare: vi.fn(() => true) })
    await expect(exporter.shareFiles([file])).resolves.toEqual({ status: 'denied' })

    vi.stubGlobal('navigator', { share: vi.fn(async () => { throw new Error('boom') }), canShare: vi.fn(() => true) })
    await expect(exporter.shareFiles([file])).resolves.toMatchObject({ status: 'failed' })

    vi.stubGlobal('navigator', { share: undefined, canShare: vi.fn(() => true) })
    await expect(exporter.shareFiles([file])).resolves.toEqual({ status: 'unavailable' })
  })
})
