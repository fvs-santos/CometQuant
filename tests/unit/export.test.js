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
      performed: true, model: 'score ~ block + concentration', blockCount: 3, observationCount: 6, residualDF: 2, MSE: 3,
      treatmentDoses: [{ treatmentIndex: 0, concentration: 0 }, { treatmentIndex: 1, concentration: 1 }], referenceIncludedAsZero: true,
      slope: 10, standardError: 1.5, t: 6.6667, DF: 2, ciLow: 3.546, ciHigh: 16.454, p: 0.0217, r2: 0.95, significant: true
    },
    charts: { scores: 'iVBORw0KGgoAAA==', differences: 'iVBORw0KGgoAAA==', classes: 'iVBORw0KGgoAAA==' },
    ...overrides
  }
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
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
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
    zip.file('data/study_design.csv', exporter.buildStudyDesignCsv(data, analysis))
    zip.file('charts/block_scores.png', analysis.charts.scores, { base64: true })
    zip.file('charts/primary_differences.png', analysis.charts.differences, { base64: true })
    zip.file('charts/class_distribution.png', analysis.charts.classes, { base64: true })
    const archive = await zip.generateAsync({ type: 'nodebuffer' })
    const opened = await JSZip.loadAsync(archive)
    expect(Object.keys(opened.files)).toEqual(expect.arrayContaining([
      'report.html', 'data/experiment.json', 'data/analysis.json', 'data/raw_slides.csv', 'data/replicate_scores.csv',
      'data/population.csv', 'data/block_anova.csv', 'data/primary_comparisons.csv', 'data/control_response.csv',
      'data/dose_trend.csv', 'data/study_design.csv', 'charts/block_scores.png', 'charts/primary_differences.png', 'charts/class_distribution.png'
    ]))
  })
})
