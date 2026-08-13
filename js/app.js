// CometQuant Lab - application state, counting and local persistence

const STORAGE_KEY = 'cometquant-experiments'
const SCHEMA_VERSION = CometQuantCore.SCHEMA_VERSION

let currentExperiment = null
let currentTreatmentIndex = 0
let currentGelIndex = 0
let currentReplicateNumber = null
let clickHistory = []
let currentCounts = emptyCounts()

document.addEventListener('DOMContentLoaded', () => {
  applyLanguage()
  updateLanguageButtons()
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
  originalSetLanguage(lang)
  updateLanguageButtons()
  if (document.getElementById('screen-experiments').classList.contains('active')) renderExperimentsList()
  if (document.getElementById('screen-replicates').classList.contains('active')) renderReplicatesScreen()
  if (document.getElementById('screen-code-entry').classList.contains('active')) renderCodeEntry()
  if (document.getElementById('screen-summary').classList.contains('active')) renderSummaryTable()
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
  document.getElementById('btn-back-counter').addEventListener('click', () => {
    persistProgress()
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-back-summary').addEventListener('click', () => {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  })
  document.getElementById('btn-back-analysis').addEventListener('click', () => showScreen('screen-summary'))
  document.getElementById('btn-go-to-analysis').addEventListener('click', () => showScreen('screen-analysis'))
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

function handleCreateExperiment() {
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
  const concentrations = Array.from({ length: Number.isInteger(conditions) && conditions > 0 ? conditions : 0 }, (_, index) => Number(valueOf(`input-conc-${index}`)))
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
  currentExperiment = {
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

  const replicate = createBlindReplicate(1)
  currentExperiment.replicates.push(replicate)
  if (!saveExperiment()) return
  showBlindCodes(replicate)
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

function createBlindReplicate(replicateNumber) {
  const usedCodes = new Set()
  const assignments = []
  currentExperiment.treatments.forEach((treatment, treatmentIndex) => {
    let baseCode
    do baseCode = randomBlindCode()
    while (usedCodes.has(baseCode))
    usedCodes.add(baseCode)

    for (let gelIndex = 0; gelIndex < currentExperiment.slidesPerTreatment; gelIndex++) {
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
    actions.append(
      actionButton(experiment.progress ? t('experiments.continue') : t('experiments.open'), 'btn-primary', () => openExperiment(experiment.id)),
      actionButton(t('experiments.export'), 'btn-secondary', () => {
        if (hasPendingSlides(experiment)) return alert(t('alert.blindingActive'))
        exportExperimentData(experiment)
      }),
      actionButton(t('experiments.delete'), 'btn-danger', () => deleteExperiment(experiment.id))
    )
    card.append(heading, meta, status, actions)
    container.appendChild(card)
  })
}

function openExperiment(id) {
  currentExperiment = getAllExperiments().find(item => item.id === id) || null
  if (!currentExperiment) return showExperimentsScreen()
  if (currentExperiment.progress) {
    restoreProgress()
    startCounting(true)
    return
  }
  renderReplicatesScreen()
  showScreen('screen-replicates')
}

function deleteExperiment(id) {
  if (!confirm(t('experiments.deleteConfirm'))) return
  const experiments = getAllExperiments().filter(item => item.id !== id)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(experiments))
    if (currentExperiment && currentExperiment.id === id) currentExperiment = null
    renderExperimentsList()
  } catch {
    alert(t('counter.saveFailed'))
  }
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

function handleBlindCode() {
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
    assignment.status = 'absent'
    assignment.absenceReason = { code: reasonCode, detail }
    assignment.recordedAt = new Date().toISOString()
    saveExperiment()
    afterSlideProcessed(replicate)
    return
  }

  currentTreatmentIndex = assignment.treatmentIndex
  currentGelIndex = assignment.gelNumber - 1
  currentReplicateNumber = replicate.replicateNumber
  currentCounts = emptyCounts()
  clickHistory = []
  assignment.status = 'counting'
  persistProgress()
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

function startCounting(restoring = false) {
  if (!restoring) {
    currentCounts = emptyCounts()
    clickHistory = []
    persistProgress()
  }
  document.getElementById('screen-counter').classList.remove('complete')
  document.getElementById('input-incomplete-reason').value = ''
  document.getElementById('input-incomplete-detail').value = ''
  document.getElementById('incomplete-reason-panel').hidden = true
  updateReasonDetails()
  updateCounterDisplay()
  showScreen('screen-counter')
}

function registerCount(cometClass) {
  if (!currentExperiment || getTotalCount() >= currentExperiment.nucleoidsPerGel) return
  currentCounts[cometClass]++
  clickHistory.push(cometClass)
  updateCounterDisplay()
  persistProgress()
  const card = document.getElementById(`card-class-${cometClass}`)
  card.classList.add('pulse')
  setTimeout(() => card.classList.remove('pulse'), 300)
}

function undoLastCount() {
  if (!clickHistory.length) return
  const lastClass = clickHistory.pop()
  if (currentCounts[lastClass] > 0) currentCounts[lastClass]--
  updateCounterDisplay()
  persistProgress()
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

function handleFinishGel() {
  const total = getTotalCount()
  const target = currentExperiment.nucleoidsPerGel
  if (total < target) {
    document.getElementById('incomplete-reason-panel').hidden = false
    document.getElementById('incomplete-warning').textContent = `${total} / ${target}: ${t('counter.incompleteWarning')}`
    const reasonCode = valueOf('input-incomplete-reason')
    const detail = valueOf('input-incomplete-detail')
    if (!reasonCode) return alert(t('counter.incompleteWarning'))
    if (reasonCode === 'other' && !detail) return alert(t('reason.detailRequired'))
  }

  const replicate = findReplicate(currentReplicateNumber)
  const assignment = findCurrentAssignment()
  if (!replicate || !assignment) return
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
  const existing = replicate.gels.findIndex(gel => gel.blindCode === assignment.blindCode)
  if (existing >= 0) replicate.gels[existing] = gelData
  else replicate.gels.push(gelData)
  assignment.status = 'counted'
  assignment.recordedAt = gelData.recordedAt
  replicate.updatedAt = gelData.recordedAt
  currentExperiment.progress = null
  saveExperiment()
  afterSlideProcessed(replicate)
}

function afterSlideProcessed(replicate) {
  const pending = (replicate.assignments || []).some(item => item.status === 'pending' || item.status === 'counting')
  currentExperiment.progress = null
  currentExperiment.status = hasPendingSlides() ? 'in-progress' : 'completed'
  saveExperiment()
  if (pending) {
    currentReplicateNumber = replicate.replicateNumber
    renderCodeEntry()
    showScreen('screen-code-entry')
  } else {
    renderReplicatesScreen()
    showScreen('screen-replicates')
  }
}

function persistProgress() {
  if (!currentExperiment || currentReplicateNumber === null) return false
  const assignment = findCurrentAssignment()
  if (!assignment) return false
  currentExperiment.progress = {
    replicateNumber: currentReplicateNumber,
    treatmentIndex: currentTreatmentIndex,
    gelIndex: currentGelIndex,
    blindCode: assignment.blindCode,
    counts: [currentCounts[0], currentCounts[1], currentCounts[2], currentCounts[3], currentCounts[4]],
    clickHistory: [...clickHistory],
    updatedAt: new Date().toISOString()
  }
  assignment.status = 'counting'
  return saveExperiment(true)
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

function saveExperiment(showStatus = false) {
  if (!currentExperiment) return false
  currentExperiment.updatedAt = new Date().toISOString()
  const validation = CometQuantCore.validateExperiment(currentExperiment, { source: 'local' })
  if (!validation.valid) {
    console.error('Invalid experiment:', validation.errors)
    if (showStatus) setSaveStatus(t('counter.saveFailed'), true)
    else alert(t('alert.invalidData'))
    return false
  }
  currentExperiment = validation.experiment
  const experiments = getAllExperiments()
  const index = experiments.findIndex(item => item.id === currentExperiment.id)
  if (index >= 0) experiments[index] = currentExperiment
  else experiments.push(currentExperiment)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(experiments))
    if (showStatus) setSaveStatus(t('counter.saved'), false)
    return true
  } catch {
    if (showStatus) setSaveStatus(t('counter.saveFailed'), true)
    else alert(t('counter.saveFailed'))
    return false
  }
}

function getAllExperiments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizeExperiment).filter(Boolean) : []
  } catch {
    return []
  }
}

function normalizeExperiment(experiment) {
  try {
    return CometQuantCore.migrateExperiment(experiment)
  } catch (error) {
    console.error('Could not migrate experiment:', error)
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

function handleAddReplicate() {
  if (!currentExperiment) return
  if (currentExperiment.progress) {
    restoreProgress()
    startCounting(true)
    return
  }
  const nextNumber = Math.max(0, ...currentExperiment.replicates.map(rep => Number(rep.replicateNumber) || 0)) + 1
  const replicate = createBlindReplicate(nextNumber)
  currentExperiment.replicates.push(replicate)
  currentExperiment.status = 'in-progress'
  saveExperiment()
  showBlindCodes(replicate)
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
  const blob = new Blob([JSON.stringify(experiment, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeAgent = (experiment.agent || 'Experiment').replace(/[^a-z0-9_-]+/gi, '_')
  anchor.href = url
  anchor.download = `CometQuant_${safeAgent}_${new Date().toISOString().split('T')[0]}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function handleLoadFiles(event) {
  const files = Array.from(event.target.files)
  event.target.value = ''
  if (!files.length) return
  try {
    const imported = await Promise.all(files.map(readJsonFile))
    const experiments = imported.length > 1 ? [consolidateExperiments(imported)] : imported
    for (const raw of experiments) saveImportedExperiment(raw)
    showExperimentsScreen()
  } catch (error) {
    alert(error.message.includes('conflict') ? t('alert.importConflict') : t('alert.importError'))
  }
}

function saveImportedExperiment(raw) {
  const validation = CometQuantCore.validateExperiment(raw, { source: 'import' })
  if (!validation.valid) throw new Error(`Invalid experiment: ${validation.errors.join(',')}`)
  const experiment = validation.experiment
  const existingIds = new Set(getAllExperiments().map(item => item.id))
  if (existingIds.has(experiment.id)) experiment.id = createId()
  experiment.updatedAt = new Date().toISOString()
  currentExperiment = experiment
  saveExperiment()
}

function consolidateExperiments(experiments) {
  return CometQuantCore.mergeExperiments(experiments, createId)
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > CometQuantCore.MAX_FILE_SIZE) return reject(new Error(t('alert.fileTooLarge')))
    const reader = new FileReader()
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target.result)
        if (!data || !data.id || !Array.isArray(data.treatments) || !Array.isArray(data.replicates)) throw new Error()
        resolve(data)
      } catch {
        reject(new Error('Invalid CometQuant file'))
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function findReplicate(number) {
  return currentExperiment && currentExperiment.replicates.find(rep => Number(rep.replicateNumber) === Number(number))
}

function findCurrentAssignment() {
  const replicate = findReplicate(currentReplicateNumber)
  if (!replicate || !replicate.assignments) return null
  if (currentExperiment.progress && currentExperiment.progress.blindCode) {
    const byCode = replicate.assignments.find(item => item.blindCode === currentExperiment.progress.blindCode)
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
