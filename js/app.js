// CometQuant Lab - application state, counting and local persistence

const STORAGE_KEY = 'cometquant-experiments'
const HAPTIC_FEEDBACK_KEY = 'cometquant-haptic-feedback'
const SCHEMA_VERSION = CometQuantCore.SCHEMA_VERSION
const MAX_IMPORT_FILES = 20
const MAX_IMPORT_BATCH_SIZE = 25 * 1024 * 1024

let currentExperiment = null
let currentTreatmentIndex = 0
let currentGelIndex = 0
let currentReplicateNumber = null
let clickHistory = []
let currentCounts = emptyCounts()
let currentExperimentRevision = 0
let countMutationQueue = Promise.resolve()
let countingClosing = false
let recoveryAvailable = false
let creatingExperiment = false
let blindCodeCommitPending = false
let replicateCommitPending = false
let hapticFeedbackEnabled = false
const revealedLegacyMappings = new Set()

document.addEventListener('DOMContentLoaded', async () => {
  applyLanguage()
  updateLanguageButtons()
  initHapticFeedback()
  try {
    const storage = await CometQuantRepository.init({ storageKey: STORAGE_KEY })
    CometQuantRepository.subscribe(handleRepositoryEvent)
    recoveryAvailable = storage.quarantined > 0
    document.getElementById('btn-export-recovery').hidden = !recoveryAvailable
    if (recoveryAvailable) alert(t('storage.quarantine').replace('{count}', String(storage.quarantined)))
  } catch (error) {
    console.error('Storage initialization error:', error)
    alert(t('storage.unavailable'))
    return
  }
  initNavigation()
  initSetup()
  initCounter()
  initExperimentScreens()
  initSummary()
})

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'))
  const target = document.getElementById(screenId)
  if (target) {
    target.classList.add('active')
    target.scrollTop = 0
  }
}

function updateLanguageButtons() {
  document.getElementById('btn-lang-en').classList.toggle('active', currentLanguage === 'en')
  document.getElementById('btn-lang-pt').classList.toggle('active', currentLanguage === 'pt')
}

const originalSetLanguage = setLanguage
window.setLanguage = function (lang) {
  const previousLanguage = currentLanguage
  originalSetLanguage(lang)
  if (previousLanguage !== currentLanguage) invalidateAnalysisResults()
  updateLanguageButtons()
  if (document.getElementById('screen-experiments').classList.contains('active')) renderExperimentsList()
  if (document.getElementById('screen-replicates').classList.contains('active')) renderReplicatesScreen()
  if (document.getElementById('screen-code-entry').classList.contains('active')) renderCodeEntry()
  if (document.getElementById('screen-summary').classList.contains('active')) renderSummaryTable()
  if (document.getElementById('screen-analysis').classList.contains('active')) renderAnalysisState()
}

