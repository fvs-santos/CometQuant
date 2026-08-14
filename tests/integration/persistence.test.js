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
    expect(app).toMatch(/function handleBlindCode[\s\S]*?if \(!saveExperiment\(candidate\)\) return[\s\S]*?afterSlideProcessed/)
    expect(app).toMatch(/function handleFinishGel[\s\S]*?if \(!saveExperiment\(candidate\)\) return[\s\S]*?afterSlideProcessed/)
    expect(app).toMatch(/function handleAddReplicate[\s\S]*?if \(!saveExperiment\(candidate\)\) return[\s\S]*?showBlindCodes/)
    expect(app).toMatch(/function saveImportedExperiment[\s\S]*?if \(!saveExperiment\(experiment, false, false\)\) throw/)
    expect(app).toMatch(/function saveImportedExperiment[\s\S]*?getStoredExperiments\(\)/)
  })
})
