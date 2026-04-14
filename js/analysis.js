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

    for rep in replicates:
        for gel in rep['gels']:
            score = (
                0    * gel['class0'] +
                0.25 * gel['class1'] +
                0.50 * gel['class2'] +
                0.75 * gel['class3'] +
                1.00 * gel['class4']
            ) / nucleoids * 100
            scores_by_treatment[gel['treatment']].append(score)

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
    means = [np.nanmean(scores_by_treatment[t]) for t in treatments]
    sds   = [np.nanstd(scores_by_treatment[t])  for t in treatments]

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
            t = gel['treatment']
            if t in counts:
                for k in class_keys:
                    counts[t][k].append(gel[k])

    means = {t: [np.nanmean(counts[t][k]) for k in class_keys] for t in treatments}
    sds   = {t: [np.nanstd(counts[t][k])  for k in class_keys] for t in treatments}

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

  let html = `<div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>${t('summary.treatment')}</th>`

  // Cabeçalhos dinâmicos por repetição
  const maxReps = Math.max(...treatments.map(tr => scores[tr].length))
  for (let i = 0; i < maxReps; i++) {
    html += `<th>${currentLanguage === 'pt' ? 'Rep' : 'Rep'} ${i + 1}</th>`
  }
  html += `<th>${t('summary.mean')}</th><th>${t('summary.sd')}</th></tr></thead><tbody>`

  treatments.forEach(tr => {
    const vals = scores[tr]
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd   = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)

    html += `<tr><td>${tr}</td>`
    for (let i = 0; i < maxReps; i++) {
      html += `<td>${vals[i] !== undefined ? vals[i].toFixed(2) : '-'}</td>`
    }
    html += `<td><strong>${mean.toFixed(2)}</strong></td>
             <td>${sd.toFixed(2)}</td></tr>`
  })

  html += `</tbody></table></div>`
  container.innerHTML = html
}


function renderShapiroTable(shapiro) {
  const container = document.getElementById('shapiro-table')

  let html = `<div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>${t('summary.treatment')}</th>
    <th>W</th><th>p-value</th><th>Normal</th>
    </tr></thead><tbody>`

  Object.entries(shapiro).forEach(([treatment, res]) => {
    const normalClass = res.normal === 'True'
      ? 'td-significant' : 'td-not-significant'
    html += `<tr>
      <td>${treatment}</td>
      <td>${res.W}</td>
      <td>${res.p}</td>
      <td class="${normalClass}">${res.normal}</td>
    </tr>`
  })

  html += `</tbody></table></div>
    <p class="result-caption">
      ${currentLanguage === 'pt'
        ? 'p > 0,05 indica distribuição normal'
        : 'p > 0.05 indicates normal distribution'}
    </p>`
  container.innerHTML = html
}


function renderAnovaTable(anova) {
  const container = document.getElementById('anova-table')

  if (!anova) {
    container.innerHTML = `<p class="result-caption">${t('analysis.notPerformed')}</p>`
    return
  }

  const pClass = anova.significant ? 'td-significant' : 'td-not-significant'

  container.innerHTML = `<div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>SS</th><th>DF</th><th>MS</th><th>F</th><th>p-value</th>
    </tr></thead><tbody>
    <tr>
      <td>${anova.SS}</td>
      <td>${anova.DF}</td>
      <td>${anova.MS}</td>
      <td>${anova.F}</td>
      <td class="${pClass}">${anova.p}</td>
    </tr>
    </tbody></table></div>
    <p class="result-caption">SS: sums of squares; MS: mean squares</p>`
}