function initNavigation() {
  document.getElementById('btn-new-experiment').addEventListener('click', () => {
    resetSetupForm()
    showScreen('screen-setup')
  })
  document.getElementById('btn-resume-experiment').addEventListener('click', showExperimentsScreen)
  document.getElementById('btn-back-setup').addEventListener('click', () => showScreen('screen-home'))
  document.getElementById('btn-back-experiments').addEventListener('click', () => showScreen('screen-home'))
  document.getElementById('btn-back-replicates').addEventListener('click', showExperimentsScreen)
  document.getElementById('btn-back-code-entry').addEventListener('click', () => {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-back-counter').addEventListener('click', async () => {
    if (countingClosing) return
    countingClosing = true
    await countMutationQueue
    if (!await persistProgress()) {
      countingClosing = false
      return
    }
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-back-summary').addEventListener('click', () => {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-back-analysis').addEventListener('click', () => showScreen('screen-summary'))
  document.getElementById('btn-go-to-analysis').addEventListener('click', () => {
    showScreen('screen-analysis')
    enterAnalysisScreen()
  })
}

function initSetup() {
  document.getElementById('input-conditions').addEventListener('input', generateConcentrationInputs)
  document.getElementById('input-conc-unit').addEventListener('change', generateConcentrationInputs)
  document.getElementById('btn-start-counting').addEventListener('click', handleCreateExperiment)
}

function generateConcentrationInputs() {
  const container = document.getElementById('concentrations-container')
  const previous = Array.from(container.querySelectorAll('input')).map(input => input.value)
  const count = Math.min(CometQuantCore.LIMITS.concentrations, Number(document.getElementById('input-conditions').value) || 0)
  const unit = document.getElementById('input-conc-unit').value
  container.replaceChildren()

  for (let index = 0; index < count; index++) {
    const group = document.createElement('div')
    group.className = 'form-group'
    const label = document.createElement('label')
    label.htmlFor = `input-conc-${index}`
    label.textContent = `${t('setup.concentration')} ${index + 1}${unit ? ` (${unit})` : ''}`
    const input = document.createElement('input')
    input.type = 'number'
    input.id = `input-conc-${index}`
    input.placeholder = '0'
    input.min = '0'
    input.step = 'any'
    input.required = true
    input.value = previous[index] || ''
    group.append(label, input)
    container.appendChild(group)
  }
}

async function handleCreateExperiment() {
  if (creatingExperiment) return
  const researcher = valueOf('input-researcher')
  const agent = valueOf('input-agent')
  const cells = valueOf('input-cells')
  const negControl = valueOf('input-neg-control')
  const posControl = valueOf('input-pos-control')
  const solControl = valueOf('input-sol-control')
  const nucleoids = Number(valueOf('input-nucleoids'))
  const slidesPerTreatment = Number(valueOf('input-slides-per-treatment'))
  const conditions = Number(valueOf('input-conditions'))
  const concUnit = valueOf('input-conc-unit')
  const concentrationValues = Array.from({ length: Number.isInteger(conditions) && conditions > 0 ? conditions : 0 }, (_, index) => valueOf(`input-conc-${index}`))
  const concentrations = concentrationValues.map(value => value === '' ? NaN : Number(value))
  const validation = CometQuantCore.validateSetup({ researcher, agent, cells, negControl, posControl, solControl, nucleoidsPerGel: nucleoids, slidesPerTreatment, conditions, concUnit, concentrations })
  if (!validation.valid) {
    if (validation.errors.includes('agent-required') || validation.errors.includes('cells-required')) return alert(t('alert.needAgentCells'))
    if (validation.errors.includes('control-required')) return alert(t('alert.needControl'))
    if (validation.errors.includes('invalid-nucleoidsPerGel')) return alert(t('alert.needNucleoids'))
    if (validation.errors.includes('invalid-slidesPerTreatment')) return alert(t('alert.needSlides'))
    if (validation.errors.includes('invalid-conditions')) return alert(t('alert.needConditions'))
    return alert(t('alert.needUnitConcentrations'))
  }

  const treatments = []
  if (posControl) treatments.push(posControl)
  if (negControl) treatments.push(negControl)
  if (solControl) treatments.push(solControl)
  for (let index = 0; index < conditions; index++) {
    treatments.push(`${concentrations[index]} ${concUnit}`)
  }

  const now = new Date().toISOString()
  const experiment = {
    schemaVersion: SCHEMA_VERSION,
    id: createId(),
    createdAt: now,
    updatedAt: now,
    status: 'in-progress',
    researcher,
    agent,
    cells,
    negControl,
    posControl,
    solControl,
    nucleoidsPerGel: nucleoids,
    slidesPerTreatment,
    concUnit,
    treatments,
    replicates: [],
    progress: null
  }

  experiment.replicates.push(createBlindReplicate(1, experiment))
  creatingExperiment = true
  const saved = await saveExperiment(experiment)
  creatingExperiment = false
  if (!saved) return
  showBlindCodes(currentExperiment.replicates[0])
}

function resetSetupForm() {
  ;['input-researcher', 'input-agent', 'input-cells', 'input-neg-control', 'input-pos-control',
    'input-sol-control', 'input-nucleoids', 'input-conditions'].forEach(id => {
    document.getElementById(id).value = ''
  })
  document.getElementById('input-slides-per-treatment').value = '1'
  document.getElementById('input-conc-unit').value = ''
  document.getElementById('concentrations-container').replaceChildren()
}

function createBlindReplicate(replicateNumber, experiment = currentExperiment) {
  const usedCodes = new Set()
  const assignments = []
  experiment.treatments.forEach((treatment, treatmentIndex) => {
    let baseCode
    do baseCode = randomBlindCode()
    while (usedCodes.has(baseCode))
    usedCodes.add(baseCode)

    for (let gelIndex = 0; gelIndex < experiment.slidesPerTreatment; gelIndex++) {
      assignments.push({
        blindCode: `${baseCode}-${String(gelIndex + 1).padStart(2, '0')}`,
        treatmentIndex,
        gelNumber: gelIndex + 1,
        status: 'pending'
      })
    }
  })

  return {
    replicateNumber,
    date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    gels: [],
    assignments
  }
}

function randomBlindCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const values = new Uint32Array(4)
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(values)
  else {
    for (let index = 0; index < values.length; index++) {
      values[index] = Math.floor(Math.random() * alphabet.length)
    }
  }
  return Array.from(values, value => alphabet[value % alphabet.length]).join('')
}

function showBlindCodes(replicate) {
  document.getElementById('blind-replicate-title').textContent = `${t('blind.replicate')} ${replicate.replicateNumber}`
  const container = document.getElementById('blind-codes-container')
  container.replaceChildren()
  currentExperiment.treatments.forEach((treatment, treatmentIndex) => {
    const card = document.createElement('div')
    card.className = 'blind-code-card'
    const name = document.createElement('strong')
    name.textContent = treatment
    const codes = document.createElement('div')
    codes.className = 'blind-code-values'
    replicate.assignments
      .filter(item => item.treatmentIndex === treatmentIndex)
      .forEach(item => {
        const code = document.createElement('code')
        code.textContent = item.blindCode
        codes.appendChild(code)
      })
    card.append(name, codes)
    container.appendChild(card)
  })
  showScreen('screen-blind-codes')
}

