(function (root, factory) {
  const core = root.CometQuantCore || (typeof require === 'function' ? require('./core.js') : null)
  const api = factory(core)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantExport = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict'

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
  }

  function formulaSafe(value) {
    const text = String(value ?? '')
    return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text
  }

  function escapeCsv(value) {
    const text = formulaSafe(value).replace(/"/g, '""')
    return `"${text}"`
  }

  function serializeCsv(columns, rows) {
    const lines = [columns.map(column => escapeCsv(column.key)).join(',')]
    rows.forEach(row => lines.push(columns.map(column => escapeCsv(row[column.key] ?? '')).join(',')))
    return `\uFEFF${lines.join('\r\n')}\r\n`
  }

  function reasonText(reason) {
    if (!reason) return ''
    return [reason.code, reason.detail].filter(Boolean).join(': ')
  }

  function buildRawRows(experiment) {
    const rows = []
    experiment.replicates.forEach(replicate => {
      const assignments = replicate.assignments || []
      if (!assignments.length) {
        replicate.gels.forEach(gel => rows.push(rawRow(experiment, replicate, null, gel)))
        return
      }
      assignments.forEach(assignment => {
        const gel = replicate.gels.find(item => item.blindCode === assignment.blindCode)
        rows.push(rawRow(experiment, replicate, assignment, gel))
      })
    })
    return rows.sort((a, b) => a.replicate_number - b.replicate_number || a.treatment_index - b.treatment_index || a.gel_number - b.gel_number)
  }

  function rawRow(experiment, replicate, assignment, gel) {
    const treatmentIndex = assignment?.treatmentIndex ?? gel?.treatmentIndex ?? experiment.treatments.indexOf(gel?.treatment)
    const included = core.isIncludedGel(gel, experiment.nucleoidsPerGel)
    const score = gel ? core.calculateVisualScore(gel, experiment.nucleoidsPerGel) : null
    return {
      schema_version: experiment.schemaVersion,
      experiment_id: experiment.id,
      created_at: experiment.createdAt,
      updated_at: experiment.updatedAt,
      researcher: experiment.researcher,
      agent: experiment.agent,
      cells: experiment.cells,
      negative_control: experiment.negControl,
      positive_control: experiment.posControl,
      solvent_control: experiment.solControl,
      concentration_unit: experiment.concUnit,
      target_nucleoids: experiment.nucleoidsPerGel,
      slides_per_treatment: experiment.slidesPerTreatment,
      replicate_number: replicate.replicateNumber,
      replicate_date: replicate.date,
      blind_code: assignment?.blindCode || gel?.blindCode || '',
      treatment_index: treatmentIndex,
      treatment: experiment.treatments[treatmentIndex] || gel?.treatment || '',
      gel_number: assignment?.gelNumber || gel?.gelNumber || '',
      status: assignment?.status || gel?.status || '',
      absence_reason: reasonText(assignment?.absenceReason),
      incomplete_reason: reasonText(gel?.incompleteReason),
      recorded_at: gel?.recordedAt || assignment?.recordedAt || '',
      class0: gel?.class0 ?? '', class1: gel?.class1 ?? '', class2: gel?.class2 ?? '', class3: gel?.class3 ?? '', class4: gel?.class4 ?? '',
      total_counted: gel?.total ?? '',
      completion: gel?.completion || '',
      included_in_analysis: included ? 'true' : 'false',
      visual_score: score === null ? '' : score.toFixed(4)
    }
  }

  const RAW_COLUMNS = ['schema_version', 'experiment_id', 'created_at', 'updated_at', 'researcher', 'agent', 'cells', 'negative_control', 'positive_control', 'solvent_control', 'concentration_unit', 'target_nucleoids', 'slides_per_treatment', 'replicate_number', 'replicate_date', 'blind_code', 'treatment_index', 'treatment', 'gel_number', 'status', 'absence_reason', 'incomplete_reason', 'recorded_at', 'class0', 'class1', 'class2', 'class3', 'class4', 'total_counted', 'completion', 'included_in_analysis', 'visual_score'].map(key => ({ key }))
  const AGGREGATE_COLUMNS = ['treatment_index', 'treatment', 'replicate_number', 'expected_slides', 'counted_slides', 'complete_slides', 'incomplete_slides', 'absent_slides', 'replicate_score_mean'].map(key => ({ key }))

  function buildRawCsv(experiment) {
    return serializeCsv(RAW_COLUMNS, buildRawRows(experiment))
  }

  function buildAggregateCsv(experiment) {
    const rows = core.aggregateReplicateScores(experiment).map(row => ({
      treatment_index: row.treatmentIndex, treatment: row.treatment, replicate_number: row.replicateNumber,
      expected_slides: row.expectedSlides, counted_slides: row.countedSlides, complete_slides: row.completeSlides,
      incomplete_slides: row.incompleteSlides, absent_slides: row.absentSlides,
      replicate_score_mean: row.score === null ? '' : row.score.toFixed(4)
    }))
    return serializeCsv(AGGREGATE_COLUMNS, rows)
  }

  function htmlTable(headers, rows) {
    return `<table><thead><tr>${headers.map(value => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  }

  function validPngBase64(value) {
    return typeof value === 'string' && value.length < 20_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.startsWith('iVBORw0KGgo')
  }

  function buildReportHtml(experiment, analysis, lang = 'en') {
    const pt = lang === 'pt'
    const raw = buildRawRows(experiment)
    const aggregate = core.aggregateReplicateScores(experiment)
    const scoreRows = aggregate.map(row => [row.treatment, row.replicateNumber, row.completeSlides, row.incompleteSlides, row.absentSlides, row.score === null ? '-' : row.score.toFixed(2)])
    const rawRows = raw.map(row => [row.replicate_number, row.treatment, row.gel_number, row.status, row.completion || '-', row.absence_reason || row.incomplete_reason || '-', row.total_counted || '-', row.visual_score || '-'])
    const chartScore = validPngBase64(analysis?.chartScore) ? `<img src="data:image/png;base64,${analysis.chartScore}" alt="Visual score chart">` : ''
    const chartClass = validPngBase64(analysis?.chartClass) ? `<img src="data:image/png;base64,${analysis.chartClass}" alt="Class distribution chart">` : ''
    const analysisJson = analysis ? `<h2>${pt ? 'Resultados estatísticos' : 'Statistical results'}</h2><pre>${escapeHtml(JSON.stringify({ shapiro: analysis.shapiro, anova: analysis.anova, tukey: analysis.tukey, regression: analysis.regression }, null, 2))}</pre>` : ''
    return `<!DOCTYPE html><html lang="${pt ? 'pt-BR' : 'en'}"><head><meta charset="UTF-8"><title>CometQuant - ${escapeHtml(experiment.agent)}</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:auto;padding:32px;color:#17202a}h1,h2{color:#1a56a0}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}th,td{border:1px solid #bbb;padding:6px;text-align:center}th{background:#e8f0fe}img{max-width:100%}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}.warning{color:#8a5600}</style></head><body><h1>CometQuant Lab</h1><p><strong>${pt ? 'Pesquisador' : 'Researcher'}:</strong> ${escapeHtml(experiment.researcher || '-')}</p><p><strong>${pt ? 'Agente' : 'Agent'}:</strong> ${escapeHtml(experiment.agent)}</p><p><strong>${pt ? 'Tipo celular' : 'Cell type'}:</strong> ${escapeHtml(experiment.cells)}</p><p><strong>${pt ? 'Meta de nucleoides' : 'Nucleoid target'}:</strong> ${experiment.nucleoidsPerGel}</p><p><strong>${pt ? 'Lâminas por tratamento' : 'Slides per treatment'}:</strong> ${experiment.slidesPerTreatment}</p><p class="warning">${pt ? 'Lâminas ausentes e incompletas não participam da análise inferencial.' : 'Absent and incomplete slides are excluded from inferential analysis.'}</p><h2>${pt ? 'Dados brutos' : 'Raw data'}</h2>${htmlTable([pt ? 'Repetição' : 'Replicate', pt ? 'Tratamento' : 'Treatment', pt ? 'Lâmina' : 'Slide', 'Status', pt ? 'Completude' : 'Completion', pt ? 'Motivo' : 'Reason', 'Total', 'Score'], rawRows)}<h2>${pt ? 'Scores por repetição' : 'Scores by replicate'}</h2>${htmlTable([pt ? 'Tratamento' : 'Treatment', pt ? 'Repetição' : 'Replicate', pt ? 'Completas' : 'Complete', pt ? 'Incompletas' : 'Incomplete', pt ? 'Ausentes' : 'Absent', 'Score'], scoreRows)}${analysisJson}${chartScore}${chartClass}<p>Generated by CometQuant Lab - schema ${experiment.schemaVersion}</p></body></html>`
  }

  function safeFilename(value) {
    return String(value || 'Experiment').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Experiment'
  }

  return { escapeHtml, escapeCsv, serializeCsv, buildRawRows, buildRawCsv, buildAggregateCsv, buildReportHtml, validPngBase64, safeFilename }
})