function renderTukeyTable(tukey) {
  const container = document.getElementById('tukey-table')

  if (!tukey || tukey.length === 0) {
    container.innerHTML = `<p class="result-caption">${t('analysis.notPerformed')}</p>`
    return
  }

  let html = `<div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>A</th><th>B</th><th>p-value</th><th>Result</th>
    </tr></thead><tbody>`

  tukey.forEach(row => {
    const sigClass = row.significant ? 'td-significant' : 'td-not-significant'
    const sigText  = row.significant
      ? (currentLanguage === 'pt' ? 'Significativo' : 'Significant')
      : (currentLanguage === 'pt' ? 'Não significativo' : 'Not significant')

    html += `<tr>
      <td>${row.A}</td>
      <td>${row.B}</td>
      <td>${row.p}</td>
      <td class="${sigClass}">${sigText}</td>
    </tr>`
  })

  html += `</tbody></table></div>`
  container.innerHTML = html
}


function renderRegressionTable(regression) {
  const container = document.getElementById('regression-table')

  if (!regression) {
    container.innerHTML = `<p class="result-caption">${t('analysis.notPerformed')}</p>`
    return
  }

  const r = regression.regression
  const p = regression.pearson

  container.innerHTML = `
    <p class="result-caption" style="margin-bottom:8px">
      ${currentLanguage === 'pt' ? 'Regressão Linear' : 'Linear Regression'}
    </p>
    <div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>p-value</th><th>R²</th><th>CI 2.5%</th><th>CI 97.5%</th>
    </tr></thead><tbody>
    <tr>
      <td class="${r.p < 0.05 ? 'td-significant' : ''}">${r.p}</td>
      <td>${r.r2}</td>
      <td>${r.ci_low}</td>
      <td>${r.ci_high}</td>
    </tr>
    </tbody></table></div>

    <p class="result-caption" style="margin: 16px 0 8px">
      ${currentLanguage === 'pt' ? 'Correlação de Pearson' : 'Pearson Correlation'}
    </p>
    <div style="overflow-x:auto">
    <table class="result-table"><thead><tr>
    <th>r</th><th>p-value</th><th>Power</th>
    </tr></thead><tbody>
    <tr>
      <td>${p.r}</td>
      <td class="${p.p < 0.05 ? 'td-significant' : ''}">${p.p}</td>
      <td>${p.power}</td>
    </tr>
    </tbody></table></div>
    <p class="result-caption">
      ${currentLanguage === 'pt'
        ? 'r: coeficiente de correlação; Power: poder do teste (α = 0,05)'
        : 'r: correlation coefficient; Power: test power (α = 0.05)'}
    </p>`
}


function renderCharts(chartScoreB64, chartClassB64) {
  const container = document.getElementById('charts-container')

  container.innerHTML = `
    <p class="result-caption">
      ${currentLanguage === 'pt' ? 'Scores Visuais' : 'Visual Scores'}
    </p>
    <img class="chart-img"
         src="data:image/png;base64,${chartScoreB64}"
         alt="Score chart">

    <p class="result-caption" style="margin-top:16px">
      ${currentLanguage === 'pt'
        ? 'Distribuição por Classes'
        : 'Class Distribution'}
    </p>
    <img class="chart-img"
         src="data:image/png;base64,${chartClassB64}"
         alt="Classes chart">`
}


// =============================================
// EXPORTAÇÕES
// =============================================

