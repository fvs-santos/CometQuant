const fs = require('node:fs')
const path = require('node:path')

describe('browser-facing contracts', () => {
  it('uses canonical safe builders and contains no innerHTML sinks', () => {
    const analysis = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
    expect(analysis).not.toMatch(/\.innerHTML\s*=/)
    expect(analysis).toContain('CometQuantExport.buildReportHtml')
    expect(analysis).toContain('CometQuantExport.buildRawCsv')
    expect(analysis).toContain('CometQuantExport.buildAggregateCsv')
  })

  it('persists every count and undo operation', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toMatch(/function registerCount[\s\S]*?persistProgress\(\)/)
    expect(app).toMatch(/function undoLastCount[\s\S]*?persistProgress\(\)/)
  })

  it('keeps haptic feedback separate from count persistence', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
    expect(app).toMatch(/function provideHapticFeedback[\s\S]*?navigator\.vibrate\(10\)/)
    expect(app).toMatch(/function registerCount[\s\S]*?updateCounterDisplay\(\)[\s\S]*?provideHapticFeedback\(\)[\s\S]*?persistProgress\(\)/)
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