function initExperimentScreens() {
  document.getElementById('btn-close-blind-codes').addEventListener('click', () => {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-import-experiment').addEventListener('click', () => document.getElementById('input-load-files').click())
  document.getElementById('btn-export-recovery').addEventListener('click', exportStorageRecovery)
  document.getElementById('input-load-files').addEventListener('change', handleLoadFiles)
  document.getElementById('btn-generate-replicate').addEventListener('click', handleAddReplicate)
  document.getElementById('btn-open-summary').addEventListener('click', showSummary)
  document.getElementById('input-slide-absent').addEventListener('change', updateCodeEntryAction)
  document.getElementById('input-absence-reason').addEventListener('change', updateReasonDetails)
  document.getElementById('btn-submit-code').addEventListener('click', handleBlindCode)
  document.getElementById('input-blind-code').addEventListener('keydown', event => {
    if (event.key === 'Enter') handleBlindCode()
  })
}

function showExperimentsScreen() {
  renderExperimentsList()
  showScreen('screen-experiments')
}

function renderExperimentsList() {
  const container = document.getElementById('experiments-list')
  container.replaceChildren()
  const experiments = getAllExperiments().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  if (!experiments.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = t('experiments.empty')
    container.appendChild(empty)
    return
  }

  experiments.forEach(experiment => {
    const card = document.createElement('article')
    card.className = 'experiment-card'
    const heading = document.createElement('h3')
    heading.textContent = experiment.agent || t('setup.agent')
    const meta = document.createElement('p')
    meta.className = 'muted-text'
    meta.textContent = [experiment.cells, experiment.researcher].filter(Boolean).join(' · ')
    const status = document.createElement('p')
    status.className = 'experiment-status'
    status.textContent = `${experiment.progress || hasPendingSlides(experiment) ? t('experiments.inProgress') : t('experiments.completed')} · ${t('experiments.updated')}: ${formatDate(experiment.updatedAt)}`
    const actions = document.createElement('div')
    actions.className = 'card-actions'
    const pending = hasPendingSlides(experiment)
    actions.append(
      actionButton(experiment.progress ? t('experiments.continue') : t('experiments.open'), 'btn-primary', () => openExperiment(experiment.id)),
      actionButton(pending ? t('experiments.encryptedBackup') : t('experiments.export'), 'btn-secondary', () => pending ? exportEncryptedBackup(experiment) : exportExperimentData(experiment)),
      actionButton(t('experiments.delete'), 'btn-danger', () => deleteExperiment(experiment.id))
    )
    card.append(heading, meta, status, actions)
    container.appendChild(card)
  })
}

function openExperiment(id) {
  invalidateAnalysisResults()
  const record = CometQuantRepository.getRecord(id)
  currentExperiment = record?.data || null
  currentExperimentRevision = record?.revision || 0
  if (!currentExperiment) return showExperimentsScreen()
  if (currentExperiment.progress) {
    restoreProgress()
    startCounting(true)
    return
  }
  renderReplicatesScreen()
  showScreen('screen-replicates')
}

async function deleteExperiment(id) {
  if (!confirm(t('experiments.deleteConfirm'))) return
  try {
    await CometQuantRepository.remove(id, CometQuantRepository.getRevision(id))
    if (currentExperiment && currentExperiment.id === id) {
      currentExperiment = null
      currentExperimentRevision = 0
      invalidateAnalysisResults()
    }
    renderExperimentsList()
  } catch (error) {
    if (error instanceof CometQuantRepository.ConflictError) return handleStorageConflict()
    alert(t('counter.saveFailed'))
  }
}

function initHapticFeedback() {
  const input = document.getElementById('input-haptic-feedback')
  const supported = typeof navigator.vibrate === 'function'
  let storedPreference = null
  try { storedPreference = localStorage.getItem(HAPTIC_FEEDBACK_KEY) } catch (_) {}
  hapticFeedbackEnabled = supported && (storedPreference === null || storedPreference === 'true')
  input.checked = hapticFeedbackEnabled
  input.disabled = !supported
  input.addEventListener('change', () => {
    hapticFeedbackEnabled = supported && input.checked
    try { localStorage.setItem(HAPTIC_FEEDBACK_KEY, String(hapticFeedbackEnabled)) } catch (_) {}
  })
}

function provideHapticFeedback() {
  if (!hapticFeedbackEnabled || typeof navigator.vibrate !== 'function') return
  try { navigator.vibrate(10) } catch (_) {}
}

function renderReplicatesScreen() {
  if (!currentExperiment) return
  const meta = document.getElementById('replicate-experiment-meta')
  meta.replaceChildren()
  const heading = document.createElement('h3')
  heading.textContent = currentExperiment.agent || t('setup.agent')
  const detail = document.createElement('p')
  detail.className = 'muted-text'
  detail.textContent = [currentExperiment.cells, currentExperiment.researcher].filter(Boolean).join(' · ')
  meta.append(heading, detail)

  const container = document.getElementById('replicates-list')
  container.replaceChildren()
  currentExperiment.replicates.forEach(replicate => {
    const card = document.createElement('article')
    card.className = 'experiment-card'
    const assignments = replicate.assignments || []
    const counted = assignments.filter(item => item.status === 'counted').length
    const absent = assignments.filter(item => item.status === 'absent').length
    const pending = assignments.filter(item => item.status === 'pending' || item.status === 'counting').length
    const title = document.createElement('h3')
    title.textContent = `${t('blind.replicate')} ${replicate.replicateNumber}`
    const status = document.createElement('p')
    status.className = 'muted-text'
    status.textContent = assignments.length
      ? `${counted} ${t('replicates.counted')} · ${absent} ${t('replicates.absent')} · ${pending} ${t('replicates.pending')}`
      : `${replicate.gels.length} ${t('replicates.counted')}`
    card.append(title, status)
    if (assignments.length && pending > 0) {
      const isActive = currentExperiment.progress && currentExperiment.progress.replicateNumber === replicate.replicateNumber
      card.appendChild(actionButton(isActive ? t('replicates.continue') : t('replicates.analyze'), 'btn-primary', () => openReplicate(replicate.replicateNumber)))
    } else {
      const complete = document.createElement('span')
      complete.className = 'status-badge'
      complete.textContent = t('replicates.complete')
      card.appendChild(complete)
    }
    container.appendChild(card)
  })
}

function openReplicate(replicateNumber) {
  if (currentExperiment.progress) {
    restoreProgress()
    startCounting(true)
    return
  }
  const replicate = findReplicate(replicateNumber)
  const legacyKey = `${currentExperiment.id}:${replicateNumber}`
  if (Number(currentExperiment.migration?.sourceSchemaVersion) < 3 && replicate && !revealedLegacyMappings.has(legacyKey)) {
    revealedLegacyMappings.add(legacyKey)
    showBlindCodes(replicate)
    return
  }
  currentReplicateNumber = replicateNumber
  renderCodeEntry()
  showScreen('screen-code-entry')
  setTimeout(() => document.getElementById('input-blind-code').focus(), 0)
}

function renderCodeEntry() {
  const replicate = findReplicate(currentReplicateNumber)
  if (!replicate) return
  const assignments = replicate.assignments || []
  const processed = assignments.filter(item => item.status === 'counted' || item.status === 'absent').length
  document.getElementById('code-entry-replicate').textContent = `${t('blind.replicate')} ${replicate.replicateNumber}`
  document.getElementById('code-entry-progress').textContent = `${processed} / ${assignments.length} ${t('codeEntry.progress')}`
  document.getElementById('input-blind-code').value = ''
  document.getElementById('input-slide-absent').checked = false
  document.getElementById('input-absence-reason').value = ''
  document.getElementById('input-absence-detail').value = ''
  updateCodeEntryAction()
}

function updateCodeEntryAction() {
  const absent = document.getElementById('input-slide-absent').checked
  document.getElementById('absence-reason-group').hidden = !absent
  document.getElementById('btn-submit-code').textContent = absent ? t('codeEntry.registerAbsent') : t('codeEntry.start')
  updateReasonDetails()
}

function updateReasonDetails() {
  const absentOther = document.getElementById('input-slide-absent').checked && valueOf('input-absence-reason') === 'other'
  document.getElementById('absence-detail-group').hidden = !absentOther
  const incompleteOther = valueOf('input-incomplete-reason') === 'other'
  document.getElementById('incomplete-detail-group').hidden = !incompleteOther
}

async function handleBlindCode() {
  if (blindCodeCommitPending) return
  const replicate = findReplicate(currentReplicateNumber)
  if (!replicate) return
  const code = valueOf('input-blind-code').toUpperCase().replace(/\s/g, '')
  const assignment = (replicate.assignments || []).find(item => item.blindCode.toUpperCase() === code)
  if (!assignment) return alert(t('codeEntry.invalid'))
  if (assignment.status === 'counted' || assignment.status === 'absent') return alert(t('codeEntry.processed'))

  if (document.getElementById('input-slide-absent').checked) {
    const reasonCode = valueOf('input-absence-reason')
    const detail = valueOf('input-absence-detail')
    if (!reasonCode) return alert(t('codeEntry.reasonRequiredAlert'))
    if (reasonCode === 'other' && !detail) return alert(t('reason.detailRequired'))
    if (!confirm(`${assignment.blindCode}: ${t('codeEntry.confirmAbsent')}`)) return
    const candidate = cloneExperiment(currentExperiment)
    const candidateReplicate = findReplicate(replicate.replicateNumber, candidate)
    const candidateAssignment = candidateReplicate.assignments.find(item => item.blindCode === assignment.blindCode)
    candidateAssignment.status = 'absent'
    candidateAssignment.absenceReason = { code: reasonCode, detail }
    candidateAssignment.recordedAt = new Date().toISOString()
    candidate.status = hasPendingSlides(candidate) ? 'in-progress' : 'completed'
    blindCodeCommitPending = true
    const saved = await saveExperiment(candidate)
    blindCodeCommitPending = false
    if (!saved) return
    afterSlideProcessed(replicate.replicateNumber)
    return
  }

  currentTreatmentIndex = assignment.treatmentIndex
  currentGelIndex = assignment.gelNumber - 1
  currentReplicateNumber = replicate.replicateNumber
  currentCounts = emptyCounts()
  clickHistory = []
  blindCodeCommitPending = true
  const saved = await persistProgress(false)
  blindCodeCommitPending = false
  if (!saved) return
  startCounting(true)
}

function initCounter() {
  document.querySelectorAll('.comet-class-card').forEach(card => {
    card.addEventListener('click', () => registerCount(parseInt(card.dataset.class)))
    const button = card.querySelector('.btn-count')
    button.setAttribute('aria-label', `${currentLanguage === 'pt' ? 'Classe' : 'Class'} ${card.dataset.class}`)
  })
  document.getElementById('btn-undo').addEventListener('click', undoLastCount)
  document.getElementById('btn-finish-gel').addEventListener('click', handleFinishGel)
  document.getElementById('input-incomplete-reason').addEventListener('change', updateReasonDetails)
}

async function startCounting(restoring = false) {
  countingClosing = false
  if (!restoring) {
    currentCounts = emptyCounts()
    clickHistory = []
    if (!await persistProgress()) return false
  }
  document.getElementById('screen-counter').classList.remove('complete')
  document.getElementById('input-incomplete-reason').value = ''
  document.getElementById('input-incomplete-detail').value = ''
  document.getElementById('incomplete-reason-panel').hidden = true
  updateReasonDetails()
  updateCounterDisplay()
  showScreen('screen-counter')
  return true
}

function enqueueCountMutation(operation) {
  countMutationQueue = countMutationQueue.catch(() => {}).then(operation)
  return countMutationQueue
}

function registerCount(cometClass) {
  if (countingClosing) return
  return enqueueCountMutation(async () => {
    if (!currentExperiment || getTotalCount() >= currentExperiment.nucleoidsPerGel) return
    currentCounts[cometClass]++
    clickHistory.push(cometClass)
    updateCounterDisplay()
    provideHapticFeedback()
    if (!await persistProgress()) {
      clickHistory.pop()
      currentCounts[cometClass]--
      if (currentExperiment) updateCounterDisplay()
      return
    }
    const card = document.getElementById(`card-class-${cometClass}`)
    card.classList.add('pulse')
    setTimeout(() => card.classList.remove('pulse'), 300)
  })
}

function undoLastCount() {
  if (countingClosing) return
  return enqueueCountMutation(async () => {
    if (!currentExperiment || !clickHistory.length) return
    const lastClass = clickHistory.pop()
    if (currentCounts[lastClass] > 0) currentCounts[lastClass]--
    updateCounterDisplay()
    if (!await persistProgress()) {
      currentCounts[lastClass]++
      clickHistory.push(lastClass)
      if (currentExperiment) updateCounterDisplay()
    }
  })
}

function getTotalCount() {
  return Object.values(currentCounts).reduce((sum, value) => sum + value, 0)
}

function updateCounterDisplay() {
  const total = getTotalCount()
  const target = currentExperiment.nucleoidsPerGel
  const assignment = findCurrentAssignment()
  document.getElementById('counter-treatment-name').textContent = assignment ? assignment.blindCode : `${t('summary.gel')} ${currentGelIndex + 1}`
  document.getElementById('counter-gel-label').textContent = `${t('blind.replicate')} ${currentReplicateNumber}`
  document.getElementById('counter-progress').textContent = `${total} / ${target} ${t('counter.nucleoids')}`
  for (let index = 0; index <= 4; index++) document.getElementById(`count-${index}`).textContent = currentCounts[index]
  const percent = Math.min(100, (total / target) * 100)
  const bar = document.getElementById('progress-bar')
  bar.style.width = `${percent}%`
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(percent)))
  bar.style.backgroundColor = total >= target ? 'var(--color-success)' : 'var(--color-accent)'
  document.getElementById('screen-counter').classList.toggle('complete', total >= target)
  document.getElementById('btn-undo').disabled = clickHistory.length === 0
  if (total >= target) document.getElementById('incomplete-reason-panel').hidden = true
}

