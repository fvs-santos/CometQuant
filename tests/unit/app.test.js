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
    `${source}\nreturn { buildTreatmentPlan, buildStudyDesign, updateSetupStudyDesign, requestLegacyStudyDesign, requestAnalysisSelection, renderSummaryTable, setCurrentExperiment: value => { currentExperiment = value } }`
  )(core, documentFacade, {}, () => {})
}

describe('app schema 6 study design and correction flow', () => {
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

  it('requires a non-empty selection and a general reason when repetitions are excluded', async () => {
    vi.stubGlobal('t', key => ({
      'blind.replicate': 'Replicate',
      'legacyXlsx.unknownDate': 'date not provided',
      'analysis.selection.replicateDetail': '{date} / {counted} counted / {absent} absent',
      'analysis.selection.count': '{selected} of {total} selected',
      'analysis.selection.singleWarning': 'Single repetition warning',
      'analysis.selection.errorEmpty': 'Select at least one repetition.',
      'analysis.selection.errorReason': 'Enter a reason.'
    })[key] || key)
    analysisSelectionDialog()
    const { requestAnalysisSelection } = loadAppFunctions()
    const experiment = {
      replicates: [1, 2, 3].map(replicateNumber => ({
        replicateNumber,
        date: `2026-01-0${replicateNumber}`,
        assignments: [{ status: 'counted' }, { status: replicateNumber === 3 ? 'absent' : 'counted' }]
      }))
    }

    const selectionPromise = requestAnalysisSelection(experiment)
    const inputs = Array.from(document.querySelectorAll('#analysis-selection-list input'))
    expect(inputs).toHaveLength(3)
    expect(inputs.every(input => input.checked)).toBe(true)

    inputs.forEach(input => { input.checked = false })
    inputs[0].dispatchEvent(new Event('change'))
    document.getElementById('analysis-selection-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(document.getElementById('analysis-selection-error').textContent).toBe('Select at least one repetition.')

    inputs[0].checked = true
    inputs[2].checked = true
    inputs[0].dispatchEvent(new Event('change'))
    document.getElementById('analysis-selection-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(document.getElementById('analysis-selection-error').textContent).toBe('Enter a reason.')

    document.getElementById('analysis-selection-reason').value = 'Instrument failure'
    document.getElementById('analysis-selection-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const selection = await selectionPromise
    expect(selection).toMatchObject({
      selectionSchemaVersion: 1,
      mode: 'explicit',
      availableReplicateNumbers: [1, 2, 3],
      selectedReplicateNumbers: [1, 3],
      excludedReplicateNumbers: [2],
      exclusionReason: 'Instrument failure'
    })

    const reopenedPromise = requestAnalysisSelection(experiment, selection)
    const reopenedInputs = Array.from(document.querySelectorAll('#analysis-selection-list input'))
    expect(reopenedInputs.map(input => input.checked)).toEqual([true, false, true])
    expect(document.getElementById('analysis-selection-reason').value).toBe('Instrument failure')
    document.getElementById('btn-analysis-selection-cancel').click()
    await expect(reopenedPromise).resolves.toBeNull()
  })

  it('shows the effective-total score for a counted slide below the target', () => {
    vi.stubGlobal('t', key => ({
      'blind.replicate': 'Replicate', 'legacyXlsx.unknownDate': 'date not provided',
      'summary.treatment': 'Treatment', 'summary.gel': 'Slide', 'summary.status': 'Status', 'summary.reason': 'Reason',
      'summary.class0': 'Class 0', 'summary.class1': 'Class 1', 'summary.class2': 'Class 2', 'summary.class3': 'Class 3',
      'summary.class4': 'Class 4', 'summary.total': 'Total', 'summary.score': 'Score', 'summary.incomplete': 'Incomplete',
      'summary.offTargetIncluded': 'Off target (included)',
      'summary.excluded': 'Excluded from analysis', 'replicates.counted': 'counted'
    })[key] || key)
    const { renderSummaryTable, setCurrentExperiment } = loadAppFunctions()
    const container = document.createElement('div')
    container.id = 'summary-table-container'
    document.body.appendChild(container)
    setCurrentExperiment({
      treatments: ['1.25 µM'],
      nucleoidsPerGel: 100,
      slidesPerTreatment: 1,
      replicates: [{
        replicateNumber: 3,
        date: '',
        assignments: [],
        gels: [{
          treatment: '1.25 µM', treatmentIndex: 0, gelNumber: 2, status: 'counted', completion: 'incomplete',
          incompleteReason: { code: 'legacy-unjustified', detail: '' },
          class0: 26, class1: 34, class2: 23, class3: 9, class4: 7, total: 99
        }]
      }]
    })

    renderSummaryTable()

    const cells = Array.from(container.querySelectorAll('tbody td'), cell => cell.textContent)
    expect(cells[3]).toBe('Off target (included)')
    expect(cells[10]).toBe('99')
    expect(cells[11]).toBe('34.09')
    expect(cells[11]).not.toBe('Excluded from analysis')
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

function analysisSelectionDialog() {
  document.body.innerHTML = `
    <dialog id="analysis-selection-dialog">
      <form id="analysis-selection-form">
        <div id="analysis-selection-list"></div>
        <div id="analysis-selection-reason-group"><textarea id="analysis-selection-reason"></textarea></div>
        <output id="analysis-selection-count"></output>
        <p id="analysis-selection-warning"></p>
        <p id="analysis-selection-error"></p>
        <button type="button" id="btn-analysis-select-all"></button>
        <button type="button" id="btn-analysis-select-none"></button>
        <button type="button" id="btn-analysis-selection-cancel"></button>
      </form>
    </dialog>`
  const dialog = document.getElementById('analysis-selection-dialog')
  dialog.showModal = () => { dialog.open = true }
  dialog.close = () => { dialog.open = false }
}
