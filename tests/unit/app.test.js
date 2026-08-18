const fs = require('node:fs')
const path = require('node:path')
const core = require('../../js/core.js')

function loadAppFunctions() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/app.js'), 'utf8')
  const documentFacade = {
    addEventListener() {},
    createElement: (...args) => document.createElement(...args),
    getElementById: (...args) => document.getElementById(...args),
    body: document.body
  }
  return new Function(
    'CometQuantCore', 'document', 'window', 'setLanguage',
    `${source}\nreturn { buildTreatmentPlan, buildStudyDesign, updateSetupStudyDesign, requestLegacyStudyDesign }`
  )(core, documentFacade, {}, () => {})
}

describe('app schema 5 study design flow', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    globalThis.currentLanguage = 'en'
  })

  afterEach(() => {
    delete globalThis.currentLanguage
    vi.restoreAllMocks()
  })

  it.each([
    ['genotoxicity', 2, 2],
    ['antigenotoxicity', 1, 0]
  ])('builds and validates a pre-collection %s plan', (assayType, basalTreatmentIndex, primaryReferenceTreatmentIndex) => {
    const { buildTreatmentPlan, buildStudyDesign } = loadAppFunctions()
    const plan = buildTreatmentPlan('Positive', 'Negative', 'Vehicle', [1, 10], 'µM')
    const studyDesign = buildStudyDesign(assayType, basalTreatmentIndex, plan.treatmentMetadata, 'pre-collection')
    const validation = core.validateSetup({
      agent: 'Agent',
      cells: 'CHO-K1',
      posControl: 'Positive',
      negControl: 'Negative',
      solControl: 'Vehicle',
      nucleoidsPerGel: 100,
      slidesPerTreatment: 2,
      conditions: 2,
      concUnit: 'µM',
      concentrations: [1, 10],
      studyDesign
    }, { requireStudyDesign: true })

    expect(plan.treatments).toEqual(['Positive', 'Negative', 'Vehicle', '1 µM', '10 µM'])
    expect(plan.treatmentMetadata).toEqual([
      { treatmentIndex: 0, role: 'positive-control', concentration: null },
      { treatmentIndex: 1, role: 'negative-control', concentration: null },
      { treatmentIndex: 2, role: 'solvent-control', concentration: null },
      { treatmentIndex: 3, role: 'test-concentration', concentration: 1 },
      { treatmentIndex: 4, role: 'test-concentration', concentration: 10 }
    ])
    expect(studyDesign).toMatchObject({
      status: 'configured',
      assayType,
      primaryReferenceTreatmentIndex,
      primaryTreatmentIndices: [3, 4],
      validationComparison: { referenceTreatmentIndex: basalTreatmentIndex, treatmentIndex: 0 },
      alpha: 0.05,
      alternative: 'two-sided',
      pAdjustment: 'holm',
      trendReferenceAsZero: true,
      configurationSource: 'pre-collection'
    })
    expect(validation.valid).toBe(true)
  })

  it('preserves a basal role while its label changes and resets it when the control is removed', () => {
    const { updateSetupStudyDesign } = loadAppFunctions()
    document.body.append(
      input('input-neg-control', 'Negative'),
      input('input-sol-control', 'Vehicle'),
      input('input-pos-control', 'Positive'),
      select('input-assay-type', ['genotoxicity']),
      select('input-basal-reference'),
      document.createElement('output'),
      document.createElement('output')
    )
    document.body.children[5].id = 'setup-primary-reference'
    document.body.children[6].id = 'setup-validation-comparison'

    updateSetupStudyDesign()
    const basal = document.getElementById('input-basal-reference')
    basal.value = 'negative-control'
    document.getElementById('input-neg-control').value = 'Untreated'
    updateSetupStudyDesign()
    expect(basal.value).toBe('negative-control')
    expect(basal.selectedOptions[0].textContent).toBe('Untreated')

    document.getElementById('input-neg-control').value = ''
    updateSetupStudyDesign()
    expect(basal.value).toBe('')
    expect(Array.from(basal.options, option => option.value)).toEqual(['', 'solvent-control'])
  })

  it('requires explicit assay and basal selections for legacy configuration', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    const { requestLegacyStudyDesign } = loadAppFunctions()
    const experiment = {
      treatments: ['Positive', 'Negative', '1 µM'],
      treatmentMetadata: [
        { treatmentIndex: 0, role: 'positive-control', concentration: null },
        { treatmentIndex: 1, role: 'negative-control', concentration: null },
        { treatmentIndex: 2, role: 'test-concentration', concentration: 1 }
      ]
    }

    const selectionPromise = requestLegacyStudyDesign(experiment)
    const assay = document.getElementById('legacy-input-assay-type')
    const basal = document.getElementById('legacy-input-basal-reference')
    expect(assay.value).toBe('')
    expect(basal.value).toBe('')

    document.getElementById('btn-save-legacy-study-design').click()
    expect(alert).toHaveBeenCalledTimes(1)
    assay.value = 'antigenotoxicity'
    basal.value = '1'
    document.getElementById('btn-save-legacy-study-design').click()

    await expect(selectionPromise).resolves.toEqual({ assayType: 'antigenotoxicity', basalTreatmentIndex: 1 })
    expect(document.getElementById('legacy-study-design-dialog')).toBeNull()
  })
})

function input(id, value) {
  const element = document.createElement('input')
  element.id = id
  element.value = value
  return element
}

function select(id, values = []) {
  const element = document.createElement('select')
  element.id = id
  values.forEach(value => {
    const option = document.createElement('option')
    option.value = value
    element.appendChild(option)
  })
  return element
}
