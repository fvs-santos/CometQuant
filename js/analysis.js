// =============================================
// COMETQUANT LAB — analysis.js
// Módulo de análise estatística via Pyodide
// =============================================

let pyodide = null
let pyodideReady = false
const ANALYSIS_ENGINE_URL = './python/cometquant_analysis.py'


// =============================================
// INICIALIZAÇÃO DO PYODIDE
// =============================================

async function initPyodide() {
  const message = document.getElementById('pyodide-message')
  const progress = document.getElementById('pyodide-progress')
  const icon = document.getElementById('pyodide-icon')

  try {
    updatePyodideStatus(message, progress, icon,
      t('analysis.loading'), '🐍', 15)

    pyodide = await loadPyodide()

    updatePyodideStatus(message, progress, icon,
      currentLanguage === 'pt'
        ? 'Instalando pacotes científicos...'
        : 'Installing scientific packages...', '📦', 45)

    await pyodide.loadPackage(['numpy', 'scipy', 'matplotlib'])

    updatePyodideStatus(message, progress, icon,
      currentLanguage === 'pt'
        ? 'Preparando ambiente...'
        : 'Preparing environment...', '⚙️', 80)

    const response = await fetch(ANALYSIS_ENGINE_URL)
    if (!response.ok) {
      throw new Error(`Could not load analysis engine (${response.status})`)
    }
    const analysisEngine = await response.text()
    await pyodide.runPythonAsync(analysisEngine)

    updatePyodideStatus(message, progress, icon,
      t('analysis.done'), '✅', 100)

    pyodideReady = true

    setTimeout(() => {
      const statusDiv = document.getElementById('pyodide-status')
      if (statusDiv) statusDiv.style.display = 'none'
    }, 1200)
  } catch (err) {
    updatePyodideStatus(message, progress, icon,
      `Error loading Python: ${err.message}`, '❌', 0)
    console.error('Pyodide init error:', err)
  }
}


function updatePyodideStatus(messageEl, progressEl, iconEl, msg, icon, pct) {
  if (messageEl) messageEl.textContent = msg
  if (progressEl) progressEl.style.width = `${pct}%`
  if (iconEl) iconEl.textContent = icon
}


// =============================================
// INTERFACE — orquestra análise e renderização
// =============================================

function initAnalysis() {
  initPyodide()

  document.getElementById('btn-run-analysis')
    .addEventListener('click', runAnalysis)

  document.getElementById('btn-export-report')
    .addEventListener('click', exportReport)

  document.getElementById('btn-export-csv')
    .addEventListener('click', exportCsv)

  document.getElementById('btn-export-zip')
    .addEventListener('click', exportZip)
}


async function runAnalysis() {
  if (!currentExperiment) {
    alert(t('analysis.errorNoData'))
    return
  }

  if (hasPendingSlides(currentExperiment)) {
    alert(t('alert.blindingActive'))
    return
  }

  if (!pyodideReady) {
    alert(currentLanguage === 'pt'
      ? 'O ambiente Python ainda está carregando. Aguarde.'
      : 'Python environment is still loading. Please wait.')
    return
  }

  const btn = document.getElementById('btn-run-analysis')
  btn.disabled = true
  btn.textContent = t('analysis.running')
  const experimentContext = {
    id: currentExperiment.id,
    updatedAt: currentExperiment.updatedAt
  }

  try {
    pyodide.globals.set('experiment_json',
      JSON.stringify(currentExperiment))
    pyodide.globals.set('lang', currentLanguage)

    const resultJson = await pyodide.runPythonAsync(
      `run_all_analyses(experiment_json, lang)`
    )

    // Descarta o resultado se o experimento mudou enquanto o Python executava.
    if (!currentExperiment || currentExperiment.id !== experimentContext.id || currentExperiment.updatedAt !== experimentContext.updatedAt) {
      invalidateAnalysisResults()
      return
    }

    analysisResults = JSON.parse(resultJson)
    analysisResultsContext = experimentContext
    renderAnalysisResults(analysisResults)
    document.getElementById('analysis-results').style.display = 'block'
  } catch (err) {
    console.error('Analysis error:', err)
    alert(`Analysis error: ${err.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = t('analysis.run')
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
    analysisResultsContext.updatedAt === currentExperiment.updatedAt
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
