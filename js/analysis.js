// =============================================
// COMETQUANT LAB — analysis.js
// Módulo de análise estatística via Pyodide
// =============================================

const ANALYSIS_ENGINE_URL = './python/cometquant_analysis.py'
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
    analysisResults = JSON.parse(message.resultJson)
    analysisResultsContext = context
    renderAnalysisResults(analysisResults)
    document.getElementById('analysis-results').style.display = 'block'
    setAnalysisState('ready', 'analysis.done', 100)
  } catch (error) {
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
  renderScoresTable(results.scores)
  renderShapiroTable(results.shapiro)
  renderAnovaTable(results.anova)
  renderTukeyTable(results.tukey)
  renderRegressionTable(results.regression)
  renderCharts(results.chartScore, results.chartClass)
}


function renderScoresTable(scores) {
  const treatments = Object.keys(scores)
  const container  = document.getElementById('scores-table')
  const maxReps = Math.max(...treatments.map(tr => scores[tr].length))
  const headers = [t('summary.treatment'), ...Array.from({ length: maxReps }, (_, index) => `Rep ${index + 1}`), t('summary.mean'), t('summary.sd')]
  const rows = treatments.map(tr => {
    const vals = scores[tr]
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    const sd   = vals.length ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) : null
    return [tr, ...Array.from({ length: maxReps }, (_, index) => vals[index] === undefined ? '-' : vals[index].toFixed(2)), mean === null ? '-' : mean.toFixed(2), sd === null ? '-' : sd.toFixed(2)]
  })
  renderResultTable(container, headers, rows)
}


function renderShapiroTable(shapiro) {
  const container = document.getElementById('shapiro-table')
  const rows = Object.entries(shapiro).map(([treatment, result]) => {
    if (result.performed === false) {
      return [treatment, 'ND', 'ND', result.reason.detail]
    }
    return [treatment, result.W, formatProbability(result.p), result.normal]
  })
  renderResultTable(container, [t('summary.treatment'), 'W', 'p-value', 'Normal'], rows)
  appendCaption(container, currentLanguage === 'pt' ? 'p > 0,05 indica distribuição normal' : 'p > 0.05 indicates normal distribution')
}


function renderAnovaTable(anova) {
  const container = document.getElementById('anova-table')

  if (!anova || anova.performed === false) {
    renderNotPerformed(container, anova)
    return
  }
  renderResultTable(container, ['SS', 'DF', 'MS', 'F', 'p-value'], [[anova.SS, anova.DF, anova.MS, anova.F, formatProbability(anova.p)]])
  appendCaption(container, 'SS: sums of squares; MS: mean squares')
}


function renderTukeyTable(tukey) {
  const container = document.getElementById('tukey-table')
  const comparisons = Array.isArray(tukey) ? tukey : tukey?.comparisons

  if (!tukey || tukey.performed === false || !comparisons || comparisons.length === 0) {
    renderNotPerformed(container, tukey)
    return
  }
  const rows = comparisons.map(row => {
    const sigText = row.significant
      ? (currentLanguage === 'pt' ? 'Significativo' : 'Significant')
      : (currentLanguage === 'pt' ? 'Não significativo' : 'Not significant')
    return [row.A, row.B, formatProbability(row.p), sigText]
  })
  renderResultTable(container, ['A', 'B', 'p-value', 'Result'], rows)
}


function renderRegressionTable(regression) {
  const container = document.getElementById('regression-table')

  if (!regression || regression.performed === false) {
    renderNotPerformed(container, regression)
    return
  }
  const r = regression.regression
  const p = regression.pearson
  appendCaption(container, currentLanguage === 'pt' ? 'Regressão Linear' : 'Linear Regression')
  renderResultTable(container, ['p-value', 'R²', 'CI 2.5%', 'CI 97.5%'], [[formatProbability(r.p), r.r2, r.ci_low, r.ci_high]], false)
  appendCaption(container, currentLanguage === 'pt' ? 'Correlação de Pearson' : 'Pearson Correlation')
  renderResultTable(container, ['r', 'p-value', 'Power'], [[p.r, formatProbability(p.p), p.power]], false)
  appendCaption(container, currentLanguage === 'pt' ? 'r: coeficiente de correlação; Power: poder do teste (α = 0,05)' : 'r: correlation coefficient; Power: test power (α = 0.05)')
}


function renderCharts(chartScoreB64, chartClassB64) {
  const container = document.getElementById('charts-container')
  container.replaceChildren()
  appendChart(container, chartScoreB64, currentLanguage === 'pt' ? 'Scores Visuais' : 'Visual Scores', 'Score chart')
  appendChart(container, chartClassB64, currentLanguage === 'pt' ? 'Distribuição por Classes' : 'Class Distribution', 'Classes chart')
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
  if (!Number.isFinite(numeric)) return '-'
  if (numeric <= 0.00001) return '< 0.00001'
  return numeric.toFixed(5)
}

function renderNotPerformed(container, result) {
  container.replaceChildren()
  appendCaption(container, t('analysis.notPerformed'))
  if (result?.reason) appendCaption(container, result.reason.detail || result.reason.code)
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
  if (typeof JSZip === 'undefined') return alert(currentLanguage === 'pt' ? 'Não foi possível carregar o gerador ZIP.' : 'Could not load the ZIP generator.')
  try {
    const zip = new JSZip()
    const folder = zip.folder(exportBaseName())
    folder.file('report.html', CometQuantExport.buildReportHtml(currentExperiment, analysisResults, currentLanguage))
    folder.file('README.txt', currentLanguage === 'pt' ? 'Pacote CometQuant: dados brutos, resultados agregados, análise e gráficos.' : 'CometQuant package: raw data, aggregate results, analysis and charts.')
    const data = folder.folder('data')
    data.file('experiment.json', JSON.stringify(currentExperiment, null, 2))
    data.file('analysis.json', JSON.stringify(analysisResults, null, 2))
    data.file('raw_slides.csv', CometQuantExport.buildRawCsv(currentExperiment))
    data.file('replicate_scores.csv', CometQuantExport.buildAggregateCsv(currentExperiment))
    const charts = folder.folder('charts')
    if (CometQuantExport.validPngBase64(analysisResults.chartScore)) charts.file('visual_scores.png', analysisResults.chartScore, { base64: true })
    if (CometQuantExport.validPngBase64(analysisResults.chartClass)) charts.file('class_distribution.png', analysisResults.chartClass, { base64: true })
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadFile(zipBlob, `${exportBaseName()}.zip`, 'application/zip', true)
  } catch (error) {
    console.error('ZIP export error:', error)
    alert(currentLanguage === 'pt' ? 'Falha ao gerar o arquivo ZIP.' : 'Failed to generate ZIP file.')
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
