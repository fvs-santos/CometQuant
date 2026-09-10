const layout = require('../../js/plates/layout.js')

globalThis.CometQuantPlatesLayout = layout
const renderer = require('../../js/plates/renderer.js')

describe('plates renderer labels', () => {
  it('preserves Ctrl for a genotoxicity reference', () => {
    expect(renderer.treatmentLabel({ label: 'Negative control', isReference: true }, 'en', 'genotoxicity')).toBe('Ctrl')
  })

  it('uses the real positive-reference name for antigenotoxicity', () => {
    expect(renderer.treatmentLabel({ label: 'MMS', isReference: true, role: 'positive_control' }, 'pt-BR', 'antigenotoxicity')).toBe('MMS')
  })

  it('preserves small concentrations instead of rounding them to zero', () => {
    expect(renderer.treatmentLabel({ label: '0.01 uM', role: 'test', concentration: 0.01, concentrationUnit: 'µM' }, 'pt-BR', 'genotoxicity')).toBe('0,01\nµM')
    expect(renderer.treatmentLabel({ label: '1 uM', role: 'test', concentration: 1, concentrationUnit: 'µM' }, 'en', 'genotoxicity')).toBe('1.0\nµM')
  })
})
