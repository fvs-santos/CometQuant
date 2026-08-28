const fs = require('node:fs')
const path = require('node:path')

describe('browser-facing contracts', () => {
  it('uses canonical safe builders and contains no innerHTML sinks', () => {
    const analysis = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
    expect(analysis).not.toMatch(/\.innerHTML\s*=/)
    expect(analysis).toContain('CometQuantExport.buildReportHtml')
    expect(analysis).toContain('CometQuantExport.buildRawCsv')
    expect(analysis).toContain('CometQuantExport.buildAggregateCsv')
    expect(analysis).toContain('CometQuantExport.buildPopulationCsv')
    expect(analysis).toContain('CometQuantExport.buildBlockAnovaCsv')
    expect(analysis).toContain('CometQuantExport.buildComparisonsCsv')
    expect(analysis).toContain('CometQuantExport.buildControlResponseCsv')
    expect(analysis).toContain('CometQuantExport.buildDoseTrendCsv')
    expect(analysis).toContain('CometQuantExport.buildStudyDesignCsv')
  })

  it('enforces and renders only the scientific analysis v2 contract', () => {
    const analysis = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
    expect(analysis).toMatch(/const ANALYSIS_SCHEMA_VERSION = 2/)
    expect(analysis).toMatch(/function validateAnalysisResult[\s\S]*?result\.analysisSchemaVersion !== ANALYSIS_SCHEMA_VERSION/)
    expect(analysis).toContain('analysis-plan-population')
    expect(analysis).toContain('analysis-block-scores')
    expect(analysis).toContain('analysis-rcbd-anova')
    expect(analysis).toContain('analysis-primary-comparisons')
    expect(analysis).toContain('analysis-control-response')
    expect(analysis).toContain('analysis-dose-trend')
    expect(analysis).toContain('analysis-v2-charts')
    expect(analysis).not.toMatch(/function render(?:Shapiro|Tukey|Regression)Table/)
    expect(analysis).not.toMatch(/results\.(?:shapiro|anova|tukey|regression)/)
  })

  it('packages the v2 CSVs, analysis JSON and all three charts', () => {
    const analysis = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
    for (const filename of ['raw_slides.csv', 'replicate_scores.csv', 'population.csv', 'block_anova.csv', 'primary_comparisons.csv', 'control_response.csv', 'dose_trend.csv', 'study_design.csv', 'analysis.json']) {
      expect(analysis).toContain(`'${filename}'`)
    }
    for (const filename of ['block_scores.png', 'primary_differences.png', 'class_distribution.png']) {
      expect(analysis).toContain(`'${filename}'`)
    }
  })

  it('persists every count and undo operation', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toMatch(/function registerCount[\s\S]*?persistProgress\(\)/)
    expect(app).toMatch(/function undoLastCount[\s\S]*?persistProgress\(\)/)
  })

  it('keeps count feedback separate from persistence', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toContain('const HAPTIC_FEEDBACK_DURATION_MS = 30')
    expect(app).toMatch(/function provideHapticFeedback[\s\S]*?navigator\.vibrate\(HAPTIC_FEEDBACK_DURATION_MS\)/)
    expect(app).toMatch(/function provideSoundFeedback[\s\S]*?context\.createOscillator\(\)/)
    expect(app).toMatch(/function registerCount[\s\S]*?updateCounterDisplay\(\)[\s\S]*?provideHapticFeedback\(\)[\s\S]*?provideSoundFeedback\(\)[\s\S]*?persistProgress\(\)/)
    expect(app).not.toMatch(/function persistProgress[\s\S]*?navigator\.vibrate/)
  })

  it('uses optimized class icons in the offline shell', () => {
    const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8')
    const serviceWorker = fs.readFileSync(path.resolve(__dirname, '../../service-worker.js'), 'utf8')
    for (let cometClass = 0; cometClass <= 4; cometClass++) {
      const relativePath = `./icons/class_${cometClass}.png`
      expect(index).toContain(`src="${relativePath}"`)
      expect(serviceWorker).toContain(`'${relativePath}'`)

      const png = fs.readFileSync(path.resolve(__dirname, `../../icons/class_${cometClass}.png`))
      expect(png.readUInt32BE(16)).toBe(512)
      expect(png.readUInt32BE(20)).toBe(512)
      expect(png[25]).toBe(6)
    }
    expect(index).not.toContain('<svg')
  })

  it('keeps storage diagnostics aligned with the completed shell cache', () => {
    const science = fs.readFileSync(path.resolve(__dirname, '../../js/science-package.js'), 'utf8')
    const serviceWorker = fs.readFileSync(path.resolve(__dirname, '../../service-worker.js'), 'utf8')
    const shellVersion = serviceWorker.match(/CACHE_NAME = `\$\{SHELL_CACHE_PREFIX\}(v\d+)`/)?.[1]
    expect(shellVersion).toBeTruthy()
    expect(science).toContain(`const SHELL_CACHE_NAME = 'cometquant-shell-${shellVersion}'`)
    expect(science).toContain("const SHELL_READY_MARKER = './cometquant-shell-ready'")
    expect(serviceWorker).toContain("const SHELL_READY_MARKER = './cometquant-shell-ready'")
  })

  it('associates analysis results with the current experiment version', () => {
    const analysis = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(analysis).toContain('analysisResultsContext')
    expect(analysis).toMatch(/function hasCurrentAnalysisResults[\s\S]*?analysisResultsContext\.id === currentExperiment\.id/)
    expect(analysis).toMatch(/function exportReport[\s\S]*?hasCurrentAnalysisResults\(\)/)
    expect(analysis).toMatch(/function exportZip[\s\S]*?hasCurrentAnalysisResults\(\)/)
    expect(app).toMatch(/function saveExperiment[\s\S]*?invalidateAnalysisResults\(\)/)
    expect(app).toMatch(/function openExperiment[\s\S]*?invalidateAnalysisResults\(\)/)
  })

  it('validates local experiments before returning them', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toMatch(/function normalizeExperiment[\s\S]*?CometQuantCore\.validateExperiment\(experiment, \{ source: 'local' \}\)/)
    expect(app).toMatch(/function handleCreateExperiment[\s\S]*?value === '' \? NaN : Number\(value\)/)
  })

  it('only advances terminal operations after a successful storage commit', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toMatch(/async function handleBlindCode[\s\S]*?await saveExperiment\(candidate\)[\s\S]*?afterSlideProcessed/)
    expect(app).toMatch(/async function handleFinishGel[\s\S]*?await saveExperiment\(candidate\)[\s\S]*?afterSlideProcessed/)
    expect(app).toMatch(/async function handleAddReplicate[\s\S]*?await saveExperiment\(candidate\)[\s\S]*?showBlindCodes/)
    expect(app).toMatch(/async function saveImportedExperiment[\s\S]*?if \(!await saveExperiment\(experiment, false, false\)\) throw/)
    expect(app).toMatch(/function saveImportedExperiment[\s\S]*?getStoredExperiments\(\)/)
  })
})
