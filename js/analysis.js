// =============================================
// COMETQUANT LAB — analysis.js
// Módulo de análise estatística via Pyodide
// =============================================

const ANALYSIS_ENGINE_URL = './python/cometquant_analysis.py'
const ANALYSIS_SCHEMA_VERSION = 2
let analysisState = 'idle'
let analysisManifest = null
let analysisWorker = null
let analysisWorkerPromise = null
let analysisInitializationReject = null
let analysisInitController = null
let installController = null
let requestSequence = 0
let activeAnalysisRequest = null
let analysisRuntimeVersions = null
let analysisStatusKey = 'analysis.packageMissing'
let analysisStatusPercent = 0

function updatePyodideStatus(messageText, pct, icon = '...') {
  const status = document.getElementById('pyodide-status')
  const message = document.getElementById('pyodide-message')
  const progress = document.getElementById('pyodide-progress')
  const progressContainer = document.getElementById('pyodide-progress-container')
  const iconElement = document.getElementById('pyodide-icon')
  const percent = Math.max(0, Math.min(100, Math.round(pct)))
  if (message) message.textContent = messageText
  if (progress) progress.style.width = `${percent}%`
  if (progressContainer) progressContainer.setAttribute('aria-valuenow', String(percent))
  if (iconElement) iconElement.textContent = icon
  if (status) {
    status.classList.toggle('ready', analysisState === 'ready')
    status.classList.toggle('error', analysisState === 'error')
  }
}

function translatedStatus() {
  if (analysisState === 'downloading') {
    return t('analysis.downloading').replace('{percent}', String(analysisStatusPercent))
  }
  return t(analysisStatusKey)
}

function renderAnalysisState() {
  const button = document.getElementById('btn-run-analysis')
  const cancel = document.getElementById('btn-cancel-analysis')
  if (!button || !cancel) return

  const disabledStates = new Set(['idle', 'checking', 'downloading', 'initializing', 'running'])
  button.disabled = disabledStates.has(analysisState)
  cancel.hidden = !['downloading', 'initializing', 'running'].includes(analysisState)
  if (analysisState === 'missing') button.textContent = t('analysis.install')
  else if (analysisState === 'error') button.textContent = t('analysis.retry')
  else if (analysisState === 'running') button.textContent = t('analysis.running')
  else button.textContent = t('analysis.run')

  const icons = { missing: '-', checking: '...', downloading: 'v', initializing: '...', ready: 'OK', running: '...', error: '!' }
  updatePyodideStatus(translatedStatus(), analysisStatusPercent, icons[analysisState] || '...')
}

function setAnalysisState(state, statusKey, percent = 0) {
  analysisState = state
  analysisStatusKey = statusKey
  analysisStatusPercent = percent
  if (state !== 'error') document.getElementById('analysis-error').textContent = ''
  renderAnalysisState()
}

function showAnalysisError(error) {
  console.error('Scientific runtime error:', error)
  const detail = error instanceof Error ? error.message : String(error)
  document.getElementById('analysis-error').textContent = `${t('analysis.error')}: ${detail}`
  setAnalysisState('error', 'analysis.failed', 0)
}