async function handleFinishGel() {
  if (countingClosing) return
  countingClosing = true
  await countMutationQueue
  if (!currentExperiment) {
    countingClosing = false
    return
  }
  const total = getTotalCount()
  const target = currentExperiment.nucleoidsPerGel
  if (total < target) {
    document.getElementById('incomplete-reason-panel').hidden = false
    document.getElementById('incomplete-warning').textContent = `${total} / ${target}: ${t('counter.incompleteWarning')}`
    const reasonCode = valueOf('input-incomplete-reason')
    const detail = valueOf('input-incomplete-detail')
    if (!reasonCode) {
      countingClosing = false
      return alert(t('counter.incompleteWarning'))
    }
    if (reasonCode === 'other' && !detail) {
      countingClosing = false
      return alert(t('reason.detailRequired'))
    }
  }

  const replicate = findReplicate(currentReplicateNumber)
  const assignment = findCurrentAssignment()
  if (!replicate || !assignment) {
    countingClosing = false
    return
  }
  const gelData = {
    blindCode: assignment.blindCode,
    treatment: currentExperiment.treatments[currentTreatmentIndex],
    treatmentIndex: currentTreatmentIndex,
    gelNumber: currentGelIndex + 1,
    class0: currentCounts[0],
    class1: currentCounts[1],
    class2: currentCounts[2],
    class3: currentCounts[3],
    class4: currentCounts[4],
    total,
    status: 'counted',
    completion: total === target ? 'complete' : 'incomplete',
    ...(total < target ? { incompleteReason: { code: valueOf('input-incomplete-reason'), detail: valueOf('input-incomplete-detail') } } : {}),
    recordedAt: new Date().toISOString()
  }
  const candidate = cloneExperiment(currentExperiment)
  const candidateReplicate = findReplicate(currentReplicateNumber, candidate)
  const candidateAssignment = findCurrentAssignment(candidate)
  const existing = candidateReplicate.gels.findIndex(gel => gel.blindCode === candidateAssignment.blindCode)
  if (existing >= 0) candidateReplicate.gels[existing] = gelData
  else candidateReplicate.gels.push(gelData)
  candidateAssignment.status = 'counted'
  candidateAssignment.recordedAt = gelData.recordedAt
  candidateReplicate.updatedAt = gelData.recordedAt
  candidate.progress = null
  candidate.status = hasPendingSlides(candidate) ? 'in-progress' : 'completed'
  if (!await saveExperiment(candidate)) {
    countingClosing = false
    return
  }
  afterSlideProcessed(replicate.replicateNumber)
}