function exportReport() {
  if (!analysisResults || !currentExperiment) return

  const exp  = currentExperiment
  const res  = analysisResults
  const lang = currentLanguage
  const date = new Date().toLocaleDateString(
    lang === 'pt' ? 'pt-BR' : 'en-US')

  // Monta o HTML do relatório — imprimível como PDF
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>CometQuant Lab — ${exp.agent} / ${exp.cells}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px;
           margin: 0 auto; padding: 40px; color: #1a1a1a; }
    h1 { color: #1a56a0; border-bottom: 2px solid #1a56a0; padding-bottom: 8px; }
    h2 { color: #1a56a0; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th { background: #e8f0fe; padding: 8px; text-align: center; border: 1px solid #ccc; }
    td { padding: 7px; text-align: center; border: 1px solid #ccc; }
    .sig { color: #1a7a2e; font-weight: bold; }
    .meta { color: #555; font-size: 13px; margin: 4px 0; }
    img { max-width: 100%; margin: 16px 0; }
    .caption { font-size: 12px; color: #666; margin-top: 4px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>CometQuant Lab</h1>
  <p class="meta"><strong>${lang === 'pt' ? 'Pesquisador' : 'Researcher'}:</strong> ${exp.researcher || '—'}</p>
  <p class="meta"><strong>${lang === 'pt' ? 'Agente' : 'Agent'}:</strong> ${exp.agent}</p>
  <p class="meta"><strong>${lang === 'pt' ? 'Linhagem' : 'Cell Type'}:</strong> ${exp.cells}</p>
  <p class="meta"><strong>${lang === 'pt' ? 'Data do relatório' : 'Report date'}:</strong> ${date}</p>
  <p class="meta"><strong>${lang === 'pt' ? 'Repetições' : 'Replicates'}:</strong> ${exp.replicates.length}</p>

  <h2>${lang === 'pt' ? 'Scores Visuais' : 'Visual Scores'}</h2>
  ${buildHtmlTable(
    [lang === 'pt' ? 'Tratamento' : 'Treatment', 'Mean', 'SD'],
    Object.entries(res.scores).map(([tr, vals]) => {
      const m = vals.reduce((a,b) => a+b,0) / vals.length
      const s = Math.sqrt(vals.reduce((a,b) => a+(b-m)**2,0)/vals.length)
      return [tr, m.toFixed(2), s.toFixed(2)]
    })
  )}

  <h2>Shapiro-Wilk</h2>
  ${buildHtmlTable(
    [lang === 'pt' ? 'Tratamento' : 'Treatment', 'W', 'p-value', 'Normal'],
    Object.entries(res.shapiro).map(([tr, r]) => [tr, r.W, r.p, r.normal])
  )}

  <h2>ANOVA</h2>
  ${res.anova
    ? buildHtmlTable(['SS','DF','MS','F','p-value'],
        [[res.anova.SS, res.anova.DF, res.anova.MS, res.anova.F, res.anova.p]])
    : `<p>${lang === 'pt' ? 'Não realizado' : 'Not performed'}</p>`}

  <h2>Tukey</h2>
  ${res.tukey && res.tukey.length > 0
    ? buildHtmlTable(['A','B','p-value', lang === 'pt' ? 'Resultado' : 'Result'],
        res.tukey.map(r => [r.A, r.B, r.p,
          r.significant
            ? (lang === 'pt' ? 'Significativo' : 'Significant')
            : (lang === 'pt' ? 'Não significativo' : 'Not significant')]))
    : `<p>${lang === 'pt' ? 'Não realizado' : 'Not performed'}</p>`}

  <h2>${lang === 'pt' ? 'Regressão Linear' : 'Linear Regression'}</h2>
  ${res.regression
    ? buildHtmlTable(['p-value','R²','CI 2.5%','CI 97.5%'],
        [[res.regression.regression.p, res.regression.regression.r2,
          res.regression.regression.ci_low, res.regression.regression.ci_high]])
    : `<p>${lang === 'pt' ? 'Não realizado' : 'Not performed'}</p>`}

  <h2>${lang === 'pt' ? 'Correlação de Pearson' : 'Pearson Correlation'}</h2>
  ${res.regression
    ? buildHtmlTable(['r','p-value','Power'],
        [[res.regression.pearson.r, res.regression.pearson.p,
          res.regression.pearson.power]])
    : `<p>${lang === 'pt' ? 'Não realizado' : 'Not performed'}</p>`}

  <h2>${lang === 'pt' ? 'Gráficos' : 'Charts'}</h2>
  <img src="data:image/png;base64,${res.chartScore}" alt="Score chart">
  <img src="data:image/png;base64,${res.chartClass}" alt="Classes chart">

  <p class="caption">Generated by CometQuant Lab — ${date}</p>
</body>
</html>`

  downloadFile(html, `CometQuant_${exp.agent}_${exp.cells}_report.html`,
    'text/html')
}


function buildHtmlTable(headers, rows) {
  let html = '<table>'
  html += '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>'
  rows.forEach(row => {
    html += '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
  })
  html += '</table>'
  return html
}


function exportCsv() {
  if (!analysisResults || !currentExperiment) return

  const scores = analysisResults.scores
  const treatments = Object.keys(scores)
  const maxReps = Math.max(...treatments.map(t => scores[t].length))

  let csv = 'Treatment'
  for (let i = 0; i < maxReps; i++) csv += `,Rep ${i + 1}`
  csv += ',Mean,SD\n'

  treatments.forEach(tr => {
    const vals = scores[tr]
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd   = Math.sqrt(vals.reduce((a, b) => a + (b-mean)**2, 0) / vals.length)
    csv += `${tr}`
    for (let i = 0; i < maxReps; i++) {
      csv += `,${vals[i] !== undefined ? vals[i].toFixed(4) : ''}`
    }
    csv += `,${mean.toFixed(4)},${sd.toFixed(4)}\n`
  })

  const exp = currentExperiment
  downloadFile(csv,
    `CometQuant_${exp.agent}_${exp.cells}_scores.csv`,
    'text/csv')
}


async function exportZip() {
  if (!analysisResults || !currentExperiment) return

  const exp = currentExperiment

  // JSZip via CDN
  const script = document.createElement('script')
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  document.head.appendChild(script)

  await new Promise(resolve => { script.onload = resolve })

  const zip = new JSZip()

  // Adiciona o relatório HTML
  const reportBlob = await fetch(
    URL.createObjectURL(new Blob([getReportHtml()], {type: 'text/html'})))
    .then(r => r.blob())
  zip.file(`CometQuant_${exp.agent}_report.html`, reportBlob)

  // Adiciona o CSV
  zip.file(`CometQuant_${exp.agent}_scores.csv`, getCsvContent())

  // Adiciona os gráficos
  zip.file(`CometQuant_${exp.agent}_score_chart.png`,
    base64ToBlob(analysisResults.chartScore, 'image/png'))
  zip.file(`CometQuant_${exp.agent}_class_chart.png`,
    base64ToBlob(analysisResults.chartClass, 'image/png'))

  const zipBlob = await zip.generateAsync({type: 'blob'})
  downloadFile(zipBlob,
    `CometQuant_${exp.agent}_${exp.cells}.zip`,
    'application/zip', true)
}


// Helpers para exportação
function downloadFile(content, filename, mimeType, isBlob = false) {
  const blob   = isBlob ? content : new Blob([content], {type: mimeType})
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = filename
  a.click()
  URL.revokeObjectURL(url)
}

function base64ToBlob(b64, mimeType) {
  const bytes  = atob(b64)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], {type: mimeType})
}

function getReportHtml() {
  // Reutiliza a lógica do exportReport mas retorna a string
  // Em vez de duplicar, chama exportReport internamente
  // Implementação simplificada para o zip
  return `<html><body><h1>CometQuant Lab</h1>
    <p>Agent: ${currentExperiment.agent}</p>
    <p>See full report via Export Report button.</p>
    </body></html>`
}

function getCsvContent() {
  const scores = analysisResults.scores
  const treatments = Object.keys(scores)
  const maxReps = Math.max(...treatments.map(t => scores[t].length))
  let csv = 'Treatment'
  for (let i = 0; i < maxReps; i++) csv += `,Rep ${i+1}`
  csv += ',Mean,SD\n'
  treatments.forEach(tr => {
    const vals = scores[tr]
    const mean = vals.reduce((a,b) => a+b,0) / vals.length
    const sd   = Math.sqrt(vals.reduce((a,b) => a+(b-mean)**2,0)/vals.length)
    csv += tr
    for (let i = 0; i < maxReps; i++) csv += `,${vals[i]?.toFixed(4) ?? ''}`
    csv += `,${mean.toFixed(4)},${sd.toFixed(4)}\n`
  })
  return csv
}