async function waitForServiceWorkerControl(signal) {
  if (!('serviceWorker' in navigator)) throw new Error('service-worker-unavailable')
  await withTimeout(withAbort(navigator.serviceWorker.ready, signal), 15000, 'service-worker-ready-timeout')
  if (navigator.serviceWorker.controller) return
  const controllerChange = new Promise(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      resolve()
    }, { once: true })
  })
  await withTimeout(withAbort(controllerChange, signal), 10000, 'service-worker-not-controlling')
}

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    promise.then(value => {
      clearTimeout(timer)
      resolve(value)
    }, error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function withAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

async function enterAnalysisScreen() {
  if (analysisState === 'ready' || analysisState === 'running' || analysisState === 'initializing' || analysisState === 'downloading') return
  setAnalysisState('checking', 'analysis.checking', 0)
  try {
    analysisManifest = await CometQuantScience.fetchManifest()
    if (!await CometQuantScience.isInstalled(analysisManifest)) {
      setAnalysisState('missing', 'analysis.packageMissing', 0)
      return
    }
    await initializeAnalysisWorker()
  } catch (error) {
    showAnalysisError(error)
  }
}

async function installSciencePackage() {
  installController = new AbortController()
  setAnalysisState('downloading', 'analysis.downloading', 0)
  try {
    analysisManifest = analysisManifest || await CometQuantScience.fetchManifest()
    await CometQuantScience.install(analysisManifest, {
      signal: installController.signal,
      onProgress: ({ downloaded, total }) => {
        analysisStatusPercent = Math.min(100, Math.round((downloaded / total) * 100))
        renderAnalysisState()
      }
    })
    await initializeAnalysisWorker()
  } catch (error) {
    if (error.name === 'AbortError') setAnalysisState('missing', 'analysis.cancelled', 0)
    else showAnalysisError(error)
  } finally {
    installController = null
  }
}

function verifyRuntimeVersions(versions) {
  const expected = analysisManifest.expectedVersions
  Object.keys(expected).forEach(name => {
    if (versions[name] !== expected[name]) throw new Error(`science-version-${name}-${versions[name]}`)
  })
}

async function initializeAnalysisWorker() {
  if (analysisWorkerPromise) return analysisWorkerPromise
  setAnalysisState('initializing', 'analysis.initializing', 0)
  analysisInitController = new AbortController()
  const initSignal = analysisInitController.signal
  analysisWorkerPromise = (async () => {
    await waitForServiceWorkerControl(initSignal)
    initSignal.throwIfAborted()
    analysisWorker = new Worker('./js/analysis-worker.js')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('analysis-worker-init-timeout')), 120000)
      const finishInitialization = callback => value => {
        clearTimeout(timeout)
        analysisInitializationReject = null
        callback(value)
      }
      const resolveInitialization = finishInitialization(resolve)
      const rejectInitialization = finishInitialization(reject)
      analysisInitializationReject = rejectInitialization
      analysisWorker.addEventListener('message', event => {
        const message = event.data
        if (message.type === 'status') {
          const phases = { runtime: ['analysis.loadingRuntime', 25], packages: ['analysis.loadingPackages', 65], engine: ['analysis.loadingEngine', 90] }
          const phase = phases[message.phase]
          if (phase) setAnalysisState('initializing', phase[0], phase[1])
        } else if (message.type === 'ready') {
          try {
            verifyRuntimeVersions(message.versions)
            analysisRuntimeVersions = message.versions
            resolveInitialization()
          } catch (error) {
            rejectInitialization(error)
          }
        } else if (message.type === 'error' && !message.requestId) {
          rejectInitialization(new Error(message.message))
        } else {
          handleAnalysisWorkerMessage(message)
        }
      })
      analysisWorker.addEventListener('error', event => rejectInitialization(new Error(event.message || 'analysis-worker-crashed')), { once: true })
      analysisWorker.postMessage({
        type: 'init',
        indexUrl: CometQuantScience.indexUrl(analysisManifest),
        packages: analysisManifest.packages,
        engineUrl: new URL(ANALYSIS_ENGINE_URL, document.baseURI).href
      })
    })
    analysisInitController = null
    setAnalysisState('ready', 'analysis.ready', 100)
  })().catch(error => {
    terminateAnalysisWorker()
    if (error.name === 'AbortError') setAnalysisState('error', 'analysis.cancelled', 0)
    else showAnalysisError(error)
    throw error
  })
  return analysisWorkerPromise
}

function terminateAnalysisWorker() {
  analysisInitController?.abort(new DOMException('Aborted', 'AbortError'))
  analysisInitController = null
  if (analysisWorker) analysisWorker.terminate()
  analysisWorker = null
  analysisWorkerPromise = null
  analysisInitializationReject = null
  activeAnalysisRequest = null
}


// =============================================
// INTERFACE — orquestra análise e renderização
// =============================================

function initAnalysis() {
  document.getElementById('btn-run-analysis')
    .addEventListener('click', () => {
      if (analysisState === 'missing') installSciencePackage()
      else if (analysisState === 'error') enterAnalysisScreen()
      else if (analysisState === 'ready') runAnalysis()
    })

  document.getElementById('btn-cancel-analysis')
    .addEventListener('click', cancelAnalysis)

  document.getElementById('btn-export-report')
    .addEventListener('click', exportReport)

  document.getElementById('btn-export-csv')
    .addEventListener('click', exportCsv)

  document.getElementById('btn-export-zip')
    .addEventListener('click', exportZip)

  setAnalysisState('idle', 'analysis.packageMissing', 0)
}