function afterSlideProcessed(replicateNumber) {
  const replicate = findReplicate(replicateNumber)
  if (!replicate) return
  const pending = (replicate.assignments || []).some(item => item.status === 'pending' || item.status === 'counting')
  if (pending) {
    currentReplicateNumber = replicate.replicateNumber
    renderCodeEntry()
    showScreen('screen-code-entry')
  } else {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  }
}

async function persistProgress(showStatus = true) {
  if (!currentExperiment || currentReplicateNumber === null) return false
  const candidate = cloneExperiment(currentExperiment)
  const assignment = findCurrentAssignment(candidate)
  if (!assignment) return false
  candidate.progress = {
    replicateNumber: currentReplicateNumber,
    treatmentIndex: currentTreatmentIndex,
    gelIndex: currentGelIndex,
    blindCode: assignment.blindCode,
    counts: [currentCounts[0], currentCounts[1], currentCounts[2], currentCounts[3], currentCounts[4]],
    clickHistory: [...clickHistory],
    updatedAt: new Date().toISOString()
  }
  assignment.status = 'counting'
  return saveExperiment(candidate, showStatus)
}

function restoreProgress() {
  const progress = currentExperiment.progress
  currentReplicateNumber = progress.replicateNumber
  currentTreatmentIndex = progress.treatmentIndex
  currentGelIndex = progress.gelIndex
  currentCounts = {
    0: Number(progress.counts[0]) || 0,
    1: Number(progress.counts[1]) || 0,
    2: Number(progress.counts[2]) || 0,
    3: Number(progress.counts[3]) || 0,
    4: Number(progress.counts[4]) || 0
  }
  clickHistory = Array.isArray(progress.clickHistory) ? [...progress.clickHistory] : []
}

