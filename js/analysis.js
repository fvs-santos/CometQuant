// =============================================
// COMETQUANT LAB — analysis.js
// Módulo de análise estatística via Pyodide
// =============================================

// Instância global do Pyodide
// Declarada fora de qualquer função para persistir
// entre chamadas — equivalente a uma variável de módulo em Python
let pyodide = null
let pyodideReady = false


// =============================================
// INICIALIZAÇÃO DO PYODIDE
// Chamada automaticamente quando o app abre
// =============================================

async function initPyodide() {
  const message   = document.getElementById('pyodide-message')
  const progress  = document.getElementById('pyodide-progress')
  const icon      = document.getElementById('pyodide-icon')

  try {
    // Passo 1 — Carrega o runtime Python (o maior download)
    updatePyodideStatus(message, progress, icon,
      t('analysis.loading'), '🐍', 15)

    pyodide = await loadPyodide()

    // Passo 2 — Instala os pacotes científicos
    updatePyodideStatus(message, progress, icon,
      currentLanguage === 'pt'
        ? 'Instalando pacotes científicos...'
        : 'Installing scientific packages...', '📦', 45)

    await pyodide.loadPackage(['numpy', 'scipy', 'matplotlib'])

    // Passo 3 — Pré-carrega o código Python de análise
    updatePyodideStatus(message, progress, icon,
      currentLanguage === 'pt'
        ? 'Preparando ambiente...'
        : 'Preparing environment...', '⚙️', 80)

    // Executa o código de setup — importações e definições de funções
    await pyodide.runPythonAsync(PYTHON_SETUP_CODE)

    // Pronto
    updatePyodideStatus(message, progress, icon,
      t('analysis.done'), '✅', 100)

    pyodideReady = true

    // Pequena pausa para o usuário ver o "✅" antes de sumir
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
  if (iconEl)    iconEl.textContent = icon
}


// =============================================
// CÓDIGO PYTHON — embutido como string
// Roda dentro do Pyodide no navegador
// É Python real: mesma sintaxe, mesmas bibliotecas
// =============================================

const PYTHON_SETUP_CODE = `
import numpy as np
import json
from scipy import stats
import matplotlib
matplotlib.use('Agg')  # backend sem janela — obrigatório no browser
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import base64
import io

# ---------------------------------------------------
# CÁLCULO DO SCORE VISUAL
# Fórmula idêntica ao app.py original
# score = (0*c0 + 0.25*c1 + 0.5*c2 + 0.75*c3 + 1*c4) / nucleoids * 100
# ---------------------------------------------------

def calculate_scores(experiment):
    nucleoids = experiment['nucleoidsPerGel']
    treatments = experiment['treatments']
    replicates = experiment['replicates']

    # scores_by_treatment: {treatment: [score_rep1, score_rep2, ...]}
    scores_by_treatment = {t: [] for t in treatments}

    # Multiple slides are technical subsamples. Aggregate them within each
    # replicate before inferential analyses to avoid pseudoreplication.
    for rep in replicates:
        replicate_scores = {t: [] for t in treatments}
        for gel in rep['gels']:
            if gel.get('status', 'counted') != 'counted' or gel.get('completion', 'complete') != 'complete':
                continue
            score = (
                0    * gel['class0'] +
                0.25 * gel['class1'] +
                0.50 * gel['class2'] +
                0.75 * gel['class3'] +
                1.00 * gel['class4']
            ) / nucleoids * 100
            treatment = gel['treatment']
            if treatment in replicate_scores:
                replicate_scores[treatment].append(score)

        for treatment, slide_scores in replicate_scores.items():
            if slide_scores:
                scores_by_treatment[treatment].append(float(np.mean(slide_scores)))

    return scores_by_treatment


# ---------------------------------------------------
# SHAPIRO-WILK
# scipy.stats.shapiro — equivalente ao pg.normality()
# Requer ao menos 3 valores por grupo
# ---------------------------------------------------

def calculate_shapiro(scores_by_treatment):
    results = {}

    for treatment, scores in scores_by_treatment.items():
        clean = [s for s in scores if s is not None and not np.isnan(s)]

        if len(clean) < 3:
            results[treatment] = {
                'W': 'ND',
                'p': 'ND',
                'normal': 'n < 3'
            }
        else:
            stat, p = stats.shapiro(clean)
            results[treatment] = {
                'W': round(float(stat), 5),
                'p': round(float(p), 5),
                'normal': str(p > 0.05)
            }

    return results


# ---------------------------------------------------
# ONE-WAY ANOVA
# scipy.stats.f_oneway — equivalente ao pg.anova()
# ---------------------------------------------------

def calculate_anova(scores_by_treatment):
    groups = []
    labels = []

    for treatment, scores in scores_by_treatment.items():
        clean = [s for s in scores if s is not None and not np.isnan(s)]
        if len(clean) >= 2:
            groups.append(clean)
            labels.append(treatment)

    if len(groups) < 2:
        return None

    f_stat, p_value = stats.f_oneway(*groups)

    # Calcula SS, DF, MS manualmente — mesmos valores do pingouin
    all_values = [v for g in groups for v in g]
    grand_mean = np.mean(all_values)
    n_total    = len(all_values)
    k          = len(groups)

    ss_between = sum(len(g) * (np.mean(g) - grand_mean)**2 for g in groups)
    ss_within  = sum(sum((v - np.mean(g))**2 for v in g) for g in groups)
    df_between = k - 1
    df_within  = n_total - k
    ms_between = ss_between / df_between
    ms_within  = ss_within  / df_within

    return {
        'F':    round(float(f_stat), 5),
        'p':    round(float(p_value), 5),
        'SS':   round(float(ss_between), 5),
        'MS':   round(float(ms_between), 5),
        'DF':   int(df_between),
        'significant': bool(p_value < 0.05)
    }


# ---------------------------------------------------
# TUKEY HSD
# scipy.stats.tukey_hsd — realizado só se ANOVA p < 0.05
# ---------------------------------------------------

def calculate_tukey(scores_by_treatment, anova_result):
    if anova_result is None or not anova_result['significant']:
        return []

    groups = []
    labels = []

    for treatment, scores in scores_by_treatment.items():
        clean = [s for s in scores if s is not None and not np.isnan(s)]
        if len(clean) >= 2:
            groups.append(clean)
            labels.append(treatment)

    if len(groups) < 2:
        return []

    result = stats.tukey_hsd(*groups)
    tukey_results = []

    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            p = float(result.pvalue[i][j])
            tukey_results.append({
                'A':            labels[i],
                'B':            labels[j],
                'p':            round(p, 5),
                'significant':  bool(p < 0.05)
            })

    return tukey_results


# ---------------------------------------------------
# REGRESSÃO LINEAR + PEARSON
# Realizada apenas sobre as concentrações numéricas
# Controles são excluídos — igual ao app.py original
# ---------------------------------------------------

def calculate_regression(scores_by_treatment, experiment):
    controls = [
        experiment.get('negControl', ''),
        experiment.get('posControl', ''),
        experiment.get('solControl', '')
    ]
    controls = [c for c in controls if c]

    x_vals = []
    y_vals = []

    for treatment, scores in scores_by_treatment.items():
        if treatment in controls:
            continue
        try:
            # Extrai o número da string de concentração (ex: "5 µM" → 5.0)
            numeric = float(treatment.split()[0])
            clean   = [s for s in scores if s is not None and not np.isnan(s)]
            for score in clean:
                x_vals.append(numeric)
                y_vals.append(score)
        except (ValueError, IndexError):
            continue

    if len(x_vals) < 3:
        return None

    x = np.array(x_vals)
    y = np.array(y_vals)

    slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
    r2 = r_value ** 2

    # Intervalo de confiança 95% para o slope
    n  = len(x)
    df = n - 2
    t_crit  = float(stats.t.ppf(0.975, df))
    ci_low  = slope - t_crit * std_err
    ci_high = slope + t_crit * std_err

    # Pearson
    r_pearson, p_pearson = stats.pearsonr(x, y)

    # Power (aproximação pelo tamanho de efeito)
    from scipy.stats import norm as scipy_norm
    effect_size = abs(r_pearson) / np.sqrt(1 - r_pearson**2) * np.sqrt(n)
    power = float(1 - stats.norm.cdf(1.96 - effect_size) +
                  stats.norm.cdf(-1.96 - effect_size))

    return {
        'regression': {
            'slope':     round(float(slope), 5),
            'intercept': round(float(intercept), 5),
            'r2':        round(float(r2), 5),
            'p':         round(float(p_value), 5),
            'ci_low':    round(float(ci_low), 5),
            'ci_high':   round(float(ci_high), 5),
        },
        'pearson': {
            'r':     round(float(r_pearson), 5),
            'p':     round(float(p_pearson), 5),
            'power': round(float(power), 3)
        }
    }


# ---------------------------------------------------
# GRÁFICO 1 — Scores por tratamento (barras + SD)
# Estilo escuro para consistência com o app
# ---------------------------------------------------

def generate_score_chart(scores_by_treatment, tukey_results, experiment, lang):
    treatments = list(scores_by_treatment.keys())
    means = [np.nanmean(scores_by_treatment[t]) if scores_by_treatment[t] else 0 for t in treatments]
    sds   = [np.nanstd(scores_by_treatment[t]) if scores_by_treatment[t] else 0 for t in treatments]

    # Referência para símbolos estatísticos
    ref_control = (
        experiment.get('negControl') or
        experiment.get('solControl') or
        experiment.get('posControl') or
        treatments[0]
    )

    fig, ax = plt.subplots(figsize=(9, 5))
    fig.patch.set_facecolor('#161b22')
    ax.set_facecolor('#161b22')

    bars = ax.bar(treatments, means, yerr=sds,
                  color='#4a9eff', alpha=0.85,
                  error_kw={'ecolor': '#8b949e', 'capsize': 4})

    # Símbolos de significância em relação ao controle de referência
    for res in tukey_results:
        other = None
        if res['A'] == ref_control:
            other = res['B']
        elif res['B'] == ref_control:
            other = res['A']

        if other and other in treatments:
            idx  = treatments.index(other)
            top  = means[idx] + sds[idx]
            sym  = '**' if res['p'] <= 0.01 else ('*' if res['p'] <= 0.05 else '')
            if sym:
                ax.annotate(sym, xy=(idx, top),
                            ha='center', va='bottom',
                            fontsize=13, color='#f0f6fc',
                            fontweight='bold')

    ax.set_xlabel('Treatments' if lang == 'en' else 'Tratamentos',
                  color='#8b949e', fontsize=12)
    ax.set_ylabel('Visual Score (AU)' if lang == 'en' else 'Score Visual (UA)',
                  color='#8b949e', fontsize=12)
    ax.tick_params(colors='#8b949e', labelsize=9)
    ax.set_xticklabels(treatments, rotation=30, ha='right')

    for spine in ax.spines.values():
        spine.set_edgecolor('#30363d')

    caption = (f'** p < 0.01; * p < 0.05; Reference: {ref_control}')
    fig.text(0.5, -0.02, caption, ha='center',
             fontsize=9, color='#8b949e')

    plt.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150,
                bbox_inches='tight', facecolor='#161b22')
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


# ---------------------------------------------------
# GRÁFICO 2 — Distribuição por classes (barras agrupadas)
# ---------------------------------------------------

def generate_classes_chart(experiment, lang):
    treatments  = experiment['treatments']
    replicates  = experiment['replicates']
    class_names = ['Class 0', 'Class 1', 'Class 2', 'Class 3', 'Class 4']
    class_keys  = ['class0', 'class1', 'class2', 'class3', 'class4']

    # Agrega contagens por tratamento e classe
    counts = {t: {k: [] for k in class_keys} for t in treatments}

    for rep in replicates:
        for gel in rep['gels']:
            if gel.get('status', 'counted') != 'counted' or gel.get('completion', 'complete') != 'complete':
                continue
            t = gel['treatment']
            if t in counts:
                for k in class_keys:
                    counts[t][k].append(gel[k])

    means = {t: [np.nanmean(counts[t][k]) if counts[t][k] else 0 for k in class_keys] for t in treatments}
    sds   = {t: [np.nanstd(counts[t][k]) if counts[t][k] else 0 for k in class_keys] for t in treatments}

    x      = np.arange(len(class_names))
    width  = 0.8 / len(treatments)
    colors = ['#4a9eff', '#3fb950', '#d29922', '#f85149', '#bc8cff']

    fig, ax = plt.subplots(figsize=(10, 5))
    fig.patch.set_facecolor('#161b22')
    ax.set_facecolor('#161b22')

    for i, treatment in enumerate(treatments):
        offset = (i - len(treatments) / 2 + 0.5) * width
        ax.bar(x + offset, means[treatment], width,
               yerr=sds[treatment], label=treatment,
               color=colors[i % len(colors)], alpha=0.85,
               error_kw={'ecolor': '#8b949e', 'capsize': 3})

    ax.set_xticks(x)
    ax.set_xticklabels(class_names)
    ax.set_ylabel('Mean Nucleoids' if lang == 'en' else 'Média de Nucleoides',
                  color='#8b949e', fontsize=12)
    ax.set_xlabel('Comet Class' if lang == 'en' else 'Classe do Cometa',
                  color='#8b949e', fontsize=12)
    ax.tick_params(colors='#8b949e', labelsize=9)
    ax.legend(loc='best', fontsize=8,
              facecolor='#21262d', labelcolor='#e6edf3')

    for spine in ax.spines.values():
        spine.set_edgecolor('#30363d')

    plt.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150,
                bbox_inches='tight', facecolor='#161b22')
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')


# ---------------------------------------------------
# FUNÇÃO PRINCIPAL — orquestra todas as análises
# Chamada pelo JavaScript com os dados do experimento
# ---------------------------------------------------

def run_all_analyses(experiment_json, lang):
    experiment = json.loads(experiment_json)

    scores      = calculate_scores(experiment)
    shapiro     = calculate_shapiro(scores)
    anova       = calculate_anova(scores)
    tukey       = calculate_tukey(scores, anova)
    regression  = calculate_regression(scores, experiment)
    chart_score = generate_score_chart(scores, tukey, experiment, lang)
    chart_class = generate_classes_chart(experiment, lang)

    return json.dumps({
        'scores':     scores,
        'shapiro':    shapiro,
        'anova':      anova,
        'tukey':      tukey,
        'regression': regression,
        'chartScore': chart_score,
        'chartClass': chart_class
    })

print("CometQuant Python environment ready")
`


// =============================================
// INTERFACE — orquestra análise e renderização
// =============================================

function initAnalysis() {

  // Inicia o carregamento do Pyodide em segundo plano
  // assim que o módulo é carregado — Estratégia A
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


// Executa as análises ao clicar em "Run Analysis"
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

  try {
    // Passa o experimento para o Python via globals
    pyodide.globals.set('experiment_json',
      JSON.stringify(currentExperiment))
    pyodide.globals.set('lang', currentLanguage)

    // Chama a função principal Python
    const resultJson = await pyodide.runPythonAsync(
      `run_all_analyses(experiment_json, lang)`
    )

    // Recebe os resultados de volta como objeto JavaScript
    analysisResults = JSON.parse(resultJson)

    // Renderiza tudo na interface
    renderAnalysisResults(analysisResults)

    // Mostra a área de resultados
    document.getElementById('analysis-results').style.display = 'block'

  } catch (err) {
    console.error('Analysis error:', err)
    alert(`Analysis error: ${err.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = t('analysis.run')
  }
}


// Armazena os resultados para uso nas exportações
let analysisResults = null


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
  const rows = Object.entries(shapiro).map(([treatment, result]) => [treatment, result.W, result.p, result.normal])
  renderResultTable(container, [t('summary.treatment'), 'W', 'p-value', 'Normal'], rows)
  appendCaption(container, currentLanguage === 'pt' ? 'p > 0,05 indica distribuição normal' : 'p > 0.05 indicates normal distribution')
}


function renderAnovaTable(anova) {
  const container = document.getElementById('anova-table')

  if (!anova) {
    renderNotPerformed(container)
    return
  }
  renderResultTable(container, ['SS', 'DF', 'MS', 'F', 'p-value'], [[anova.SS, anova.DF, anova.MS, anova.F, anova.p]])
  appendCaption(container, 'SS: sums of squares; MS: mean squares')
}


function renderTukeyTable(tukey) {
  const container = document.getElementById('tukey-table')

  if (!tukey || tukey.length === 0) {
    renderNotPerformed(container)
    return
  }
  const rows = tukey.map(row => {
    const sigText = row.significant
      ? (currentLanguage === 'pt' ? 'Significativo' : 'Significant')
      : (currentLanguage === 'pt' ? 'Não significativo' : 'Not significant')
    return [row.A, row.B, row.p, sigText]
  })
  renderResultTable(container, ['A', 'B', 'p-value', 'Result'], rows)
}


function renderRegressionTable(regression) {
  const container = document.getElementById('regression-table')

  if (!regression) {
    renderNotPerformed(container)
    return
  }
  const r = regression.regression
  const p = regression.pearson
  appendCaption(container, currentLanguage === 'pt' ? 'Regressão Linear' : 'Linear Regression')
  renderResultTable(container, ['p-value', 'R²', 'CI 2.5%', 'CI 97.5%'], [[r.p, r.r2, r.ci_low, r.ci_high]], false)
  appendCaption(container, currentLanguage === 'pt' ? 'Correlação de Pearson' : 'Pearson Correlation')
  renderResultTable(container, ['r', 'p-value', 'Power'], [[p.r, p.p, p.power]], false)
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

function renderNotPerformed(container) {
  container.replaceChildren()
  appendCaption(container, t('analysis.notPerformed'))
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
  if (!analysisResults || !currentExperiment) return
  if (hasPendingSlides(currentExperiment)) return alert(t('alert.blindingActive'))
  const html = CometQuantExport.buildReportHtml(currentExperiment, analysisResults, currentLanguage)
  downloadFile(html, `${exportBaseName()}_report.html`, 'text/html')
}


function exportCsv() {
  if (!analysisResults || !currentExperiment) return
  if (hasPendingSlides(currentExperiment)) return alert(t('alert.blindingActive'))
  downloadFile(CometQuantExport.buildRawCsv(currentExperiment), `${exportBaseName()}_raw_slides.csv`, 'text/csv;charset=utf-8')
}


async function exportZip() {
  if (!analysisResults || !currentExperiment) return
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


// Helpers para exportação
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