function runAnalysis() {
  if (!currentExperiment) {
    alert(t('analysis.errorNoData'))
    return
  }

  if (hasPendingSlides(currentExperiment)) {
    alert(t('alert.blindingActive'))
    return
  }

  const experimentContext = {
    id: currentExperiment.id,
    updatedAt: currentExperiment.updatedAt,
    lang: currentLanguage
  }

  const requestId = ++requestSequence
  activeAnalysisRequest = { requestId, context: experimentContext }
  setAnalysisState('running', 'analysis.running', 100)
  analysisWorker.postMessage({
    type: 'analyze',
    requestId,
    context: experimentContext,
    experimentJson: JSON.stringify(currentExperiment),
    lang: currentLanguage
  })
}

function handleAnalysisWorkerMessage(message) {
  if (!activeAnalysisRequest || message.requestId !== activeAnalysisRequest.requestId) return
  if (message.type === 'error') {
    activeAnalysisRequest = null
    setAnalysisState('ready', 'analysis.ready', 100)
    document.getElementById('analysis-error').textContent = `${t('analysis.error')}: ${message.message}`
    return
  }
  if (message.type !== 'result') return
  const context = activeAnalysisRequest.context
  activeAnalysisRequest = null
  if (!currentExperiment || currentExperiment.id !== context.id || currentExperiment.updatedAt !== context.updatedAt || currentLanguage !== context.lang) {
    invalidateAnalysisResults()
    setAnalysisState('ready', 'analysis.ready', 100)
    return
  }
  try {
    const result = JSON.parse(message.resultJson)
    validateAnalysisResult(result)
    analysisResults = result
    analysisResultsContext = context
    renderAnalysisResults(analysisResults)
    document.getElementById('analysis-results').style.display = 'block'
    setAnalysisState('ready', 'analysis.done', 100)
  } catch (error) {
    invalidateAnalysisResults()
    setAnalysisState('ready', 'analysis.ready', 100)
    document.getElementById('analysis-error').textContent = `${t('analysis.error')}: ${error.message}`
  }
}

async function cancelAnalysis() {
  if (analysisState === 'downloading' && installController) {
    installController.abort()
    return
  }
  if (analysisState === 'initializing') {
    analysisInitController?.abort(new DOMException('Aborted', 'AbortError'))
    analysisInitializationReject?.(new DOMException('Aborted', 'AbortError'))
    return
  }
  if (analysisState === 'running') {
    terminateAnalysisWorker()
    setAnalysisState('initializing', 'analysis.cancelled', 0)
    try {
      await initializeAnalysisWorker()
    } catch (_) {
      // initializeAnalysisWorker already reports the recoverable error.
    }
  }
}


// Armazena os resultados e o estado exato do experimento que os gerou.
let analysisResults = null
let analysisResultsContext = null

function invalidateAnalysisResults() {
  analysisResults = null
  analysisResultsContext = null
  const results = document.getElementById('analysis-results')
  if (results) results.style.display = 'none'
}

function hasCurrentAnalysisResults() {
  return Boolean(
    analysisResults &&
    analysisResultsContext &&
    currentExperiment &&
    analysisResultsContext.id === currentExperiment.id &&
    analysisResultsContext.updatedAt === currentExperiment.updatedAt &&
    analysisResultsContext.lang === currentLanguage
  )
}


// =============================================
// RENDERIZAÇÃO DOS RESULTADOS
// =============================================

function renderAnalysisResults(results) {
  validateAnalysisResult(results)
  const containers = ensureAnalysisV2Containers()
  renderPlanPopulation(containers.planPopulation, results.protocol, results.population)
  renderBlockScores(containers.blockScores, results.scores)
  renderDispersion(containers.blockScores, results.descriptive)
  renderRcbdAnova(containers.rcbdAnova, results.blockAnova)
  renderPrimaryComparisons(containers.primaryComparisons, results.primaryComparisons)
  renderControlResponse(containers.controlResponse, results.controlResponse)
  renderDoseTrend(containers.doseTrend, results.doseTrend)
  renderNonParametric(containers.nonParametric, results.nonParametric)
  renderTransformedAnalysis(containers.transformedAnalysis, results.transformedAnalysis)
  renderCharts(containers.charts, results.charts)
  return containers
}

function validateAnalysisResult(result) {
  if (!result || result.analysisSchemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new Error(t('analysis.v2.error.invalidSchema'))
  }
}