async function saveExperiment(candidate, showStatus = false, notify = true) {
  if (!candidate) return false
  const pendingExperiment = cloneExperiment(candidate)
  pendingExperiment.updatedAt = new Date().toISOString()
  const validation = CometQuantCore.validateExperiment(pendingExperiment, { source: 'local' })
  if (!validation.valid) {
    console.error('Invalid experiment:', validation.errors)
    if (showStatus) setSaveStatus(t('counter.saveFailed'), true)
    else if (notify) alert(t('alert.invalidData'))
    return false
  }
  try {
    const expectedRevision = currentExperiment?.id === validation.experiment.id
      ? currentExperimentRevision
      : CometQuantRepository.getRevision(validation.experiment.id)
    const record = await CometQuantRepository.put(validation.experiment, expectedRevision)
    currentExperiment = record.data
    currentExperimentRevision = record.revision
    invalidateAnalysisResults()
    if (showStatus) setSaveStatus(t('counter.saved'), false)
    return true
  } catch (error) {
    if (error instanceof CometQuantRepository.ConflictError) {
      handleStorageConflict()
      return false
    }
    if (showStatus) setSaveStatus(t('counter.saveFailed'), true)
    else if (notify) alert(t('counter.saveFailed'))
    return false
  }
}

function getAllExperiments() {
  return CometQuantRepository.list().map(normalizeExperiment).filter(Boolean)
}

function getStoredExperiments() {
  return CometQuantRepository.list()
}

function normalizeExperiment(experiment) {
  try {
    const validation = CometQuantCore.validateExperiment(experiment, { source: 'local' })
    if (!validation.valid) {
      console.error('Ignoring invalid local experiment:', validation.errors)
      return null
    }
    return validation.experiment
  } catch (error) {
    console.error('Could not validate local experiment:', error)
    return null
  }
}

function setSaveStatus(message, failed) {
  const element = document.getElementById('save-status')
  element.textContent = message
  element.classList.toggle('error', failed)
  clearTimeout(setSaveStatus.timeout)
  setSaveStatus.timeout = setTimeout(() => { element.textContent = '' }, 1200)
}

function initSummary() {
  document.getElementById('btn-export-experiment').addEventListener('click', () => exportExperimentData(currentExperiment))
  document.getElementById('btn-add-replicate').addEventListener('click', handleAddReplicate)
  initAnalysis()
}

async function handleAddReplicate() {
  if (replicateCommitPending) return
  if (!currentExperiment) return
  if (currentExperiment.progress) {
    restoreProgress()
    startCounting(true)
    return
  }
  if (hasPendingSlides(currentExperiment)) {
    alert(t('alert.pendingReplicate'))
    return
  }
  const nextNumber = Math.max(0, ...currentExperiment.replicates.map(rep => Number(rep.replicateNumber) || 0)) + 1
  const candidate = cloneExperiment(currentExperiment)
  candidate.replicates.push(createBlindReplicate(nextNumber, candidate))
  candidate.status = 'in-progress'
  replicateCommitPending = true
  const saved = await saveExperiment(candidate)
  replicateCommitPending = false
  if (!saved) return
  showBlindCodes(findReplicate(nextNumber))
}

function showSummary() {
  if (hasPendingSlides()) return alert(t('alert.blindingActive'))
  renderSummaryTable()
  showScreen('screen-summary')
}

