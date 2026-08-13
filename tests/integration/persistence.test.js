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
})