function ensureAnalysisV2Containers() {
  const root = document.getElementById('analysis-results')
  const definitions = [
    ['planPopulation', 'section-analysis-plan-population', 'analysis-plan-population', 'analysis.v2.planPopulation.title'],
    ['blockScores', 'section-analysis-block-scores', 'analysis-block-scores', 'analysis.v2.blockScores.title'],
    ['rcbdAnova', 'section-analysis-rcbd-anova', 'analysis-rcbd-anova', 'analysis.v2.rcbd.title'],
    ['primaryComparisons', 'section-analysis-primary-comparisons', 'analysis-primary-comparisons', 'analysis.v2.comparisons.title'],
    ['controlResponse', 'section-analysis-control-response', 'analysis-control-response', 'analysis.v2.control.title'],
    ['doseTrend', 'section-analysis-dose-trend', 'analysis-dose-trend', 'analysis.v2.trend.title'],
    ['nonParametric', 'section-analysis-non-parametric', 'analysis-non-parametric', 'analysis.v2.nonParametric.title'],
    ['transformedAnalysis', 'section-analysis-transformed', 'analysis-transformed', 'analysis.v2.transformed.title'],
    ['charts', 'section-analysis-v2-charts', 'analysis-v2-charts', 'analysis.v2.charts.title']
  ]
  const legacySections = ['section-scores', 'section-shapiro', 'section-anova', 'section-tukey', 'section-regression', 'section-charts']
  legacySections.forEach(id => document.getElementById(id)?.remove())
  const exportButtons = root.querySelector('.summary-buttons')
  const containers = {}
  definitions.forEach(([name, sectionId, containerId, titleKey]) => {
    let section = document.getElementById(sectionId)
    if (!section) {
      section = document.createElement('div')
      section.className = 'result-section'
      section.id = sectionId
      const title = document.createElement('h3')
      title.className = 'result-title'
      section.appendChild(title)
      const container = document.createElement('div')
      container.id = containerId
      section.appendChild(container)
      root.insertBefore(section, exportButtons)
    }
    section.querySelector('.result-title').textContent = t(titleKey)
    containers[name] = document.getElementById(containerId)
  })
  return containers
}

function renderPlanPopulation(container, protocol, population) {
  container.replaceChildren()
  appendCaption(container, t('analysis.v2.protocol.caption'))
  if (!protocol || protocol.performed === false) {
    renderNotPerformed(container, protocol, false)
    return
  }
  const validation = protocol.validationComparison
  renderResultTable(container, [t('analysis.v2.header.item'), t('analysis.v2.header.value')], [
    [t('analysis.v2.protocol.version'), protocol.studyDesignVersion],
    [t('analysis.v2.protocol.assayType'), translatedAnalysisValue('assayType', protocol.assayType)],
    [t('analysis.v2.protocol.reference'), `${protocol.primaryReferenceTreatment} (${protocol.primaryReferenceTreatmentIndex})`],
    [t('analysis.v2.protocol.primaryTreatments'), (protocol.primaryTreatmentIndices || []).join(', ')],
    [t('analysis.v2.protocol.validationComparison'), validation ? `${validation.referenceTreatmentIndex} / ${validation.treatmentIndex}` : t('analysis.v2.value.none')],
    [t('analysis.v2.protocol.alpha'), protocol.alpha],
    [t('analysis.v2.protocol.alternative'), translatedAnalysisValue('alternative', protocol.alternative)],
    [t('analysis.v2.protocol.adjustment'), translatedAnalysisValue('adjustment', protocol.multiplicityAdjustment)],
    [t('analysis.v2.protocol.confidenceLevel'), protocol.confidenceLevel],
    [t('analysis.v2.protocol.scoreDenominator'), t('analysis.v2.protocol.effectiveCount')],
    [t('analysis.v2.protocol.offTarget'), protocol.offTargetSlidesIncluded ? t('analysis.v2.value.yes') : t('analysis.v2.value.no')]
  ], false)
  appendCaption(container, t('analysis.v2.population.caption'))
  if (!population || population.performed === false) {
    renderNotPerformed(container, population, false)
    return
  }
  renderResultTable(container, [t('analysis.v2.header.population'), t('analysis.v2.header.includedBlockIds'), t('analysis.v2.header.includedCount')], [
    [t('analysis.v2.population.primary'), (population.primary?.includedBlockNumbers || []).join(', ') || t('analysis.v2.value.none'), population.primary?.includedBlockCount ?? 0],
    [t('analysis.v2.population.validation'), (population.validation?.includedBlockNumbers || []).join(', ') || t('analysis.v2.value.none'), population.validation?.includedBlockCount ?? 0]
  ], false)
  const excluded = [
    ...(population.primary?.excludedBlocks || []).map(block => [
      t('analysis.v2.population.primary'), block.replicateNumber, (block.reasons || []).map(localizedAnalysisReason).join('; ')
    ]),
    ...(population.validation?.excludedBlocks || []).map(block => [
      t('analysis.v2.population.validation'), block.replicateNumber, (block.reasons || []).map(localizedAnalysisReason).join('; ')
    ])
  ]
  if (excluded.length) {
    appendCaption(container, t('analysis.v2.population.exclusions'))
    renderResultTable(container, [t('analysis.v2.header.population'), t('analysis.v2.header.blockId'), t('analysis.v2.header.reason')], excluded, false)
  }
}

