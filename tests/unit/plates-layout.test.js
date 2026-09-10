const layout = require('../../js/plates/layout.js')

function report(id, agent, cellType, s9 = '') {
  return { id, filename: `${id}.html`, agent, cellType, s9, title: `${agent} - ${cellType}`, treatments: [], positiveControl: null }
}

describe('plates layout', () => {
  it('sorts naturally and paginates a simple grid', () => {
    const reports = [report('c', 'Compound 10', 'V79'), report('a', 'Compound 2', 'V79'), report('b', 'Compound 1', 'V79')]
    const pages = layout.buildPages(reports, { rows: 1, cols: 2, pairing: 'none', overflow: 'paginate', missing: 'blank' })

    expect(pages).toHaveLength(2)
    expect(pages[0][0].map(item => item.id)).toEqual(['b', 'a'])
    expect(pages[1][0][0].id).toBe('c')
    expect(pages[1][0][1].empty).toBe(true)
  })

  it('builds paired matrices and preserves explicit column priority', () => {
    const reports = [report('a', 'A', 'V79'), report('b', 'A', 'CHO'), report('c', 'B', 'V79')]
    const [page] = layout.buildPages(reports, { rows: 2, cols: 2, pairing: 'linhagem', pairOrder: ['V79'], overflow: 'error', missing: 'label' })

    expect(page[0].map(item => item.id)).toEqual(['a', 'b'])
    expect(page[1][0].id).toBe('c')
    expect(page[1][1]).toMatchObject({ empty: true, rowValue: 'B', colValue: 'CHO' })
  })

  it('lets a complete manual order override pairing', () => {
    const reports = [report('a', 'A', 'V79'), report('b', 'B', 'CHO')]
    const [page] = layout.buildPages(reports, { rows: 1, cols: 2, pairing: 'linhagem', reportOrder: ['b', 'a'], overflow: 'error' })
    expect(page[0].map(item => item.id)).toEqual(['b', 'a'])
  })

  it('uses spreadsheet-style panel letters and a shared upper limit', () => {
    expect(layout.panelLetter(26, 'upper')).toBe('AA')
    const item = report('a', 'A', 'V79')
    item.treatments = [{ mean: 101, sd: 4, isSignificant: true }]
    expect(layout.upperLimit([[item]], { positiveControl: 'none' })).toBe(115)
  })

  it('adds the validation treatment once and tolerates an unavailable SD', () => {
    const item = report('a', 'A', 'V79')
    const reference = { id: 'treatment:1', mean: 50, sd: null, isReference: true }
    item.treatments = [reference]
    item.positiveControl = { ...reference }
    item.positiveControlSignificant = true

    expect(layout.displayTreatments(item, { positiveControl: 'left' })).toHaveLength(1)
    expect(layout.upperLimit([[item]], { positiveControl: 'left', positiveControlMarker: 'dagger' })).toBe(100)

    item.positiveControl = { id: 'treatment:0', mean: 10, sd: null }
    expect(layout.displayTreatments(item, { positiveControl: 'left' }).map(treatment => treatment.id)).toEqual(['treatment:1', 'treatment:0'])
  })
})
