const JSZip = require('jszip')
const exporter = require('../../js/export.js')
const { experiment } = require('../fixtures/experiment.js')

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

  it('provides content suitable for the complete ZIP', async () => {
    const data = experiment()
    const zip = new JSZip()
    zip.file('report.html', exporter.buildReportHtml(data, null, 'en'))
    zip.file('data/experiment.json', JSON.stringify(data))
    zip.file('data/raw_slides.csv', exporter.buildRawCsv(data))
    zip.file('data/replicate_scores.csv', exporter.buildAggregateCsv(data))
    const archive = await zip.generateAsync({ type: 'nodebuffer' })
    const opened = await JSZip.loadAsync(archive)
    expect(Object.keys(opened.files)).toEqual(expect.arrayContaining(['report.html', 'data/experiment.json', 'data/raw_slides.csv', 'data/replicate_scores.csv']))
  })
})