function renderBlockScores(container, scores) {
  if (!scores || scores.performed === false) {
    renderNotPerformed(container, scores)
    return
  }
  const rows = (scores.cells || []).map(cell => [
    cell.replicateNumber, cell.treatmentIndex, cell.treatment, cell.validSlides,
    cell.expectedSlides, formatAnalysisNumber(cell.score)
  ])
  renderResultTable(container, [
    t('analysis.v2.header.blockId'), t('analysis.v2.header.treatmentId'), t('analysis.v2.header.treatment'),
    t('analysis.v2.header.validSlides'), t('analysis.v2.header.expectedSlides'), t('analysis.v2.header.score')
  ], rows)
}

function renderRcbdAnova(container, anova, replace = true) {
  if (!anova || anova.performed === false) {
    renderNotPerformed(container, anova, replace)
    return
  }
  if (replace) container.replaceChildren()
  appendCaption(container, interpolateAnalysisText(t('analysis.v2.rcbd.model'), { model: anova.model, blockCount: anova.blockCount }))
  const rows = (anova.terms || []).map(term => [
    translatedAnalysisValue('term', term.term), formatAnalysisNumber(term.SS), term.DF,
    formatAnalysisNumber(term.MS), term.F === undefined ? t('analysis.v2.value.notApplicable') : formatAnalysisNumber(term.F),
    term.p === undefined ? t('analysis.v2.value.notApplicable') : formatProbability(term.p)
  ])
  renderResultTable(container, [
    t('analysis.v2.header.term'), t('analysis.v2.header.ss'), t('analysis.v2.header.df'),
    t('analysis.v2.header.ms'), t('analysis.v2.header.f'), t('analysis.v2.header.pValue')
  ], rows, false)
}

function comparisonValues(row, adjusted = true) {
  return [
    `${row.referenceTreatment} (${row.referenceTreatmentIndex})`, `${row.treatment} (${row.treatmentIndex})`,
    formatAnalysisNumber(row.difference), `${formatAnalysisNumber(row.ciLow)} / ${formatAnalysisNumber(row.ciHigh)}`,
    formatProbability(row.pRaw), adjusted ? formatProbability(row.pAdjusted) : t('analysis.v2.value.notApplicable'),
    row.significant ? t('analysis.v2.decision.significant') : t('analysis.v2.decision.notSignificant'),
    translatedAnalysisValue('direction', row.direction)
  ]
}

function comparisonHeaders() {
  return [
    t('analysis.v2.header.reference'), t('analysis.v2.header.treatment'), t('analysis.v2.header.difference'),
    t('analysis.v2.header.confidenceInterval'), t('analysis.v2.header.rawP'), t('analysis.v2.header.holmP'),
    t('analysis.v2.header.decision'), t('analysis.v2.header.direction')
  ]
}

function renderPrimaryComparisons(container, result) {
  if (!result || result.performed === false) {
    renderNotPerformed(container, result)
    return
  }
  renderResultTable(container, comparisonHeaders(), (result.comparisons || []).map(row => comparisonValues(row)))
  appendCaption(container, interpolateAnalysisText(t('analysis.v2.comparisons.caption'), {
    familySize: result.familySize,
    adjustment: translatedAnalysisValue('adjustment', result.adjustment),
    confidenceLevel: result.confidenceLevel
  }))
}

function renderControlResponse(container, result) {
  if (!result || result.performed === false) {
    renderNotPerformed(container, result)
    return
  }
  renderResultTable(container, comparisonHeaders(), [comparisonValues(result.comparison, false)])
  appendCaption(container, interpolateAnalysisText(t('analysis.v2.control.blocks'), { blockIds: (result.blockNumbers || []).join(', ') }))
  appendCaption(container, t('analysis.v2.control.anovaCaption'))
  renderRcbdAnova(container, result.blockAnova, false)
}