function renderSummaryTable() {
  const container = document.getElementById('summary-table-container')
  container.replaceChildren()
  if (!currentExperiment) return
  currentExperiment.replicates.forEach(replicate => {
    const title = document.createElement('h3')
    title.className = 'summary-replicate-title'
    title.textContent = `${t('blind.replicate')} ${replicate.replicateNumber} — ${replicate.date}`
    container.appendChild(title)
    const wrapper = document.createElement('div')
    wrapper.className = 'table-scroll'
    const table = document.createElement('table')
    const header = document.createElement('tr')
    ;[t('summary.treatment'), t('summary.gel'), t('summary.status'), t('summary.reason'), t('summary.class0'), t('summary.class1'),
      t('summary.class2'), t('summary.class3'), t('summary.class4'), t('summary.total'), t('summary.score')]
      .forEach(text => appendCell(header, 'th', text))
    const thead = document.createElement('thead')
    thead.appendChild(header)
    const tbody = document.createElement('tbody')
    replicate.gels.forEach(gel => {
      const row = document.createElement('tr')
      const incomplete = gel.completion === 'incomplete'
      ;[gel.treatment, gel.gelNumber, incomplete ? t('summary.incomplete') : t('replicates.counted'), formatReason(gel.incompleteReason), gel.class0, gel.class1, gel.class2, gel.class3,
        gel.class4, gel.total, incomplete ? t('summary.excluded') : calculateScore(gel).toFixed(2)].forEach(value => appendCell(row, 'td', value))
      tbody.appendChild(row)
    })
    ;(replicate.assignments || []).filter(item => item.status === 'absent').forEach(item => {
      const row = document.createElement('tr')
      row.className = 'absent-row'
      const treatment = currentExperiment.treatments[item.treatmentIndex]
      ;[treatment, item.gelNumber, t('summary.absent'), formatReason(item.absenceReason), '-', '-', '-', '-', '-', '-', '-'].forEach(value => appendCell(row, 'td', value))
      tbody.appendChild(row)
    })
    table.append(thead, tbody)
    wrapper.appendChild(table)
    container.appendChild(wrapper)
  })
}

function calculateScore(gel) {
  return CometQuantCore.calculateVisualScore(gel, currentExperiment.nucleoidsPerGel) || 0
}

function exportExperimentData(experiment) {
  if (!experiment) return
  const safeAgent = (experiment.agent || 'Experiment').replace(/[^a-z0-9_-]+/gi, '_')
  downloadJson(experiment, `CometQuant_${safeAgent}_${new Date().toISOString().split('T')[0]}.json`)
}

