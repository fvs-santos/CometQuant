const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')
const core = require('../../js/core.js')
const legacyXlsx = require('../../js/legacy-xlsx.js')

function workbookFile() {
  const data = fs.readFileSync(path.resolve(__dirname, '../../Comet_VKM35_V79.xlsx'))
  return {
    name: 'Comet_VKM35_V79.xlsx',
    size: data.length,
    arrayBuffer: async () => data
  }
}

async function workbookWithoutCells(references) {
  const source = workbookFile()
  const zip = await JSZip.loadAsync(await source.arrayBuffer())
  let worksheet = await zip.file('xl/worksheets/sheet1.xml').async('string')
  references.forEach(reference => {
    worksheet = worksheet.replace(new RegExp(`<c r="${reference}"[^>]*>[\\s\\S]*?<\\/c>`), '')
  })
  zip.file('xl/worksheets/sheet1.xml', worksheet)
  const data = await zip.generateAsync({ type: 'nodebuffer' })
  return { name: 'missing.xlsx', size: data.length, arrayBuffer: async () => data }
}

function roles(parsed, withSolvent = true) {
  return parsed.treatments.map((_, index) => {
    if (index === 0) return { role: 'positive-control', concentration: null }
    if (index === 1) return { role: 'negative-control', concentration: null }
    if (index === 2) return { role: withSolvent ? 'solvent-control' : 'other', concentration: null }
    return { role: 'test-concentration', concentration: parsed.concentrationSuggestions[index].concentration }
  })
}

describe('legacy XLSX import', () => {
  it('extracts raw classes and ignores exported means and deviations', async () => {
    const parsed = await legacyXlsx.parse(workbookFile(), { JSZip, DOMParser })

    expect(parsed).toMatchObject({
      researcher: 'Helen',
      agent: 'VKM35',
      cells: 'V79',
      target: 100,
      slidesPerTreatment: 2,
      replicateCount: 3,
      absentCount: 0,
      suggestedUnit: 'µM'
    })
    expect(parsed.treatments).toEqual(['MMS', 'DMEM/F12', 'DMSO', '1.25 µM', '12.5 µM', '50.0 µM', '100.0 µM'])
    expect(parsed.entries).toHaveLength(42)
    expect(parsed.mismatches.map(item => item.total)).toEqual([103, 104, 104, 99])
    expect(parsed.entries[0].counts).toEqual([0, 6, 28, 28, 38])
  })

  it('does not depend on treatment names or require a solvent control', async () => {
    const parsed = await legacyXlsx.parse(workbookFile(), { JSZip, DOMParser })
    parsed.treatments = parsed.treatments.map((_, index) => `Treatment ${index + 1}`)
    parsed.entries.forEach(entry => { entry.treatment = parsed.treatments[entry.treatmentIndex] })
    const imported = legacyXlsx.buildExperiment(parsed, { roles: roles(parsed, false), unit: 'µM' }, () => 'imported-id')
    const validation = core.validateExperiment(imported, { source: 'import' })

    expect(validation.valid).toBe(true)
    expect(imported.solControl).toBe('')
    expect(imported.treatments[0]).toBe('Treatment 1')
    expect(imported.replicates).toHaveLength(3)
    expect(imported.replicates.flatMap(item => item.gels)).toHaveLength(42)
  })

  it('maps five empty class cells to an absent slide without creating a gel', async () => {
    const file = await workbookWithoutCells(['B10', 'B22', 'B34', 'B46', 'B58'])
    const parsed = await legacyXlsx.parse(file, { JSZip, DOMParser })
    const imported = legacyXlsx.buildExperiment(parsed, { roles: roles(parsed), unit: 'µM' }, () => 'imported-id')
    const first = imported.replicates[0]

    expect(first.assignments[0]).toMatchObject({ status: 'absent', absenceReason: { code: 'legacy-unjustified' } })
    expect(first.gels).toHaveLength(13)
    expect(core.validateExperiment(imported, { source: 'import' }).valid).toBe(true)
  })

  it('rejects a partially filled set of classes instead of treating blanks as zero', async () => {
    const file = await workbookWithoutCells(['B10'])
    await expect(legacyXlsx.parse(file, { JSZip, DOMParser })).rejects.toThrow('partial-count:1:1')
  })

  it('preserves off-target counts and scores them using their effective totals', async () => {
    const parsed = await legacyXlsx.parse(workbookFile(), { JSZip, DOMParser })
    const imported = legacyXlsx.buildExperiment(parsed, { roles: roles(parsed), unit: 'µM' }, () => 'imported-id')
    const overTarget = imported.replicates[0].gels.find(gel => gel.treatmentIndex === 6 && gel.gelNumber === 1)

    expect(overTarget).toMatchObject({ total: 103, completion: 'incomplete' })
    expect(core.isIncludedGel(overTarget)).toBe(true)
    expect(core.calculateVisualScore(overTarget)).toBeCloseTo(64.5 / 103 * 100)
  })
})