function renderDoseTrend(container, result) {
  if (!result || result.performed === false) {
    renderNotPerformed(container, result)
    return
  }
  renderResultTable(container, [t('analysis.v2.header.item'), t('analysis.v2.header.value')], [
    [t('analysis.v2.trend.model'), result.model],
    [t('analysis.v2.trend.kind'), translatedAnalysisValue('trendKind', result.trendKind)],
    [t('analysis.v2.trend.blockCount'), result.blockCount],
    [t('analysis.v2.trend.observationCount'), result.observationCount],
    [t('analysis.v2.trend.slope'), formatAnalysisNumber(result.slope)],
    [t('analysis.v2.trend.standardError'), formatAnalysisNumber(result.standardError)],
    [t('analysis.v2.header.t'), formatAnalysisNumber(result.t)],
    [t('analysis.v2.header.df'), result.DF],
    [t('analysis.v2.header.confidenceInterval'), `${formatAnalysisNumber(result.ciLow)} / ${formatAnalysisNumber(result.ciHigh)}`],
    [t('analysis.v2.header.pValue'), formatProbability(result.p)],
    [t('analysis.v2.header.rSquared'), formatAnalysisNumber(result.r2)],
    [t('analysis.v2.header.rSquaredPartial'), formatAnalysisNumber(result.r2Partial)],
    [t('analysis.v2.header.decision'), result.significant ? t('analysis.v2.decision.significant') : t('analysis.v2.decision.notSignificant')]
  ])
  const doses = (result.treatmentDoses || []).map(item => [item.treatmentIndex, formatAnalysisNumber(item.concentration)])
  appendCaption(container, t('analysis.v2.trend.dosesCaption'))
  renderResultTable(container, [t('analysis.v2.header.treatmentId'), t('analysis.v2.header.concentration')], doses, false)
}

function renderDispersion(container, descriptive) {
  if (!descriptive || descriptive.performed === false) return
  const rows = (descriptive.treatments || []).map(item => [
    item.treatmentIndex, item.treatment, formatAnalysisNumber(item.mean),
    formatAnalysisNumber(item.standardDeviation), formatAnalysisNumber(item.coefficientOfVariation),
    item.blockCount
  ])
  appendCaption(container, t('analysis.v2.dispersion.caption'))
  renderResultTable(container, [
    t('analysis.v2.header.treatmentId'), t('analysis.v2.header.treatment'), t('analysis.v2.header.mean'),
    t('analysis.v2.header.standardDeviation'), t('analysis.v2.header.cv'), t('analysis.v2.header.blockId')
  ], rows, false)
  const flag = descriptive.heterogeneityFlag
  if (flag && flag.performed) {
    appendCaption(container, interpolateAnalysisText(t('analysis.v2.dispersion.heterogeneity'), {
      code: flag.code,
      ratio: flag.ratio === null || flag.ratio === undefined ? t('analysis.v2.value.notApplicable') : formatAnalysisNumber(flag.ratio),
      max: formatAnalysisNumber(flag.maximumStandardDeviation),
      min: formatAnalysisNumber(flag.minimumStandardDeviation)
    }))
  }
}

function renderNonParametric(container, result) {
  if (!result || result.performed === false) {
    renderNotPerformed(container, result)
    return
  }
  appendCaption(container, t('analysis.v2.nonParametric.caption'))
  if (result.friedman && result.friedman.performed !== false) {
    const friedman = result.friedman
    appendCaption(container, t('analysis.v2.nonParametric.friedman.title'))
    renderResultTable(container, [t('analysis.v2.header.item'), t('analysis.v2.header.value')], [
      [t('analysis.v2.nonParametric.statistic'), formatAnalysisNumber(friedman.statistic)],
      [t('analysis.v2.header.df'), friedman.df],
      [t('analysis.v2.nonParametric.pExact'), formatProbability(friedman.pExact)],
      [t('analysis.v2.nonParametric.arrangements'), friedman.exactArrangements]
    ], false)
  } else {
    renderNotPerformed(container, result.friedman, false)
  }
  if (result.pageTrend && result.pageTrend.performed !== false) {
    const page = result.pageTrend
    appendCaption(container, t('analysis.v2.nonParametric.page.title'))
    renderResultTable(container, [t('analysis.v2.header.item'), t('analysis.v2.header.value')], [
      [t('analysis.v2.nonParametric.direction'), translatedAnalysisValue('pageDirection', page.direction)],
      [t('analysis.v2.nonParametric.directionSource'), translatedAnalysisValue('directionSource', page.directionSource)],
      [t('analysis.v2.nonParametric.statistic'), formatAnalysisNumber(page.statistic)],
      [t('analysis.v2.nonParametric.pExact'), formatProbability(page.pExact)],
      [t('analysis.v2.nonParametric.pExactOpposite'), formatProbability(page.pExactOpposite)],
      [t('analysis.v2.nonParametric.arrangements'), page.exactArrangements]
    ], false)
  } else {
    renderNotPerformed(container, result.pageTrend, false)
  }
}