async function exportEncryptedBackup(experiment) {
  if (!experiment || typeof CometQuantBackup === 'undefined') return alert(t('backup.failed'))
  const passphrase = await requestBackupPassphrase(true)
  if (passphrase === null) return
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await CometQuantRepository.readRecord(experiment.id)
      if (!latest) throw new Error('experiment-not-found')
      const encrypted = await CometQuantBackup.encryptExperiment(latest.data, passphrase)
      const current = await CometQuantRepository.readRecord(experiment.id)
      if (current && current.revision === latest.revision) {
        downloadJson(encrypted, `CometQuant_blinded_${new Date().toISOString().split('T')[0]}.cqbackup.json`)
        return
      }
    }
    throw new Error('concurrent-update')
  } catch (error) {
    console.error('Encrypted backup error:', error)
    alert(t('backup.failed'))
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function exportStorageRecovery() {
  if (!recoveryAvailable) return
  try {
    const recovery = await CometQuantRepository.getRecoveryData()
    downloadJson(recovery, `CometQuant_storage_recovery_${new Date().toISOString().split('T')[0]}.json`)
  } catch (error) {
    console.error('Storage recovery export error:', error)
    alert(t('storage.recoveryFailed'))
  }
}

function requestBackupPassphrase(requireConfirmation) {
  const dialog = document.getElementById('backup-password-dialog')
  const password = document.getElementById('backup-password')
  const confirmation = document.getElementById('backup-password-confirmation')
  const confirmationGroup = document.getElementById('backup-confirmation-group')
  const showPassword = document.getElementById('backup-show-password')
  const error = document.getElementById('backup-dialog-error')
  const submit = document.getElementById('backup-dialog-submit')
  const cancel = document.getElementById('backup-dialog-cancel')
  document.getElementById('backup-dialog-title').textContent = t(requireConfirmation ? 'backup.encryptTitle' : 'backup.decryptTitle')
  document.getElementById('backup-dialog-message').textContent = t(requireConfirmation ? 'backup.passphrasePrompt' : 'backup.decryptPrompt')
  confirmationGroup.hidden = !requireConfirmation
  password.value = ''
  confirmation.value = ''
  password.type = 'password'
  confirmation.type = 'password'
  password.autocomplete = requireConfirmation ? 'new-password' : 'current-password'
  password.setAttribute('aria-invalid', 'false')
  confirmation.setAttribute('aria-invalid', 'false')
  showPassword.checked = false
  error.textContent = ''

  return new Promise(resolve => {
    const finish = value => {
      const result = value
      password.value = ''
      confirmation.value = ''
      dialog.close()
      resolve(result)
    }
    const validate = () => {
      if (!CometQuantBackup.isStrongPassphrase(password.value)) {
        error.textContent = t('backup.weakPassphrase')
        password.setAttribute('aria-invalid', 'true')
        password.focus()
        return
      }
      if (requireConfirmation && password.value !== confirmation.value) {
        error.textContent = t('backup.passwordMismatch')
        confirmation.setAttribute('aria-invalid', 'true')
        confirmation.focus()
        return
      }
      finish(password.value)
    }
    submit.onclick = validate
    cancel.onclick = () => finish(null)
    dialog.oncancel = event => {
      event.preventDefault()
      finish(null)
    }
    showPassword.onchange = () => {
      const type = showPassword.checked ? 'text' : 'password'
      password.type = type
      confirmation.type = type
    }
    password.oninput = () => {
      password.setAttribute('aria-invalid', 'false')
      confirmation.setAttribute('aria-invalid', 'false')
      error.textContent = ''
    }
    confirmation.oninput = password.oninput
    password.onkeydown = event => { if (event.key === 'Enter' && !requireConfirmation) validate() }
    confirmation.onkeydown = event => { if (event.key === 'Enter') validate() }
    dialog.showModal()
    setTimeout(() => password.focus(), 0)
  })
}

async function handleLoadFiles(event) {
  const files = Array.from(event.target.files)
  event.target.value = ''
  if (!files.length) return
  if (files.length > MAX_IMPORT_FILES) return alert(t('alert.tooManyFiles'))
  if (files.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BATCH_SIZE) return alert(t('alert.fileBatchTooLarge'))
  event.target.disabled = true
  try {
    const imported = []
    for (const file of files) imported.push(await readJsonFile(file))
    const experiments = imported.length > 1 ? [consolidateExperiments(imported)] : imported
    for (const raw of experiments) await saveImportedExperiment(raw)
    showExperimentsScreen()
  } catch (error) {
    if (error.message === 'backup-cancelled') return
    if (error.message === 'decryption-failed') return alert(t('backup.decryptFailed'))
    if (error.message === 'partial-progress-conflict') return alert(t('alert.partialMerge'))
    alert(error.message.includes('conflict') ? t('alert.importConflict') : t('alert.importError'))
  } finally {
    event.target.disabled = false
  }
}

async function saveImportedExperiment(raw) {
  const validation = CometQuantCore.validateExperiment(raw, { source: 'import' })
  if (!validation.valid) throw new Error(`Invalid experiment: ${validation.errors.join(',')}`)
  const experiment = validation.experiment
  const existingIds = new Set(getStoredExperiments().map(item => item?.id).filter(id => typeof id === 'string'))
  if (existingIds.has(experiment.id)) experiment.id = createId()
  experiment.updatedAt = new Date().toISOString()
  if (!await saveExperiment(experiment, false, false)) throw new Error('Could not persist imported experiment')
}

function consolidateExperiments(experiments) {
  return CometQuantCore.mergeExperiments(experiments, createId)
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const encryptedLimit = Math.ceil(CometQuantCore.MAX_FILE_SIZE * 4 / 3) + 8192
    const maxFileSize = file.name.toLowerCase().endsWith('.cqbackup.json') ? encryptedLimit : CometQuantCore.MAX_FILE_SIZE
    if (file.size > maxFileSize) return reject(new Error(t('alert.fileTooLarge')))
    const reader = new FileReader()
    reader.onload = async event => {
      try {
        let data = JSON.parse(event.target.result)
        if (typeof CometQuantBackup !== 'undefined' && CometQuantBackup.isEncryptedBackup(data)) {
          const passphrase = await requestBackupPassphrase(false)
          if (passphrase === null) throw new Error('backup-cancelled')
          try {
            data = await CometQuantBackup.decryptExperiment(data, passphrase)
          } catch {
            throw new Error('decryption-failed')
          }
        }
        if (!data || !data.id || !Array.isArray(data.treatments) || !Array.isArray(data.replicates)) throw new Error()
        resolve(data)
      } catch (error) {
        reject(error.message === 'backup-cancelled' || error.message === 'decryption-failed' ? error : new Error('Invalid CometQuant file'))
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function handleRepositoryEvent(event) {
  if (event.type === 'versionchange') {
    alert(t('storage.reloadRequired'))
    return
  }
  if (currentExperiment?.id === event.id) {
    handleStorageConflict()
    return
  }
  if (document.getElementById('screen-experiments').classList.contains('active')) renderExperimentsList()
}

function handleStorageConflict() {
  currentExperiment = null
  currentExperimentRevision = 0
  invalidateAnalysisResults()
  alert(t('storage.conflict'))
  showExperimentsScreen()
}

function findReplicate(number, experiment = currentExperiment) {
  return experiment && experiment.replicates.find(rep => Number(rep.replicateNumber) === Number(number))
}

function findCurrentAssignment(experiment = currentExperiment) {
  const replicate = findReplicate(currentReplicateNumber, experiment)
  if (!replicate || !replicate.assignments) return null
  if (experiment.progress && experiment.progress.blindCode) {
    const byCode = replicate.assignments.find(item => item.blindCode === experiment.progress.blindCode)
    if (byCode) return byCode
  }
  return replicate.assignments.find(item => item.treatmentIndex === currentTreatmentIndex && item.gelNumber === currentGelIndex + 1)
}

function hasPendingSlides(experiment = currentExperiment) {
  return CometQuantCore.hasPendingSlides(experiment)
}

function emptyCounts() {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
}

function cloneExperiment(experiment) {
  return JSON.parse(JSON.stringify(experiment))
}

function valueOf(id) {
  return document.getElementById(id).value.trim()
}

function createId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(currentLanguage === 'pt' ? 'pt-BR' : 'en-US')
}

function actionButton(label, className, handler) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', handler)
  return button
}

function appendCell(row, tag, value) {
  const cell = document.createElement(tag)
  cell.textContent = value
  row.appendChild(cell)
}

function formatReason(reason) {
  if (!reason) return '-'
  const key = {
    broken: 'codeEntry.reason.broken', lost: 'codeEntry.reason.lost', quality: 'codeEntry.reason.quality',
    insufficient: 'codeEntry.reason.insufficient', 'insufficient-cells': 'reason.insufficientCells',
    'poor-quality': 'reason.poorQuality', damaged: 'reason.damaged', 'technical-error': 'reason.technicalError',
    'time-limit': 'reason.timeLimit', other: 'reason.other', 'legacy-unjustified': 'summary.incomplete'
  }[reason.code]
  return `${key ? t(key) : reason.code}${reason.detail ? `: ${reason.detail}` : ''}`
}