function renderTransformedAnalysis(container, result) {
  if (!result || result.performed === false) {
    renderNotPerformed(container, result)
    return
  }
  appendCaption(container, interpolateAnalysisText(t('analysis.v2.transformed.caption'), {
    scale: result.scale
  }))
  appendCaption(container, t('analysis.v2.transformed.blockAnovaCaption'))
  renderRcbdAnova(container, result.blockAnova, false)
  appendCaption(container, t('analysis.v2.transformed.comparisonsCaption'))
  if (result.primaryComparisons && result.primaryComparisons.performed !== false) {
    renderResultTable(container, comparisonHeaders(), (result.primaryComparisons.comparisons || []).map(row => comparisonValues(row)), false)
  } else {
    renderNotPerformed(container, result.primaryComparisons, false)
  }
  appendCaption(container, t('analysis.v2.transformed.trendCaption'))
  if (result.doseTrend && result.doseTrend.performed !== false) {
    const trend = result.doseTrend
    renderResultTable(container, [t('analysis.v2.header.item'), t('analysis.v2.header.value')], [
      [t('analysis.v2.trend.slope'), formatAnalysisNumber(trend.slope)],
      [t('analysis.v2.header.pValue'), formatProbability(trend.p)],
      [t('analysis.v2.header.rSquaredPartial'), formatAnalysisNumber(trend.r2Partial)]
    ], false)
  } else {
    renderNotPerformed(container, result.doseTrend, false)
  }
}

function renderCharts(container, charts) {
  container.replaceChildren()
  if (!charts || charts.performed === false) {
    renderNotPerformed(container, charts)
    return
  }
  appendChart(container, charts.scores, t('analysis.v2.charts.scores.caption'), t('analysis.v2.charts.scores.alt'))
  appendChart(container, charts.differences, t('analysis.v2.charts.differences.caption'), t('analysis.v2.charts.differences.alt'))
  appendChart(container, charts.classes, t('analysis.v2.charts.classes.caption'), t('analysis.v2.charts.classes.alt'))
}

function renderResultTable(container, headers, rows, replace = true) {
  if (replace) container.replaceChildren()
  const wrapper = document.createElement('div')
  wrapper.className = 'table-scroll'
  const table = document.createElement('table')
  table.className = 'result-table'
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  headers.forEach(value => appendAnalysisCell(headerRow, 'th', value))
  thead.appendChild(headerRow)
  const tbody = document.createElement('tbody')
  rows.forEach(values => {
    const row = document.createElement('tr')
    values.forEach(value => appendAnalysisCell(row, 'td', value))
    tbody.appendChild(row)
  })
  table.append(thead, tbody)
  wrapper.appendChild(table)
  container.appendChild(wrapper)
}

function appendAnalysisCell(row, tag, value) {
  const cell = document.createElement(tag)
  cell.textContent = value
  if (tag === 'th') cell.scope = 'col'
  row.appendChild(cell)
}

function appendCaption(container, text) {
  const caption = document.createElement('p')
  caption.className = 'result-caption'
  caption.textContent = text
  container.appendChild(caption)
}

function formatProbability(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return t('analysis.v2.value.notAvailable')
  if (numeric <= 0.00001) return '< 0.00001'
  return numeric.toFixed(5)
}

function formatAnalysisNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(4) : t('analysis.v2.value.notAvailable')
}

function translatedAnalysisValue(group, value) {
  const safeValue = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
  const key = `analysis.v2.${group}.${safeValue}`
  const translated = t(key)
  return translated === key ? String(value ?? t('analysis.v2.value.notAvailable')) : translated
}

function interpolateAnalysisText(template, context) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, key) => {
    const value = context?.[key]
    return value === undefined || value === null ? placeholder : String(value)
  })
}

function localizedAnalysisReason(reason) {
  const code = String(reason?.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  const key = `analysis.reason.${code}`
  const translated = t(key)
  const template = translated === key ? t('analysis.reason.unknown') : translated
  return interpolateAnalysisText(template, { code, ...(reason?.context || {}), ...reason })
}

function renderNotPerformed(container, result, replace = true) {
  if (replace) container.replaceChildren()
  appendCaption(container, t('analysis.v2.notPerformed'))
  appendCaption(container, localizedAnalysisReason(result?.reason))
}

function appendChart(container, base64, caption, alt) {
  appendCaption(container, caption)
  if (!CometQuantExport.validPngBase64(base64)) return
  const image = document.createElement('img')
  image.className = 'chart-img'
  image.src = `data:image/png;base64,${base64}`
  image.alt = alt
  container.appendChild(image)
}


// =============================================
// EXPORTAÇÕES
// =============================================

function exportReport() {
  if (!hasCurrentAnalysisResults()) return
  if (hasPendingSlides(currentExperiment)) return alert(t('alert.blindingActive'))
  const html = CometQuantExport.buildReportHtml(currentExperiment, analysisResults, currentLanguage)
  downloadFile(html, `${exportBaseName()}_report.html`, 'text/html')
}


function exportCsv() {
  if (!hasCurrentAnalysisResults()) return
  if (hasPendingSlides(currentExperiment)) return alert(t('alert.blindingActive'))
  downloadFile(CometQuantExport.buildRawCsv(currentExperiment), `${exportBaseName()}_raw_slides.csv`, 'text/csv;charset=utf-8')
}


async function exportZip() {
  if (!hasCurrentAnalysisResults()) return
  if (hasPendingSlides(currentExperiment)) return alert(t('alert.blindingActive'))
  if (typeof JSZip === 'undefined') return alert(t('analysis.v2.export.zipUnavailable'))
  try {
    const zip = new JSZip()
    const folder = zip.folder(exportBaseName())
    folder.file('report.html', CometQuantExport.buildReportHtml(currentExperiment, analysisResults, currentLanguage))
    folder.file('README.txt', t('analysis.v2.export.readme'))
    const data = folder.folder('data')
    data.file('experiment.json', JSON.stringify(currentExperiment, null, 2))
    data.file('analysis.json', JSON.stringify(analysisResults, null, 2))
    data.file('raw_slides.csv', CometQuantExport.buildRawCsv(currentExperiment))
    data.file('replicate_scores.csv', CometQuantExport.buildAggregateCsv(currentExperiment))
    data.file('population.csv', CometQuantExport.buildPopulationCsv(analysisResults))
    data.file('block_anova.csv', CometQuantExport.buildBlockAnovaCsv(analysisResults))
    data.file('primary_comparisons.csv', CometQuantExport.buildComparisonsCsv(analysisResults))
    data.file('control_response.csv', CometQuantExport.buildControlResponseCsv(analysisResults))
    data.file('dose_trend.csv', CometQuantExport.buildDoseTrendCsv(analysisResults))
    data.file('non_parametric.csv', CometQuantExport.buildNonParametricCsv(analysisResults))
    data.file('transformed_analysis.csv', CometQuantExport.buildTransformedAnalysisCsv(analysisResults))
    data.file('study_design.csv', CometQuantExport.buildStudyDesignCsv(currentExperiment, analysisResults))
    const charts = folder.folder('charts')
    if (CometQuantExport.validPngBase64(analysisResults.charts?.scores)) charts.file('block_scores.png', analysisResults.charts.scores, { base64: true })
    if (CometQuantExport.validPngBase64(analysisResults.charts?.differences)) charts.file('primary_differences.png', analysisResults.charts.differences, { base64: true })
    if (CometQuantExport.validPngBase64(analysisResults.charts?.classes)) charts.file('class_distribution.png', analysisResults.charts.classes, { base64: true })
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadFile(zipBlob, `${exportBaseName()}.zip`, 'application/zip', true)
  } catch (error) {
    console.error('ZIP export error:', error)
    alert(t('analysis.v2.export.zipFailed'))
  }
}


function downloadFile(content, filename, mimeType, isBlob = false) {
  const blob   = isBlob ? content : new Blob([content], {type: mimeType})
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function base64ToBlob(b64, mimeType) {
  const bytes  = atob(b64)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], {type: mimeType})
}

function exportBaseName() {
  return `CometQuant_${CometQuantExport.safeFilename(currentExperiment.agent)}_${CometQuantExport.safeFilename(currentExperiment.cells)}_${new Date().toISOString().split('T')[0]}`
}
