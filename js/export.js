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
    const included = core.isIncludedGel(gel)
    const score = gel ? core.calculateVisualScore(gel) : null
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
  const AGGREGATE_COLUMNS = ['treatment_index', 'treatment', 'replicate_number', 'expected_slides', 'counted_slides', 'analyzed_slides', 'complete_slides', 'incomplete_slides', 'absent_slides', 'replicate_score_mean'].map(key => ({ key }))

  function buildRawCsv(experiment) {
    return serializeCsv(RAW_COLUMNS, buildRawRows(experiment))
  }

  function buildAggregateCsv(experiment) {
    const rows = core.aggregateReplicateScores(experiment).map(row => ({
      treatment_index: row.treatmentIndex, treatment: row.treatment, replicate_number: row.replicateNumber,
      expected_slides: row.expectedSlides, counted_slides: row.countedSlides, analyzed_slides: row.analyzedSlides, complete_slides: row.completeSlides,
      incomplete_slides: row.incompleteSlides, absent_slides: row.absentSlides,
      replicate_score_mean: row.score === null ? '' : row.score.toFixed(4)
    }))
    return serializeCsv(AGGREGATE_COLUMNS, rows)
  }

  function unavailableRow(result) {
    return {
      performed: 'false',
      reason_code: result?.reason?.code || '',
      reason_context: JSON.stringify(result?.reason?.context || {})
    }
  }

  function joinedReasons(reasons) {
    return (reasons || []).map(reason => {
      const context = reason.treatment || reason.treatmentIndex !== undefined
        ? ` [${reason.treatmentIndex ?? ''}: ${reason.treatment || ''}]`
        : ''
      return `${reason.code || 'unknown'}${context}`
    }).join('; ')
  }

  const POPULATION_COLUMNS = ['replicate_number', 'primary_included', 'primary_exclusion_reasons', 'validation_included', 'validation_exclusion_reasons', 'treatment_index', 'treatment', 'expected_slides', 'valid_slides', 'invalid_slides', 'absent_slides', 'score', 'technical_replication_complete'].map(key => ({ key }))
  const BLOCK_ANOVA_COLUMNS = ['performed', 'reason_code', 'reason_context', 'model', 'block_count', 'treatment_indices', 'residual_df', 'MSE', 'term', 'SS', 'DF', 'MS', 'F', 'p'].map(key => ({ key }))
  const COMPARISON_COLUMNS = ['performed', 'reason_code', 'reason_context', 'family', 'family_size', 'adjustment', 'confidence_level', 'reference_treatment_index', 'reference_treatment', 'treatment_index', 'treatment', 'block_count', 'reference_mean', 'treatment_mean', 'difference', 'standard_error', 't', 'DF', 'ci_low', 'ci_high', 'p_raw', 'p_holm', 'significant', 'direction'].map(key => ({ key }))
  const CONTROL_RESPONSE_COLUMNS = ['performed', 'reason_code', 'reason_context', 'purpose', 'block_numbers', 'reference_treatment_index', 'reference_treatment', 'treatment_index', 'treatment', 'block_count', 'reference_mean', 'treatment_mean', 'difference', 'standard_error', 't', 'DF', 'ci_low', 'ci_high', 'p_raw', 'significant', 'direction'].map(key => ({ key }))
  const DOSE_TREND_COLUMNS = ['performed', 'reason_code', 'reason_context', 'model', 'trend_kind', 'block_count', 'observation_count', 'residual_df', 'MSE', 'reference_included_as_zero', 'treatment_index', 'concentration', 'slope', 'standard_error', 't', 'DF', 'ci_low', 'ci_high', 'p', 'r2', 'r2_partial', 'significant'].map(key => ({ key }))
  const NON_PARAMETRIC_COLUMNS = ['performed', 'reason_code', 'test', 'block_count', 'treatment_indices', 'direction', 'direction_source', 'statistic', 'df', 'p_exact', 'p_exact_opposite', 'exact_arrangements'].map(key => ({ key }))
  const TRANSFORMED_COLUMNS = ['performed', 'reason_code', 'scale', 'section', 'reference_treatment', 'treatment', 'difference', 't', 'p', 'p_holm', 'slope', 'r2_partial'].map(key => ({ key }))
  const STUDY_DESIGN_COLUMNS = ['study_design_version', 'status', 'assay_type', 'primary_reference_treatment_index', 'primary_reference_treatment', 'primary_treatment_indices', 'validation_reference_treatment_index', 'validation_treatment_index', 'alpha', 'alternative', 'multiplicity_adjustment', 'confidence_level', 'include_primary_reference_as_zero', 'treatment_index', 'treatment', 'role', 'concentration', 'concentration_unit'].map(key => ({ key }))

  function buildPopulationCsv(analysis) {
    const population = analysis?.population
    if (!population || population.performed === false) {
      return serializeCsv(POPULATION_COLUMNS, [])
    }
    const validationIncluded = new Set(population.validation?.includedBlockNumbers || [])
    const validationExcluded = new Map((population.validation?.excludedBlocks || []).map(block => [block.replicateNumber, joinedReasons(block.reasons)]))
    const rows = []
    ;(population.blocks || []).forEach(block => {
      const primaryReasons = joinedReasons(block.primaryExclusionReasons)
      ;(block.cells || []).forEach(cell => rows.push({
        replicate_number: block.replicateNumber,
        primary_included: String(Boolean(block.primaryIncluded)),
        primary_exclusion_reasons: primaryReasons,
        validation_included: String(validationIncluded.has(block.replicateNumber)),
        validation_exclusion_reasons: validationExcluded.get(block.replicateNumber) || '',
        treatment_index: cell.treatmentIndex,
        treatment: cell.treatment,
        expected_slides: cell.expectedSlides,
        valid_slides: cell.validSlides,
        invalid_slides: cell.invalidSlides,
        absent_slides: cell.absentSlides,
        score: cell.score ?? '',
        technical_replication_complete: String(Boolean(cell.technicalReplicationComplete))
      }))
    })
    return serializeCsv(POPULATION_COLUMNS, rows)
  }

  function buildBlockAnovaCsv(analysis) {
    const result = analysis?.blockAnova
    if (!result || result.performed === false) {
      return serializeCsv(BLOCK_ANOVA_COLUMNS, [unavailableRow(result)])
    }
    const common = {
      performed: 'true', model: result.model, block_count: result.blockCount,
      treatment_indices: (result.treatmentIndices || []).join(';'), residual_df: result.residualDF, MSE: result.MSE
    }
    return serializeCsv(BLOCK_ANOVA_COLUMNS, (result.terms || []).map(term => ({ ...common, ...term })))
  }

  function comparisonRow(comparison) {
    return {
      reference_treatment_index: comparison.referenceTreatmentIndex,
      reference_treatment: comparison.referenceTreatment,
      treatment_index: comparison.treatmentIndex,
      treatment: comparison.treatment,
      block_count: comparison.blockCount,
      reference_mean: comparison.referenceMean,
      treatment_mean: comparison.treatmentMean,
      difference: comparison.difference,
      standard_error: comparison.standardError,
      t: comparison.t,
      DF: comparison.DF,
      ci_low: comparison.ciLow,
      ci_high: comparison.ciHigh,
      p_raw: comparison.pRaw,
      p_holm: comparison.pAdjusted ?? '',
      significant: String(Boolean(comparison.significant)),
      direction: comparison.direction
    }
  }

  function buildComparisonsCsv(analysis) {
    const result = analysis?.primaryComparisons
    if (!result || result.performed === false) {
      return serializeCsv(COMPARISON_COLUMNS, [unavailableRow(result)])
    }
    return serializeCsv(COMPARISON_COLUMNS, (result.comparisons || []).map(comparison => ({
      performed: 'true', family: result.family, family_size: result.familySize,
      adjustment: result.adjustment, confidence_level: result.confidenceLevel,
      ...comparisonRow(comparison)
    })))
  }

  function buildControlResponseCsv(analysis) {
    const result = analysis?.controlResponse
    if (!result || result.performed === false) {
      return serializeCsv(CONTROL_RESPONSE_COLUMNS, [unavailableRow(result)])
    }
    return serializeCsv(CONTROL_RESPONSE_COLUMNS, [{
      performed: 'true', purpose: result.purpose, block_numbers: (result.blockNumbers || []).join(';'),
      ...comparisonRow(result.comparison || {})
    }])
  }

  function buildDoseTrendCsv(analysis) {
    const result = analysis?.doseTrend
    if (!result || result.performed === false) {
      return serializeCsv(DOSE_TREND_COLUMNS, [unavailableRow(result)])
    }
    const common = {
      performed: 'true', model: result.model, trend_kind: result.trendKind || '', block_count: result.blockCount,
      observation_count: result.observationCount, residual_df: result.residualDF, MSE: result.MSE,
      reference_included_as_zero: String(Boolean(result.referenceIncludedAsZero)), slope: result.slope,
      standard_error: result.standardError, t: result.t, DF: result.DF, ci_low: result.ciLow,
      ci_high: result.ciHigh, p: result.p, r2: result.r2, r2_partial: result.r2Partial, significant: String(Boolean(result.significant))
    }
    const doses = result.treatmentDoses?.length ? result.treatmentDoses : [{}]
    return serializeCsv(DOSE_TREND_COLUMNS, doses.map(dose => ({
      ...common, treatment_index: dose.treatmentIndex ?? '', concentration: dose.concentration ?? ''
    })))
  }

  function buildNonParametricCsv(analysis) {
    const result = analysis?.nonParametric
    if (!result || result.performed === false) {
      return serializeCsv(NON_PARAMETRIC_COLUMNS, [unavailableRow(result)])
    }
    const rows = []
    const blockCount = result.friedman?.blockCount ?? result.pageTrend?.blockCount ?? ''
    const treatmentIndices = (result.friedman?.treatmentIndices || result.pageTrend?.treatmentIndices || []).join(';')
    if (result.friedman) {
      const friedman = result.friedman
      rows.push({
        performed: 'true', test: 'friedman', block_count: blockCount, treatment_indices: treatmentIndices,
        direction: '', direction_source: '', statistic: friedman.statistic ?? '', df: friedman.df ?? '',
        p_exact: friedman.pExact ?? '', p_exact_opposite: '', exact_arrangements: friedman.exactArrangements ?? ''
      })
    }
    if (result.pageTrend) {
      const page = result.pageTrend
      rows.push({
        performed: 'true', test: 'page', block_count: blockCount, treatment_indices: treatmentIndices,
        direction: page.direction ?? '', direction_source: page.directionSource ?? '', statistic: page.statistic ?? '',
        df: '', p_exact: page.pExact ?? '', p_exact_opposite: page.pExactOpposite ?? '',
        exact_arrangements: page.exactArrangements ?? ''
      })
    }
    return serializeCsv(NON_PARAMETRIC_COLUMNS, rows)
  }

  function buildTransformedAnalysisCsv(analysis) {
    const result = analysis?.transformedAnalysis
    if (!result || result.performed === false) {
      return serializeCsv(TRANSFORMED_COLUMNS, [unavailableRow(result)])
    }
    const rows = []
    const scale = result.scale || ''
    ;(result.primaryComparisons?.comparisons || []).forEach(comparison => {
      rows.push({
        performed: 'true', scale, section: 'comparison',
        reference_treatment: comparison.referenceTreatment, treatment: comparison.treatment,
        difference: comparison.difference, t: comparison.t, p: comparison.pRaw,
        p_holm: comparison.pAdjusted ?? '', slope: '', r2_partial: ''
      })
    })
    if (result.doseTrend && result.doseTrend.performed !== false) {
      rows.push({
        performed: 'true', scale, section: 'trend',
        reference_treatment: '', treatment: '', difference: '', t: '',
        p: result.doseTrend.p, p_holm: '', slope: result.doseTrend.slope, r2_partial: result.doseTrend.r2Partial ?? ''
      })
    }
    return serializeCsv(TRANSFORMED_COLUMNS, rows)
  }

  function buildStudyDesignCsv(experiment, analysis) {
    const design = experiment?.studyDesign || {}
    const protocol = analysis?.protocol?.performed === false ? {} : (analysis?.protocol || {})
    const validation = protocol.validationComparison || design.validationComparison || {}
    const referenceIndex = protocol.primaryReferenceTreatmentIndex ?? design.primaryReferenceTreatmentIndex
    const primaryIndices = protocol.primaryTreatmentIndices || design.primaryTreatmentIndices || []
    const common = {
      study_design_version: protocol.studyDesignVersion ?? design.version ?? '', status: design.status || '',
      assay_type: protocol.assayType ?? design.assayType ?? '', primary_reference_treatment_index: referenceIndex ?? '',
      primary_reference_treatment: protocol.primaryReferenceTreatment || experiment?.treatments?.[referenceIndex] || '',
      primary_treatment_indices: primaryIndices.join(';'), validation_reference_treatment_index: validation.referenceTreatmentIndex ?? '',
      validation_treatment_index: validation.treatmentIndex ?? '', alpha: protocol.alpha ?? design.alpha ?? '',
      alternative: protocol.alternative ?? design.alternative ?? '', multiplicity_adjustment: protocol.multiplicityAdjustment ?? design.pAdjustment ?? '',
      confidence_level: protocol.confidenceLevel ?? '', include_primary_reference_as_zero: String(protocol.includePrimaryReferenceAsZero ?? design.trendReferenceAsZero ?? ''),
      concentration_unit: experiment?.concUnit || ''
    }
    const metadata = experiment?.treatmentMetadata?.length ? experiment.treatmentMetadata : [{}]
    return serializeCsv(STUDY_DESIGN_COLUMNS, metadata.map(item => ({
      ...common, treatment_index: item.treatmentIndex ?? '', treatment: experiment?.treatments?.[item.treatmentIndex] || '',
      role: item.role || '', concentration: item.concentration ?? ''
    })))
  }

  function htmlTable(headers, rows, options = {}) {
    const body = rows.map((row, index) => {
      const values = Array.isArray(row) ? row : row.cells
      const rowClass = Array.isArray(row) ? options.rowClasses?.[index] : row.className
      return `<tr${rowClass ? ` class="${escapeHtml(rowClass)}"` : ''}>${values.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`
    }).join('')
    return `<div class="table-scroll"><table><thead><tr>${headers.map(value => `<th scope="col">${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`
  }

  function validPngBase64(value) {
    return typeof value === 'string' && value.length < 20_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.startsWith('iVBORw0KGgo')
  }

  function buildLegacyReportHtml(experiment, analysis, lang = 'en') {
    const pt = lang === 'pt'
    const labels = pt ? {
      researcher: 'Pesquisador', agent: 'Agente', cells: 'Tipo celular', target: 'Meta de nucleoides', slides: 'Laminas por tratamento',
      exclusion: 'Laminas contadas fora da meta usam o total efetivo e permanecem na analise; apenas ausentes ou sem contagem valida sao excluidas.', raw: 'Dados brutos', scores: 'Scores por repeticao',
      replicate: 'Repeticao', treatment: 'Tratamento', slide: 'Lamina', completion: 'Completude', reason: 'Motivo', analyzed: 'Analisadas', complete: 'Na meta',
      incomplete: 'Fora da meta', absent: 'Ausentes', protocol: 'Protocolo cientifico', population: 'Populacao de analise', item: 'Item', value: 'Valor',
      primaryIncluded: 'Blocos primarios incluidos', primaryExcluded: 'Blocos primarios excluidos', validationIncluded: 'Blocos de validacao incluidos',
      rcbd: 'ANOVA em blocos casualizados', term: 'Termo', comparisons: 'Comparacoes primarias planejadas', reference: 'Referencia', difference: 'Diferenca',
      ci: 'IC 95% nominal', rawP: 'p bruto', holmP: 'p Holm', decision: 'Resultado estatistico', direction: 'Direcao', significant: 'Diferenca detectada', notSignificant: 'Diferenca nao detectada',
      control: 'Resposta de controle', trend: 'Tendencia de dose ajustada por bloco', slope: 'Inclinacao', blocks: 'Blocos', observations: 'Observacoes',
      notPerformed: 'Nao realizado', charts: 'Graficos', chartScores: 'Scores por bloco', chartDifferences: 'Diferencas com IC 95%', chartClasses: 'Distribuicao por classes',
      nonParametric: 'Sensibilidade nao-parametrica', friedman: 'Friedman (p exato)', page: 'Page L (tendencia ordenada)', statistic: 'Estatistica', exactP: 'p exato',
      exactPOpposite: 'p oposto', arrangements: 'Arranjos', direction: 'Direcao', transformed: 'Sensibilidade transformada (arcsine-sqrt)',
      r2partial: 'R2 parcial', dispersion: 'Dispersao por tratamento', mean: 'Media', sd: 'DP', cv: 'CV (%)'
    } : {
      researcher: 'Researcher', agent: 'Agent', cells: 'Cell type', target: 'Nucleoid target', slides: 'Slides per treatment',
      exclusion: 'Counted slides outside the target use their effective total and remain in analysis; only absent slides or slides without a valid count are excluded.', raw: 'Raw data', scores: 'Scores by replicate',
      replicate: 'Replicate', treatment: 'Treatment', slide: 'Slide', completion: 'Completion', reason: 'Reason', analyzed: 'Analyzed', complete: 'On target',
      incomplete: 'Off target', absent: 'Absent', protocol: 'Scientific protocol', population: 'Analysis population', item: 'Item', value: 'Value',
      primaryIncluded: 'Included primary blocks', primaryExcluded: 'Excluded primary blocks', validationIncluded: 'Included validation blocks',
      rcbd: 'Randomized complete block ANOVA', term: 'Term', comparisons: 'Planned primary comparisons', reference: 'Reference', difference: 'Difference',
      ci: 'Nominal 95% CI', rawP: 'Raw p', holmP: 'Holm p', decision: 'Statistical result', direction: 'Direction', significant: 'Difference detected', notSignificant: 'Difference not detected',
      control: 'Control response', trend: 'Block-adjusted dose trend', slope: 'Slope', blocks: 'Blocks', observations: 'Observations',
      notPerformed: 'Not performed', charts: 'Charts', chartScores: 'Scores by block', chartDifferences: 'Differences with 95% CI', chartClasses: 'Class distribution',
      nonParametric: 'Non-parametric sensitivity', friedman: 'Friedman (exact p)', page: 'Page L (ordered trend)', statistic: 'Statistic', exactP: 'Exact p',
      exactPOpposite: 'Opposite p', arrangements: 'Arrangements', direction: 'Direction', transformed: 'Transformed sensitivity (arcsine-sqrt)',
      r2partial: 'Partial R2', dispersion: 'Per-treatment dispersion', mean: 'Mean', sd: 'SD', cv: 'CV (%)'
    }
    const raw = buildRawRows(experiment)
    const aggregate = core.aggregateReplicateScores(experiment)
    const scoreRows = aggregate.map(row => [row.treatment, row.replicateNumber, row.completeSlides, row.incompleteSlides, row.absentSlides, row.score === null ? '-' : row.score.toFixed(2)])
    const rawRows = raw.map(row => [row.replicate_number, row.treatment, row.gel_number, row.status, row.completion || '-', row.absence_reason || row.incomplete_reason || '-', row.total_counted || '-', row.visual_score || '-'])
    const protocol = analysis?.protocol?.performed === false ? null : analysis?.protocol
    const population = analysis?.population?.performed === false ? null : analysis?.population
    const protocolRows = protocol ? [
      ['studyDesignVersion', protocol.studyDesignVersion], ['assayType', protocol.assayType], ['primaryReferenceTreatment', protocol.primaryReferenceTreatment],
      ['primaryTreatmentIndices', (protocol.primaryTreatmentIndices || []).join(', ')],
      ['validationComparison', protocol.validationComparison ? `${protocol.validationComparison.referenceTreatmentIndex} / ${protocol.validationComparison.treatmentIndex}` : '-'],
      ['alpha', protocol.alpha], ['alternative', protocol.alternative], ['multiplicityAdjustment', protocol.multiplicityAdjustment],
      ['confidenceLevel', protocol.confidenceLevel], ['includePrimaryReferenceAsZero', protocol.includePrimaryReferenceAsZero],
      ['visualScoreDenominator', protocol.visualScoreDenominator], ['offTargetSlidesIncluded', protocol.offTargetSlidesIncluded]
    ] : [[labels.notPerformed, reasonText(analysis?.protocol?.reason)]]
    const populationRows = population ? [
      [labels.primaryIncluded, (population.primary?.includedBlockNumbers || []).join(', ') || '-'],
      [labels.primaryExcluded, (population.primary?.excludedBlocks || []).map(block => `${block.replicateNumber}: ${joinedReasons(block.reasons)}`).join('; ') || '-'],
      [labels.validationIncluded, (population.validation?.includedBlockNumbers || []).join(', ') || '-']
    ] : [[labels.notPerformed, reasonText(analysis?.population?.reason)]]
    const anova = analysis?.blockAnova
    const anovaRows = anova?.performed ? (anova.terms || []).map(term => [term.term, term.SS, term.DF, term.MS, term.F ?? '-', term.p ?? '-']) : [[labels.notPerformed, reasonText(anova?.reason), '-', '-', '-', '-']]
    const comparisons = analysis?.primaryComparisons
    const comparisonRows = comparisons?.performed ? (comparisons.comparisons || []).map(row => [
      row.referenceTreatment, row.treatment, row.difference, `${row.ciLow} - ${row.ciHigh}`, row.pRaw, row.pAdjusted,
      row.significant ? labels.significant : labels.notSignificant, row.direction
    ]) : [[labels.notPerformed, reasonText(comparisons?.reason), '-', '-', '-', '-', '-', '-']]
    const control = analysis?.controlResponse
    const controlRows = control?.performed ? [[
      control.comparison.referenceTreatment, control.comparison.treatment, control.comparison.difference,
      `${control.comparison.ciLow} - ${control.comparison.ciHigh}`, control.comparison.pRaw,
      control.comparison.significant ? labels.significant : labels.notSignificant, control.comparison.direction
    ]] : [[labels.notPerformed, reasonText(control?.reason), '-', '-', '-', '-', '-']]
    const trend = analysis?.doseTrend
    const trendRows = trend?.performed ? [
      [labels.slope, trend.slope], ['SE', trend.standardError], ['t', trend.t], ['DF', trend.DF], [labels.ci, `${trend.ciLow} - ${trend.ciHigh}`],
      ['p', trend.p], ['R2', trend.r2], [labels.r2partial, trend.r2Partial ?? '-'], [labels.blocks, trend.blockCount], [labels.observations, trend.observationCount],
      [labels.decision, trend.significant ? labels.significant : labels.notSignificant]
    ] : [[labels.notPerformed, reasonText(trend?.reason)]]

    const dispersion = analysis?.descriptive
    const dispersionRows = dispersion && dispersion.performed !== false
      ? (dispersion.treatments || []).map(item => [item.treatment, item.mean, item.standardDeviation, item.coefficientOfVariation, item.blockCount])
      : [[labels.notPerformed, '-', '-', '-', '-']]

    const nonParametric = analysis?.nonParametric
    const friedman = nonParametric?.friedman
    const pageTrend = nonParametric?.pageTrend
    const friedmanRows = friedman && friedman.performed !== false
      ? [[friedman.statistic, friedman.df, friedman.pExact, friedman.exactArrangements]]
      : [[labels.notPerformed, reasonText(friedman?.reason) || reasonText(nonParametric?.reason), '-', '-']]
    const pageRows = pageTrend && pageTrend.performed !== false
      ? [[pageTrend.direction, pageTrend.statistic, pageTrend.pExact, pageTrend.pExactOpposite, pageTrend.exactArrangements]]
      : [[labels.notPerformed, reasonText(pageTrend?.reason) || reasonText(nonParametric?.reason), '-', '-', '-']]

    const transformed = analysis?.transformedAnalysis
    const transformedComparisons = transformed?.primaryComparisons
    const transformedTrend = transformed?.doseTrend
    const transformedComparisonRows = transformedComparisons && transformedComparisons.performed !== false
      ? (transformedComparisons.comparisons || []).map(row => [row.referenceTreatment, row.treatment, row.difference, row.pRaw, row.pAdjusted ?? '-'])
      : [[labels.notPerformed, reasonText(transformedComparisons?.reason) || reasonText(transformed?.reason), '-', '-', '-']]
    const transformedTrendRows = transformedTrend && transformedTrend.performed !== false
      ? [[transformedTrend.slope, transformedTrend.p, transformedTrend.r2Partial ?? '-']]
      : [[labels.notPerformed, reasonText(transformedTrend?.reason) || reasonText(transformed?.reason), '-']]

    const sensitivityHtml = [
      `<h2>${escapeHtml(labels.dispersion)}</h2>${htmlTable([labels.treatment, labels.mean, labels.sd, labels.cv, labels.blocks], dispersionRows)}`,
      `<h2>${escapeHtml(labels.nonParametric)}</h2>`,
      `<h3>${escapeHtml(labels.friedman)}</h3>${htmlTable([labels.statistic, labels.term, labels.exactP, labels.arrangements], friedmanRows)}`,
      `<h3>${escapeHtml(labels.page)}</h3>${htmlTable([labels.direction, labels.statistic, labels.exactP, labels.exactPOpposite, labels.arrangements], pageRows)}`,
      `<h2>${escapeHtml(labels.transformed)}</h2>`,
      `<h3>${escapeHtml(labels.comparisons)}</h3>${htmlTable([labels.reference, labels.treatment, labels.difference, labels.rawP, labels.holmP], transformedComparisonRows)}`,
      `<h3>${escapeHtml(labels.trend)}</h3>${htmlTable([labels.slope, labels.rawP, labels.r2partial], transformedTrendRows)}`
    ].join('')

    const chartItems = [
      [analysis?.charts?.scores, labels.chartScores], [analysis?.charts?.differences, labels.chartDifferences], [analysis?.charts?.classes, labels.chartClasses]
    ].filter(([image]) => validPngBase64(image)).map(([image, alt]) => `<figure><img src="data:image/png;base64,${image}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`).join('')
    return `<!DOCTYPE html><html lang="${pt ? 'pt-BR' : 'en'}"><head><meta charset="UTF-8"><title>CometQuant - ${escapeHtml(experiment.agent)}</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:auto;padding:32px;color:#17202a}h1,h2{color:#1a56a0}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}th,td{border:1px solid #bbb;padding:6px;text-align:center}th{background:#e8f0fe}img{max-width:100%}figcaption{text-align:center}.warning{color:#8a5600}</style></head><body><h1>CometQuant Lab</h1><p><strong>${escapeHtml(labels.researcher)}:</strong> ${escapeHtml(experiment.researcher || '-')}</p><p><strong>${escapeHtml(labels.agent)}:</strong> ${escapeHtml(experiment.agent)}</p><p><strong>${escapeHtml(labels.cells)}:</strong> ${escapeHtml(experiment.cells)}</p><p><strong>${escapeHtml(labels.target)}:</strong> ${escapeHtml(experiment.nucleoidsPerGel)}</p><p><strong>${escapeHtml(labels.slides)}:</strong> ${escapeHtml(experiment.slidesPerTreatment)}</p><p class="warning">${escapeHtml(labels.exclusion)}</p><h2>${escapeHtml(labels.raw)}</h2>${htmlTable([labels.replicate, labels.treatment, labels.slide, 'Status', labels.completion, labels.reason, 'Total', 'Score'], rawRows)}<h2>${escapeHtml(labels.scores)}</h2>${htmlTable([labels.treatment, labels.replicate, labels.complete, labels.incomplete, labels.absent, 'Score'], scoreRows)}<h2>${escapeHtml(labels.protocol)}</h2>${htmlTable([labels.item, labels.value], protocolRows)}<h2>${escapeHtml(labels.population)}</h2>${htmlTable([labels.item, labels.value], populationRows)}<h2>${escapeHtml(labels.rcbd)}</h2>${htmlTable([labels.term, 'SS', 'DF', 'MS', 'F', 'p'], anovaRows)}<h2>${escapeHtml(labels.comparisons)}</h2>${htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.holmP, labels.decision, labels.direction], comparisonRows)}<h2>${escapeHtml(labels.control)}</h2>${htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.decision, labels.direction], controlRows)}<h2>${escapeHtml(labels.trend)}</h2>${htmlTable([labels.item, labels.value], trendRows)}${sensitivityHtml}<h2>${escapeHtml(labels.charts)}</h2>${chartItems}<p>Generated by CometQuant Lab - schema ${escapeHtml(experiment.schemaVersion)} / analysis ${escapeHtml(analysis?.analysisSchemaVersion || '-')}</p></body></html>`
  }

  function reportLabels(pt) {
    return pt ? {
      researcher: 'Pesquisador', agent: 'Agente', cells: 'Tipo celular', target: 'Meta de nucleoides', slides: 'Lâminas por tratamento',
      exclusion: 'Lâminas contadas fora da meta usam o total efetivo e permanecem na análise; apenas ausentes ou sem contagem válida são excluídas.',
      conclusion: 'Conclusão em 30 segundos', validityTitle: 'Validade do ensaio', genotoxicSignal: 'Sinal de genotoxicidade', antigenotoxicSignal: 'Sinal de antigenotoxicidade', doseQuality: 'Qualidade da relação dose-resposta',
      valid: 'Válido', invalid: 'Inválido', attention: 'Atenção', effectEvidence: 'Evidência de efeito', noEvidence: 'Sem evidência', inconclusive: 'Inconclusivo', strong: 'Forte', weak: 'Fraca/irregular', absentStatus: 'Ausente', notAssessable: 'Não avaliável',
      decisionNotice: 'Este painel resume a balança de evidências; não classifica automaticamente a substância. A conclusão final cabe ao pesquisador, considerando citotoxicidade, controles históricos e o guia adotado. Os valores no HTML são arredondados apenas para leitura; JSON e CSV preservam a precisão integral.',
      visualOverview: 'Visão da dose-resposta', visualOverviewReading: 'Cada ponto é um experimento independente; o traço horizontal mostra a média fornecida pelo motor estatístico. Os controles são identificados por texto, não apenas por cor.',
      negativeControl: 'Controle negativo', positiveControl: 'Controle positivo', solventControl: 'Controle do solvente', testConcentration: 'Concentração teste', independentExperiment: 'Experimento independente', engineMean: 'Média do motor', visualScore: 'Score visual', chartData: 'Dados acessíveis do gráfico',
      raw: 'Dados brutos', scores: 'Scores por repetição', replicate: 'Repetição', treatment: 'Tratamento', slide: 'Lâmina', completion: 'Completude', reason: 'Motivo', complete: 'Na meta', incomplete: 'Fora da meta', absent: 'Ausentes',
      protocol: 'Protocolo científico', population: 'População de análise', item: 'Item', value: 'Valor', primaryIncluded: 'Blocos primários incluídos', primaryExcluded: 'Blocos primários excluídos', validationIncluded: 'Blocos de validação incluídos',
      rcbd: 'ANOVA em blocos casualizados', term: 'Termo', comparisons: 'Comparações primárias planejadas', reference: 'Referência', difference: 'Diferença', ci: 'IC 95% nominal', rawP: 'p bruto', holmP: 'p Holm', decision: 'Resultado estatístico', direction: 'Direção', significant: 'SIGNIFICATIVO', notSignificant: 'NÃO SIGNIFICATIVO',
      control: 'Resposta de controle', trend: 'Tendência de dose ajustada por bloco', slope: 'Inclinação', blocks: 'Blocos', observations: 'Observações', notPerformed: 'Não realizado',
      charts: 'Gráficos técnicos', chartScores: 'Scores por bloco', chartDifferences: 'Diferenças com IC 95%', chartClasses: 'Distribuição por classes',
      nonParametric: 'Sensibilidade não-paramétrica', friedman: 'Friedman (p exato)', page: 'Page L (tendência ordenada)', statistic: 'Estatística', exactP: 'p exato', exactPOpposite: 'p oposto', arrangements: 'Arranjos', transformed: 'Sensibilidade transformada (arcsine-sqrt)',
      r2partial: 'R2 parcial', dispersion: 'Dispersão por tratamento', mean: 'Média', sd: 'DP', cv: 'CV (%)', technicalDetails: 'Detalhamento técnico', simpleReading: 'Leitura simples', caution: 'Ponto de atenção', glossary: 'Glossário de bancada', generated: 'Gerado por'
    } : {
      researcher: 'Researcher', agent: 'Agent', cells: 'Cell type', target: 'Nucleoid target', slides: 'Slides per treatment',
      exclusion: 'Counted slides outside the target use their effective total and remain in analysis; only absent slides or slides without a valid count are excluded.',
      conclusion: '30-second conclusion', validityTitle: 'Assay validity', genotoxicSignal: 'Genotoxicity signal', antigenotoxicSignal: 'Antigenotoxicity signal', doseQuality: 'Dose-response quality',
      valid: 'Valid', invalid: 'Invalid', attention: 'Attention', effectEvidence: 'Evidence of effect', noEvidence: 'No evidence', inconclusive: 'Inconclusive', strong: 'Strong', weak: 'Weak/irregular', absentStatus: 'Absent', notAssessable: 'Not assessable',
      decisionNotice: 'This panel summarizes the balance of evidence; it does not automatically classify the substance. The final conclusion belongs to the researcher, considering cytotoxicity, historical controls, and the adopted guideline. Values in the HTML are rounded for readability only; JSON and CSV retain full precision.',
      visualOverview: 'Dose-response overview', visualOverviewReading: 'Each point is an independent experiment; the horizontal mark is the mean supplied by the statistical engine. Controls are identified by text, not color alone.',
      negativeControl: 'Negative control', positiveControl: 'Positive control', solventControl: 'Solvent control', testConcentration: 'Test concentration', independentExperiment: 'Independent experiment', engineMean: 'Engine mean', visualScore: 'Visual score', chartData: 'Accessible chart data',
      raw: 'Raw data', scores: 'Scores by replicate', replicate: 'Replicate', treatment: 'Treatment', slide: 'Slide', completion: 'Completion', reason: 'Reason', complete: 'On target', incomplete: 'Off target', absent: 'Absent',
      protocol: 'Scientific protocol', population: 'Analysis population', item: 'Item', value: 'Value', primaryIncluded: 'Included primary blocks', primaryExcluded: 'Excluded primary blocks', validationIncluded: 'Included validation blocks',
      rcbd: 'Randomized complete block ANOVA', term: 'Term', comparisons: 'Planned primary comparisons', reference: 'Reference', difference: 'Difference', ci: 'Nominal 95% CI', rawP: 'Raw p', holmP: 'Holm p', decision: 'Statistical result', direction: 'Direction', significant: 'SIGNIFICANT', notSignificant: 'NOT SIGNIFICANT',
      control: 'Control response', trend: 'Block-adjusted dose trend', slope: 'Slope', blocks: 'Blocks', observations: 'Observations', notPerformed: 'Not performed',
      charts: 'Technical charts', chartScores: 'Scores by block', chartDifferences: 'Differences with 95% CI', chartClasses: 'Class distribution',
      nonParametric: 'Non-parametric sensitivity', friedman: 'Friedman (exact p)', page: 'Page L (ordered trend)', statistic: 'Statistic', exactP: 'Exact p', exactPOpposite: 'Opposite p', arrangements: 'Arrangements', transformed: 'Transformed sensitivity (arcsine-sqrt)',
      r2partial: 'Partial R2', dispersion: 'Per-treatment dispersion', mean: 'Mean', sd: 'SD', cv: 'CV (%)', technicalDetails: 'Technical detail', simpleReading: 'Plain-language reading', caution: 'Point of attention', glossary: 'Bench glossary', generated: 'Generated by'
    }
  }

  function reportNumber(value, pt, digits = 2) {
    if (value === null || value === undefined || value === '') return '-'
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '-'
    return new Intl.NumberFormat(pt ? 'pt-BR' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(numeric)
  }

  function reportProbability(value, pt) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '-'
    if (numeric < 0.00001) return pt ? '< 0,00001' : '< 0.00001'
    return new Intl.NumberFormat(pt ? 'pt-BR' : 'en-US', { maximumFractionDigits: 5 }).format(numeric)
  }

  function reportP(value, pt, label = 'p') {
    const probability = reportProbability(value, pt)
    return probability.startsWith('<') ? `${label} ${probability}` : `${label}=${probability}`
  }

  function reportTechnicalNumber(value, pt) {
    if (value === null || value === undefined || value === '') return '-'
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '-'
    return new Intl.NumberFormat(pt ? 'pt-BR' : 'en-US', { maximumFractionDigits: 4 }).format(numeric)
  }

  function reportSection(id, title, reading, content, labels, caution = '') {
    const warning = caution ? `<p class="caution"><strong>${escapeHtml(labels.caution)}:</strong> ${escapeHtml(caution)}</p>` : ''
    return `<section class="report-section" id="${escapeHtml(id)}"><h2>${escapeHtml(title)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(reading)}</p>${warning}<details><summary>${escapeHtml(labels.technicalDetails)}</summary><div class="details-body">${content}</div></details></section>`
  }

  function statusCard(title, result) {
    return `<article class="status-card status-${escapeHtml(result.tone)}"><div class="status-heading"><span class="status-icon" aria-hidden="true">${result.icon}</span><div><h3>${escapeHtml(title)}</h3><p class="status-label">${escapeHtml(result.status)}</p></div></div><p>${escapeHtml(result.reason)}</p></article>`
  }

  function buildInterpretation(analysis, labels, pt) {
    const protocol = analysis?.protocol?.performed === false ? null : analysis?.protocol
    const alpha = Number(protocol?.alpha) || 0.05
    const antigenotoxic = protocol?.assayType === 'antigenotoxicity'
    const expectedDirection = antigenotoxic ? 'lower' : 'higher'
    const control = analysis?.controlResponse
    const controlComparison = control?.performed ? control.comparison : null
    let validity
    if (!controlComparison) {
      validity = { tone: 'attention', icon: '!', status: labels.attention, reason: pt ? 'A comparação entre os controles não pôde ser estimada.' : 'The comparison between controls could not be estimated.' }
    } else {
      const difference = `${Number(controlComparison.difference) >= 0 ? '+' : ''}${reportNumber(controlComparison.difference, pt)}`
      const key = `${difference} ${pt ? 'pontos' : 'points'}, ${reportP(controlComparison.pRaw, pt)}`
      const comparisonLabel = `${controlComparison.treatment} vs. ${controlComparison.referenceTreatment}`
      if (controlComparison.significant && controlComparison.direction === 'higher') validity = { tone: 'good', icon: '&#10003;', status: labels.valid, reason: pt ? `${comparisonLabel}: ${key}; o sistema respondeu ao dano conhecido.` : `${comparisonLabel}: ${key}; the system responded to known damage.` }
      else if (!controlComparison.significant) validity = { tone: 'bad', icon: '&#10007;', status: labels.invalid, reason: pt ? `${comparisonLabel}: ${key}; não foi detectada resposta significativa ao dano conhecido.` : `${comparisonLabel}: ${key}; no significant response to known damage was detected.` }
      else validity = { tone: 'attention', icon: '!', status: labels.attention, reason: pt ? `${comparisonLabel}: ${key}, mas a resposta ocorreu na direção inesperada.` : `${comparisonLabel}: ${key}, but the response was in the unexpected direction.` }
    }

    const comparisons = analysis?.primaryComparisons
    const rows = comparisons?.performed ? (comparisons.comparisons || []) : []
    const expected = rows.filter(row => row.significant && row.direction === expectedDirection)
    const unexpected = rows.filter(row => row.significant && row.direction !== expectedDirection)
    const notDetected = rows.filter(row => !row.significant)
    let signal
    if (!comparisons?.performed || !rows.length) signal = { tone: 'attention', icon: '?', status: labels.inconclusive, reason: pt ? 'As comparações planejadas não puderam ser estimadas.' : 'The planned comparisons could not be estimated.' }
    else if (unexpected.length) {
      const example = unexpected[0]
      signal = { tone: 'attention', icon: '!', status: labels.inconclusive, reason: pt ? `${expected.length} de ${rows.length} comparações seguiram a direção esperada, mas ${example.treatment} foi significativa na direção oposta (${reportP(example.pAdjusted, pt, 'p Holm')}).` : `${expected.length} of ${rows.length} comparisons followed the expected direction, but ${example.treatment} was significant in the opposite direction (${reportP(example.pAdjusted, pt, 'Holm p')}).` }
    } else if (expected.length) {
      const example = expected[0]
      const effect = antigenotoxic ? (pt ? 'redução de dano' : 'damage reduction') : (pt ? 'aumento de dano' : 'damage increase')
      const detectedNames = expected.map(row => row.treatment).join(', ')
      const notDetectedText = notDetected.length
        ? (pt ? `; ${notDetected.map(row => row.treatment).join(', ')} ${notDetected.length === 1 ? 'não mostrou' : 'não mostraram'} diferença (${reportP(notDetected[0].pAdjusted, pt, 'p Holm')})` : `; ${notDetected.map(row => row.treatment).join(', ')} ${notDetected.length === 1 ? 'did not show' : 'did not show'} a difference (${reportP(notDetected[0].pAdjusted, pt, 'Holm p')})`)
        : (pt ? `; exemplo: ${example.treatment} ${reportNumber(example.difference, pt)} pontos (${reportP(example.pAdjusted, pt, 'p Holm')})` : `; example: ${example.treatment} ${reportNumber(example.difference, pt)} points (${reportP(example.pAdjusted, pt, 'Holm p')})`)
      signal = { tone: 'good', icon: antigenotoxic ? '&#8595;' : '&#8593;', status: labels.effectEvidence, reason: pt ? `${expected.length} de ${rows.length} concentrações mostraram ${effect} (${detectedNames})${notDetectedText}.` : `${expected.length} of ${rows.length} concentrations showed ${effect} (${detectedNames})${notDetectedText}.` }
    } else {
      const example = rows[0]
      signal = { tone: 'neutral', icon: '&#8212;', status: labels.noEvidence, reason: pt ? `0 de ${rows.length} concentrações mostrou efeito na direção esperada; ${example.treatment}: ${reportP(example.pAdjusted, pt, 'p Holm')}.` : `0 of ${rows.length} concentrations showed an effect in the expected direction; ${example.treatment}: ${reportP(example.pAdjusted, pt, 'Holm p')}.` }
    }

    const trend = analysis?.doseTrend
    const page = analysis?.nonParametric?.pageTrend
    const slopeDirectionOk = trend?.performed && (antigenotoxic ? Number(trend.slope) < 0 : Number(trend.slope) > 0)
    const pageDirectionOk = page?.direction === (antigenotoxic ? 'decreasing' : 'increasing')
    const pageSignificant = page?.performed && pageDirectionOk && Number(page.pExact) < alpha
    const referenceDose = rows.length ? [{
      treatment: rows[0].referenceTreatment,
      mean: Number(rows[0].referenceMean),
      concentration: Number((trend?.treatmentDoses || []).find(item => item.treatmentIndex === rows[0].referenceTreatmentIndex)?.concentration)
    }] : []
    const doseMeans = referenceDose.concat(rows.map(row => ({
      treatment: row.treatment,
      mean: Number(row.treatmentMean),
      concentration: Number((trend?.treatmentDoses || []).find(item => item.treatmentIndex === row.treatmentIndex)?.concentration)
    }))).filter(item => Number.isFinite(item.mean) && Number.isFinite(item.concentration)).sort((a, b) => a.concentration - b.concentration)
    const reversals = []
    for (let index = 1; index < doseMeans.length; index += 1) {
      const previous = doseMeans[index - 1]
      const current = doseMeans[index]
      if ((antigenotoxic && current.mean > previous.mean) || (!antigenotoxic && current.mean < previous.mean)) reversals.push([previous, current])
    }
    let dose
    if (!trend?.performed || !page?.performed) dose = { tone: 'attention', icon: '?', status: labels.notAssessable, reason: pt ? 'A tendência linear ou a verificação de ordem por Page L não pôde ser estimada.' : 'The linear trend or Page L ordered check could not be estimated.' }
    else {
      const key = `${pt ? 'inclinação' : 'slope'}=${reportNumber(trend.slope, pt)}, ${reportP(trend.p, pt)}; ${reportP(page.pExact, pt, 'Page p')}`
      if (trend.significant && slopeDirectionOk && pageSignificant && !reversals.length) dose = { tone: 'good', icon: '&#8599;', status: labels.strong, reason: pt ? `${key}: tendência significativa, ordenada e sem reversões nas médias observadas.` : `${key}: significant ordered trend with no reversals in the observed means.` }
      else if (!trend.significant && !pageSignificant) dose = { tone: 'neutral', icon: '&#8212;', status: labels.absentStatus, reason: pt ? `${key}: nem o modelo linear nem Page L detectaram tendência.` : `${key}: neither the linear model nor Page L detected a trend.` }
      else {
        const irregularity = reversals.length ? (pt ? `${reversals.length} reversão(ões) entre médias de doses sucessivas` : `${reversals.length} reversal(s) between successive dose means`) : (pt ? 'os indicadores de tendência não concordaram completamente' : 'the trend indicators did not fully agree')
        dose = { tone: 'attention', icon: '!', status: labels.weak, reason: `${key}: ${irregularity}.` }
      }
    }
    return { validity, signal, dose, antigenotoxic, reversals }
  }

  function buildDoseResponseSvg(experiment, analysis, labels, pt) {
    const descriptive = analysis?.descriptive
    const population = analysis?.population
    if (!descriptive?.performed || !population || population.performed === false || !(descriptive.treatments || []).length) return ''
    const metadata = new Map((experiment.treatmentMetadata || []).map(item => [item.treatmentIndex, item]))
    const primaryBlocks = new Set(population.primary?.includedBlockNumbers || [])
    const validationBlocks = new Set(population.validation?.includedBlockNumbers || [])
    const groups = (descriptive.treatments || []).map(item => ({
      treatmentIndex: item.treatmentIndex,
      treatment: item.treatment,
      mean: Number(item.mean),
      population: 'primary',
      role: metadata.get(item.treatmentIndex)?.role || 'test-concentration',
      concentration: metadata.get(item.treatmentIndex)?.concentration
    }))
    const control = analysis?.controlResponse
    if (control?.performed) {
      const comparison = control.comparison
      ;[
        [comparison.referenceTreatmentIndex, comparison.referenceTreatment, comparison.referenceMean],
        [comparison.treatmentIndex, comparison.treatment, comparison.treatmentMean]
      ].forEach(([treatmentIndex, treatment, mean]) => {
        if (!groups.some(group => group.treatmentIndex === treatmentIndex)) {
          groups.push({ treatmentIndex, treatment, mean: Number(mean), population: 'validation', role: metadata.get(treatmentIndex)?.role || 'control', concentration: null })
        }
      })
    }
    const roleOrder = { 'negative-control': 0, 'solvent-control': 1, 'positive-control': 2, 'test-concentration': 3, test: 3 }
    groups.sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4) || Number(a.concentration ?? 0) - Number(b.concentration ?? 0) || a.treatmentIndex - b.treatmentIndex)
    const chartGroups = groups.filter(group => Number.isFinite(group.mean)).map(group => {
      const selected = group.population === 'validation' ? validationBlocks : primaryBlocks
      const points = (population.blocks || []).filter(block => selected.has(block.replicateNumber)).map(block => {
        const cell = (block.cells || []).find(item => item.treatmentIndex === group.treatmentIndex)
        return { replicateNumber: block.replicateNumber, score: Number(cell?.score) }
      }).filter(point => Number.isFinite(point.score))
      return { ...group, points }
    })
    if (!chartGroups.length) return ''
    const width = 900
    const height = 500
    const left = 72
    const right = 24
    const top = 34
    const bottom = 128
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const xStep = plotWidth / chartGroups.length
    const y = value => top + (100 - Math.max(0, Math.min(100, value))) / 100 * plotHeight
    const colors = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#6A3D9A']
    const grid = [0, 25, 50, 75, 100].map(value => `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="chart-grid"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end" class="chart-tick">${value}</text>`).join('')
    const marks = chartGroups.map((group, groupIndex) => {
      const x = left + xStep * (groupIndex + 0.5)
      const color = colors[groupIndex % colors.length]
      const pointMarks = group.points.map((point, pointIndex) => {
        const jitter = (pointIndex - (group.points.length - 1) / 2) * Math.min(14, 34 / Math.max(1, group.points.length - 1))
        const title = `${labels.independentExperiment} ${point.replicateNumber}: ${reportNumber(point.score, pt)}`
        return `<circle class="data-point" cx="${x + jitter}" cy="${y(point.score)}" r="7" fill="${color}" stroke="#ffffff" stroke-width="2"><title>${escapeHtml(title)}</title></circle>`
      }).join('')
      const role = group.role === 'negative-control' ? labels.negativeControl : group.role === 'positive-control' ? labels.positiveControl : group.role === 'solvent-control' ? labels.solventControl : labels.testConcentration
      const hasConcentration = group.concentration !== null && group.concentration !== undefined && group.concentration !== '' && Number.isFinite(Number(group.concentration))
      const dose = hasConcentration ? ` (${reportNumber(group.concentration, pt)} ${experiment.concUnit || ''})` : ''
      return `${pointMarks}<line x1="${x - 24}" y1="${y(group.mean)}" x2="${x + 24}" y2="${y(group.mean)}" stroke="#111827" stroke-width="5"><title>${escapeHtml(`${labels.engineMean}: ${reportNumber(group.mean, pt)}`)}</title></line><text x="${x}" y="${height - 78}" text-anchor="middle" class="chart-label">${escapeHtml(group.treatment)}</text><text x="${x}" y="${height - 58}" text-anchor="middle" class="chart-role">${escapeHtml(role + dose)}</text><text x="${x}" y="${height - 36}" text-anchor="middle" class="chart-mean">${escapeHtml(`${labels.mean}: ${reportNumber(group.mean, pt)}`)}</text>`
    }).join('')
    const accessibleRows = chartGroups.flatMap(group => group.points.map(point => [group.treatment, point.replicateNumber, point.score, group.mean]))
    const accessibleTable = htmlTable([labels.treatment, labels.replicate, labels.visualScore, labels.engineMean], accessibleRows)
    return `<div class="dose-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dose-chart-title dose-chart-desc"><title id="dose-chart-title">${escapeHtml(labels.visualOverview)}</title><desc id="dose-chart-desc">${escapeHtml(labels.visualOverviewReading)}</desc><style>.chart-grid{stroke:#d7dee8;stroke-width:1}.chart-tick,.chart-label,.chart-role,.chart-mean,.chart-axis{font-family:Arial,sans-serif;fill:#27364a}.chart-tick{font-size:13px}.chart-label{font-size:13px;font-weight:700}.chart-role{font-size:11px}.chart-mean{font-size:11px;font-weight:700}.chart-axis{font-size:14px;font-weight:700}</style>${grid}<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#67768a"/><line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" stroke="#67768a"/><text x="18" y="${top + plotHeight / 2}" transform="rotate(-90 18 ${top + plotHeight / 2})" text-anchor="middle" class="chart-axis">${escapeHtml(labels.visualScore)}</text>${marks}<circle class="chart-legend-point" cx="${left}" cy="${height - 12}" r="6" fill="#0072B2"/><text x="${left + 12}" y="${height - 8}" class="chart-role">${escapeHtml(labels.independentExperiment)}</text><line x1="${left + 190}" y1="${height - 12}" x2="${left + 228}" y2="${height - 12}" stroke="#111827" stroke-width="5"/><text x="${left + 238}" y="${height - 8}" class="chart-role">${escapeHtml(labels.engineMean)}</text></svg><div class="sr-only"><h3>${escapeHtml(labels.chartData)}</h3>${accessibleTable}</div></div>`
  }

  function reportGlossary(labels, pt) {
    const entries = pt ? [
      ['p-valor', 'Probabilidade de observar um resultado tão extremo quanto este se não houvesse diferença no modelo. Um p pequeno indica evidência, não o tamanho nem a importância biológica do efeito.'],
      ['Correção de Holm', 'Ajuste que controla falsos positivos quando várias concentrações são comparadas com a mesma referência.'],
      ['Intervalo de confiança', 'Faixa de valores compatíveis com a diferença estimada; intervalos largos indicam maior incerteza.'],
      ['Bloco / repetição', 'Um experimento independente, normalmente executado em outro dia. Lâminas do mesmo experimento são réplicas técnicas, não novos blocos.'],
      ['Tendência de dose', 'Teste se o score muda de forma sistemática com a concentração, descontando diferenças entre experimentos.'],
      [labels.positiveControl, 'Tratamento conhecido por produzir dano e usado para confirmar que o sistema experimental respondeu.'],
      [labels.negativeControl, 'Condição basal usada como referência para o dano de fundo.'],
      ['CV', 'Variação entre experimentos em relação à média. O relatório mostra o valor, mas não inventa um limite universal de CV elevado.']
    ] : [
      ['p-value', 'Probability of observing a result this extreme if there were no difference in the model. A small p-value indicates evidence, not effect size or biological importance.'],
      ['Holm correction', 'Adjustment that controls false positives when several concentrations are compared with the same reference.'],
      ['Confidence interval', 'Range of values compatible with the estimated difference; wider intervals mean more uncertainty.'],
      ['Block / replicate', 'One independent experiment, usually run on a different day. Slides from the same experiment are technical replicates, not new blocks.'],
      ['Dose trend', 'Tests whether the score changes systematically with concentration after accounting for differences between experiments.'],
      [labels.positiveControl, 'A treatment known to cause damage, used to confirm that the experimental system responded.'],
      [labels.negativeControl, 'The basal condition used as the reference for background damage.'],
      ['CV', 'Variation among experiments relative to the mean. The report displays it but does not invent a universal high-CV cutoff.']
    ]
    return `<section class="glossary"><h2>${escapeHtml(labels.glossary)}</h2><dl>${entries.map(([term, definition]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(definition)}</dd>`).join('')}</dl></section>`
  }

  function reportStyles() {
    return `:root{--ink:#17202a;--muted:#56657a;--line:#cbd5e1;--paper:#fff;--soft:#f4f7fb;--blue:#155b8f;--good:#176b43;--good-bg:#e7f4ec;--bad:#962f2f;--bad-bg:#fbeaea;--attention:#815600;--attention-bg:#fff4d6;--neutral:#315b7d;--neutral-bg:#e9f1f7}*{box-sizing:border-box}body{font-family:Arial,sans-serif;max-width:1120px;margin:auto;padding:32px;color:var(--ink);background:var(--paper);line-height:1.45}h1,h2{color:var(--blue)}h1{margin-bottom:6px}h2{margin-top:0}.subtitle{color:var(--muted);margin-top:0}.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.metadata p{margin:0}.warning,.caution{color:var(--attention);background:var(--attention-bg);border-left:5px solid var(--attention);padding:10px 12px}.conclusion-panel{margin:28px 0;padding:22px;border:2px solid #99adc1;border-radius:16px;background:#f8fbfe}.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.status-card{border:1px solid var(--line);border-top:6px solid;padding:15px;border-radius:10px;background:#fff}.status-card h3,.status-card p{margin:0}.status-card>p{margin-top:10px}.status-heading{display:flex;gap:10px;align-items:center}.status-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;font-weight:800;font-size:20px;background:#fff}.status-label{font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.04em}.status-good{border-top-color:var(--good);background:var(--good-bg)}.status-good .status-label,.status-good .status-icon{color:var(--good)}.status-bad{border-top-color:var(--bad);background:var(--bad-bg)}.status-bad .status-label,.status-bad .status-icon{color:var(--bad)}.status-attention{border-top-color:var(--attention);background:var(--attention-bg)}.status-attention .status-label,.status-attention .status-icon{color:var(--attention)}.status-neutral{border-top-color:var(--neutral);background:var(--neutral-bg)}.status-neutral .status-label,.status-neutral .status-icon{color:var(--neutral)}.decision-notice{font-weight:700;margin:18px 0 0;padding-top:16px;border-top:1px solid var(--line)}.report-section,.glossary{margin:26px 0;padding-top:20px;border-top:2px solid #dce5ee}.simple-reading{font-size:17px;background:#eef5fb;padding:12px 14px;border-left:5px solid var(--blue)}.simple-reading span{font-weight:800}.dose-chart{border:1px solid var(--line);border-radius:12px;padding:8px;overflow:auto}.dose-chart svg{display:block;width:100%;min-width:720px;height:auto}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.table-scroll{overflow-x:auto;margin:12px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #aeb9c6;padding:7px;text-align:center}th{background:#e4edf6;color:#183b56}.row-significant td{background:#e7f4ec}.row-significant td:first-child{border-left:5px solid var(--good)}.row-not-significant td{background:#f4f6f8}.row-not-significant td:first-child{border-left:5px solid #758294}details{border:1px solid var(--line);border-radius:8px;background:#fff}summary{cursor:pointer;padding:12px 14px;font-weight:800;color:var(--blue);background:var(--soft)}.details-body{padding:8px 14px 14px}.details-body h3{margin-top:20px}.details-body>.simple-reading{font-size:14px}figure{margin:22px 0}img{max-width:100%;height:auto}figcaption{text-align:center;font-weight:700;color:var(--muted)}.glossary dl{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:8px 16px}.glossary dt{font-weight:800}.glossary dd{margin:0 0 8px}.technical-group{margin-top:16px}footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted)}@media(max-width:760px){body{padding:16px}.status-grid{grid-template-columns:1fr}.glossary dl{grid-template-columns:1fr}.glossary dd{margin-bottom:14px}}@media print{body{max-width:none;padding:0}.conclusion-panel,.status-card,.simple-reading,.warning,.caution{print-color-adjust:exact;-webkit-print-color-adjust:exact}details>.details-body{display:block}summary{display:none}.dose-chart{overflow:visible}}`
  }

  function buildReportHtml(experiment, analysis, lang = 'en') {
    const pt = lang === 'pt'
    const labels = reportLabels(pt)
    const interpretation = buildInterpretation(analysis, labels, pt)
    const raw = buildRawRows(experiment)
    const aggregate = core.aggregateReplicateScores(experiment)
    const scoreRows = aggregate.map(row => [row.treatment, row.replicateNumber, row.completeSlides, row.incompleteSlides, row.absentSlides, row.score === null ? '-' : row.score.toFixed(2)])
    const rawRows = raw.map(row => [row.replicate_number, row.treatment, row.gel_number, row.status, row.completion || '-', row.absence_reason || row.incomplete_reason || '-', row.total_counted || '-', row.visual_score || '-'])
    const protocol = analysis?.protocol?.performed === false ? null : analysis?.protocol
    const population = analysis?.population?.performed === false ? null : analysis?.population
    const alpha = Number(protocol?.alpha) || 0.05
    const protocolRows = protocol ? [
      ['studyDesignVersion', protocol.studyDesignVersion], ['assayType', protocol.assayType], ['primaryReferenceTreatment', protocol.primaryReferenceTreatment],
      ['primaryTreatmentIndices', (protocol.primaryTreatmentIndices || []).join(', ')], ['validationComparison', protocol.validationComparison ? `${protocol.validationComparison.referenceTreatmentIndex} / ${protocol.validationComparison.treatmentIndex}` : '-'],
      ['alpha', protocol.alpha], ['alternative', protocol.alternative], ['multiplicityAdjustment', protocol.multiplicityAdjustment], ['confidenceLevel', protocol.confidenceLevel],
      ['includePrimaryReferenceAsZero', protocol.includePrimaryReferenceAsZero], ['visualScoreDenominator', protocol.visualScoreDenominator], ['offTargetSlidesIncluded', protocol.offTargetSlidesIncluded]
    ] : [[labels.notPerformed, reasonText(analysis?.protocol?.reason)]]
    const populationRows = population ? [
      [labels.primaryIncluded, (population.primary?.includedBlockNumbers || []).join(', ') || '-'],
      [labels.primaryExcluded, (population.primary?.excludedBlocks || []).map(block => `${block.replicateNumber}: ${joinedReasons(block.reasons)}`).join('; ') || '-'],
      [labels.validationIncluded, (population.validation?.includedBlockNumbers || []).join(', ') || '-']
    ] : [[labels.notPerformed, reasonText(analysis?.population?.reason)]]
    const anova = analysis?.blockAnova
    const anovaRows = anova?.performed ? (anova.terms || []).map(term => ({
      cells: [term.term, reportTechnicalNumber(term.SS, pt), term.DF, reportTechnicalNumber(term.MS, pt), reportTechnicalNumber(term.F, pt), reportProbability(term.p, pt)],
      className: Number.isFinite(Number(term.p)) ? (Number(term.p) < alpha ? 'row-significant' : 'row-not-significant') : ''
    })) : [[labels.notPerformed, reasonText(anova?.reason), '-', '-', '-', '-']]
    const comparisons = analysis?.primaryComparisons
    const comparisonRows = comparisons?.performed ? (comparisons.comparisons || []).map(row => ({
      cells: [row.referenceTreatment, row.treatment, reportNumber(row.difference, pt), `${reportNumber(row.ciLow, pt)} - ${reportNumber(row.ciHigh, pt)}`, reportProbability(row.pRaw, pt), reportProbability(row.pAdjusted, pt), row.significant ? labels.significant : labels.notSignificant, row.direction],
      className: row.significant ? 'row-significant' : 'row-not-significant'
    })) : [[labels.notPerformed, reasonText(comparisons?.reason), '-', '-', '-', '-', '-', '-']]
    const control = analysis?.controlResponse
    const controlRows = control?.performed ? [{
      cells: [control.comparison.referenceTreatment, control.comparison.treatment, reportNumber(control.comparison.difference, pt), `${reportNumber(control.comparison.ciLow, pt)} - ${reportNumber(control.comparison.ciHigh, pt)}`, reportProbability(control.comparison.pRaw, pt), control.comparison.significant ? labels.significant : labels.notSignificant, control.comparison.direction],
      className: control.comparison.significant ? 'row-significant' : 'row-not-significant'
    }] : [[labels.notPerformed, reasonText(control?.reason), '-', '-', '-', '-', '-']]
    const trend = analysis?.doseTrend
    const trendRows = trend?.performed ? [
      [labels.slope, reportTechnicalNumber(trend.slope, pt)], ['SE', reportTechnicalNumber(trend.standardError, pt)], ['t', reportTechnicalNumber(trend.t, pt)], ['DF', trend.DF], [labels.ci, `${reportTechnicalNumber(trend.ciLow, pt)} - ${reportTechnicalNumber(trend.ciHigh, pt)}`],
      ['p', reportProbability(trend.p, pt)], ['R2', reportTechnicalNumber(trend.r2, pt)], [labels.r2partial, reportTechnicalNumber(trend.r2Partial, pt)], [labels.blocks, trend.blockCount], [labels.observations, trend.observationCount],
      { cells: [labels.decision, trend.significant ? labels.significant : labels.notSignificant], className: trend.significant ? 'row-significant' : 'row-not-significant' }
    ] : [[labels.notPerformed, reasonText(trend?.reason)]]
    const dispersion = analysis?.descriptive
    const dispersionRows = dispersion?.performed ? (dispersion.treatments || []).map(item => [item.treatment, reportNumber(item.mean, pt), reportNumber(item.standardDeviation, pt), reportNumber(item.coefficientOfVariation, pt), item.blockCount]) : [[labels.notPerformed, '-', '-', '-', '-']]
    const heterogeneity = dispersion?.heterogeneityFlag
    const nonParametric = analysis?.nonParametric
    const friedman = nonParametric?.friedman
    const page = nonParametric?.pageTrend
    const friedmanRows = friedman?.performed ? [{ cells: [reportTechnicalNumber(friedman.statistic, pt), friedman.df, reportProbability(friedman.pExact, pt), friedman.exactArrangements], className: Number(friedman.pExact) < alpha ? 'row-significant' : 'row-not-significant' }] : [[labels.notPerformed, reasonText(friedman?.reason) || reasonText(nonParametric?.reason), '-', '-']]
    const pageRows = page?.performed ? [{ cells: [page.direction, reportTechnicalNumber(page.statistic, pt), reportProbability(page.pExact, pt), reportProbability(page.pExactOpposite, pt), page.exactArrangements], className: Number(page.pExact) < alpha ? 'row-significant' : 'row-not-significant' }] : [[labels.notPerformed, reasonText(page?.reason) || reasonText(nonParametric?.reason), '-', '-', '-']]
    const transformed = analysis?.transformedAnalysis
    const transformedComparisons = transformed?.primaryComparisons
    const transformedTrend = transformed?.doseTrend
    const transformedComparisonRows = transformedComparisons?.performed ? (transformedComparisons.comparisons || []).map(row => ({ cells: [row.referenceTreatment, row.treatment, reportTechnicalNumber(row.difference, pt), reportProbability(row.pRaw, pt), reportProbability(row.pAdjusted, pt), row.significant ? labels.significant : labels.notSignificant], className: row.significant ? 'row-significant' : 'row-not-significant' })) : [[labels.notPerformed, reasonText(transformedComparisons?.reason) || reasonText(transformed?.reason), '-', '-', '-', '-']]
    const transformedTrendRows = transformedTrend?.performed ? [{ cells: [reportTechnicalNumber(transformedTrend.slope, pt), reportProbability(transformedTrend.p, pt), reportTechnicalNumber(transformedTrend.r2Partial, pt), transformedTrend.significant ? labels.significant : labels.notSignificant], className: transformedTrend.significant ? 'row-significant' : 'row-not-significant' }] : [[labels.notPerformed, reasonText(transformedTrend?.reason) || reasonText(transformed?.reason), '-', '-']]
    const chartItems = [[analysis?.charts?.scores, labels.chartScores], [analysis?.charts?.differences, labels.chartDifferences], [analysis?.charts?.classes, labels.chartClasses]]
      .filter(([image]) => validPngBase64(image)).map(([image, alt]) => `<figure><img src="data:image/png;base64,${image}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`).join('')
    const doseChart = buildDoseResponseSvg(experiment, analysis, labels, pt)
    const treatmentTerm = anova?.performed ? (anova.terms || []).find(term => term.term === 'treatment') : null
    const anovaReading = treatmentTerm ? (pt ? `A ANOVA separa a variação entre tratamentos da variação entre experimentos; para tratamento, ${reportP(treatmentTerm.p, pt)}.` : `ANOVA separates treatment variation from variation among experiments; treatment ${reportP(treatmentTerm.p, pt)}.`) : (pt ? 'A ANOVA em blocos não pôde ser estimada.' : 'The blocked ANOVA could not be estimated.')
    const populationReading = population ? (pt ? `${population.primary?.includedBlockCount ?? 0} experimento(s) independente(s) entraram na análise primária; exclusões e motivos permanecem abaixo.` : `${population.primary?.includedBlockCount ?? 0} independent experiment(s) entered the primary analysis; exclusions and reasons remain below.`) : (pt ? 'A população analítica não pôde ser definida.' : 'The analysis population could not be defined.')
    const protocolReading = protocol ? (pt ? `O desenho é de ${protocol.assayType === 'antigenotoxicity' ? 'antigenotoxicidade' : 'genotoxicidade'}, com alfa=${protocol.alpha} e correção de Holm.` : `The design is ${protocol.assayType}, with alpha=${protocol.alpha} and Holm correction.`) : (pt ? 'O protocolo científico não estava disponível.' : 'The scientific protocol was unavailable.')
    const cvReading = dispersion?.performed ? (pt ? `CVs observados: ${(dispersion.treatments || []).map(item => `${item.treatment} ${reportNumber(item.coefficientOfVariation, pt)}%`).join('; ')}. Nenhum limite universal de CV elevado foi aplicado.` : `Observed CVs: ${(dispersion.treatments || []).map(item => `${item.treatment} ${reportNumber(item.coefficientOfVariation, pt)}%`).join('; ')}. No universal high-CV cutoff was applied.`) : (pt ? 'A dispersão entre repetições não pôde ser estimada.' : 'Between-replicate dispersion could not be estimated.')
    const heterogeneityCaution = heterogeneity?.performed && heterogeneity.flagged ? (pt ? `O motor sinalizou variabilidade desigual entre tratamentos: razão entre o maior e o menor DP=${reportNumber(heterogeneity.ratio, pt)}.` : `The engine flagged unequal variability across treatments: largest-to-smallest SD ratio=${reportNumber(heterogeneity.ratio, pt)}.`) : ''
    const friedmanReading = friedman?.performed ? (pt ? `Friedman verifica diferenças globais sem depender da escala original; ${reportP(friedman.pExact, pt, 'p exato')}.` : `Friedman checks overall differences without relying on the original scale; ${reportP(friedman.pExact, pt, 'exact p')}.`) : labels.notPerformed
    const pageReading = page?.performed ? (pt ? `Page L verifica a ordem ${page.direction === 'decreasing' ? 'decrescente' : 'crescente'} predefinida pelo tipo de ensaio; ${reportP(page.pExact, pt, 'p exato')}.` : `Page L checks the ${page.direction} order predefined by assay type; ${reportP(page.pExact, pt, 'exact p')}.`) : labels.notPerformed
    const transformedRows = transformedComparisons?.performed ? (transformedComparisons.comparisons || []) : []
    const transformedDetected = transformedRows.filter(row => row.significant)
    const transformedNotDetected = transformedRows.filter(row => !row.significant)
    const transformedComparisonReading = transformedRows.length
      ? (pt
          ? `${transformedDetected.length} de ${transformedRows.length} comparações foram significativas na escala transformada${transformedNotDetected.length ? `; sem diferença: ${transformedNotDetected.map(row => row.treatment).join(', ')}` : ''}.`
          : `${transformedDetected.length} of ${transformedRows.length} comparisons were significant on the transformed scale${transformedNotDetected.length ? `; no difference: ${transformedNotDetected.map(row => row.treatment).join(', ')}` : ''}.`)
      : labels.notPerformed
    const transformedTrendReading = transformedTrend?.performed
      ? (pt ? `A tendência transformada teve inclinação=${reportTechnicalNumber(transformedTrend.slope, pt)} e ${reportP(transformedTrend.p, pt)}.` : `The transformed trend had slope=${reportTechnicalNumber(transformedTrend.slope, pt)} and ${reportP(transformedTrend.p, pt)}.`)
      : labels.notPerformed
    const primaryByTreatment = new Map((comparisons?.comparisons || []).map(row => [row.treatmentIndex, row]))
    const changedSensitivity = transformedRows.filter(row => primaryByTreatment.has(row.treatmentIndex) && Boolean(primaryByTreatment.get(row.treatmentIndex).significant) !== Boolean(row.significant))
    const sensitivityDifference = changedSensitivity.length
      ? (pt ? ` Atenção: a decisão de significância mudou após a transformação para ${changedSensitivity.map(row => row.treatment).join(', ')}.` : ` Attention: the significance decision changed after transformation for ${changedSensitivity.map(row => row.treatment).join(', ')}.`)
      : ''
    const sensitivityReading = `${transformedComparisonReading} ${transformedTrendReading}${sensitivityDifference} ${pt ? 'Esta é uma verificação de robustez e não substitui a análise principal.' : 'This is a robustness check and does not replace the primary analysis.'}`
    const chartsReading = pt ? 'Os gráficos originais do motor permanecem disponíveis para inspeção técnica de blocos, intervalos e classes.' : "The engine's original charts remain available for technical inspection of blocks, intervals, and classes."
    const scoreReading = pt ? `${aggregate.length} célula(s) experimento x tratamento resumem as réplicas técnicas antes da inferência.` : `${aggregate.length} experiment-by-treatment cell(s) summarize technical replicates before inference.`
    const rawReading = pt ? `${raw.length} registro(s) de lâmina são preservados para auditoria; valores fora da meta não são convertidos em zero.` : `${raw.length} slide record(s) are preserved for audit; off-target values are not converted to zero.`
    const signalTitle = interpretation.antigenotoxic ? labels.antigenotoxicSignal : labels.genotoxicSignal
    const nonParametricDetails = `<div class="technical-group"><h3>${escapeHtml(labels.friedman)}</h3><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(friedmanReading)}</p>${htmlTable([labels.statistic, labels.term, labels.exactP, labels.arrangements], friedmanRows)}</div><div class="technical-group"><h3>${escapeHtml(labels.page)}</h3><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(pageReading)}</p>${htmlTable([labels.direction, labels.statistic, labels.exactP, labels.exactPOpposite, labels.arrangements], pageRows)}</div>`
    const transformedDetails = `<h3>${escapeHtml(labels.comparisons)}</h3><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(transformedComparisonReading)}</p>${htmlTable([labels.reference, labels.treatment, labels.difference, labels.rawP, labels.holmP, labels.decision], transformedComparisonRows)}<h3>${escapeHtml(labels.trend)}</h3><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(transformedTrendReading)}</p>${htmlTable([labels.slope, labels.rawP, labels.r2partial, labels.decision], transformedTrendRows)}`
    const reversalCaution = interpretation.reversals.length ? (pt ? 'Uma dose maior apresentou média de dano menos favorável que a dose anterior; veja os pontos individuais e as médias.' : 'A higher dose had a less favorable damage mean than the preceding dose; inspect individual points and means.') : ''
    return `<!DOCTYPE html><html lang="${pt ? 'pt-BR' : 'en'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CometQuant - ${escapeHtml(experiment.agent)}</title><style>${reportStyles()}</style></head><body><header><h1>CometQuant Lab</h1><p class="subtitle">${escapeHtml(pt ? 'Relatório de evidências do ensaio cometa' : 'Comet assay evidence report')}</p><div class="metadata"><p><strong>${escapeHtml(labels.researcher)}:</strong> ${escapeHtml(experiment.researcher || '-')}</p><p><strong>${escapeHtml(labels.agent)}:</strong> ${escapeHtml(experiment.agent)}</p><p><strong>${escapeHtml(labels.cells)}:</strong> ${escapeHtml(experiment.cells)}</p><p><strong>${escapeHtml(labels.target)}:</strong> ${escapeHtml(experiment.nucleoidsPerGel)}</p><p><strong>${escapeHtml(labels.slides)}:</strong> ${escapeHtml(experiment.slidesPerTreatment)}</p></div></header><main><section class="conclusion-panel" aria-labelledby="conclusion-title"><h2 id="conclusion-title">${escapeHtml(labels.conclusion)}</h2><div class="status-grid">${statusCard(labels.validityTitle, interpretation.validity)}${statusCard(signalTitle, interpretation.signal)}${statusCard(labels.doseQuality, interpretation.dose)}</div><p class="decision-notice">${escapeHtml(labels.decisionNotice)}</p></section>${doseChart ? `<section class="report-section"><h2>${escapeHtml(labels.visualOverview)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(labels.visualOverviewReading)}</p>${doseChart}</section>` : ''}${reportSection('comparisons', labels.comparisons, interpretation.signal.reason, htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.holmP, labels.decision, labels.direction], comparisonRows), labels)}${reportSection('control', labels.control, interpretation.validity.reason, htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.decision, labels.direction], controlRows), labels)}${reportSection('trend', labels.trend, interpretation.dose.reason, htmlTable([labels.item, labels.value], trendRows), labels, reversalCaution)}${reportSection('dispersion', labels.dispersion, cvReading, htmlTable([labels.treatment, labels.mean, labels.sd, labels.cv, labels.blocks], dispersionRows), labels, heterogeneityCaution)}${reportSection('anova', labels.rcbd, anovaReading, htmlTable([labels.term, 'SS', 'DF', 'MS', 'F', 'p'], anovaRows), labels)}${reportSection('population', labels.population, populationReading, htmlTable([labels.item, labels.value], populationRows), labels)}${reportSection('protocol', labels.protocol, protocolReading, htmlTable([labels.item, labels.value], protocolRows), labels)}${reportSection('non-parametric', labels.nonParametric, `${friedmanReading} ${pageReading}`, nonParametricDetails, labels)}${reportSection('transformed', labels.transformed, sensitivityReading, transformedDetails, labels)}${reportSection('charts', labels.charts, chartsReading, chartItems || `<p>${escapeHtml(labels.notPerformed)}</p>`, labels)}${reportSection('scores', labels.scores, scoreReading, htmlTable([labels.treatment, labels.replicate, labels.complete, labels.incomplete, labels.absent, 'Score'], scoreRows), labels)}${reportSection('raw', labels.raw, rawReading, `<p class="warning">${escapeHtml(labels.exclusion)}</p>${htmlTable([labels.replicate, labels.treatment, labels.slide, 'Status', labels.completion, labels.reason, 'Total', 'Score'], rawRows)}`, labels)}${reportGlossary(labels, pt)}</main><footer><p>${escapeHtml(labels.generated)} CometQuant Lab - schema ${escapeHtml(experiment.schemaVersion)} / analysis ${escapeHtml(analysis?.analysisSchemaVersion || '-')}</p></footer></body></html>`
  }

  function safeFilename(value) {
    return String(value || 'Experiment').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Experiment'
  }

  return {
    escapeHtml, escapeCsv, serializeCsv, buildRawRows, buildRawCsv, buildAggregateCsv,
    buildPopulationCsv, buildBlockAnovaCsv, buildComparisonsCsv, buildControlResponseCsv,
    buildDoseTrendCsv, buildNonParametricCsv, buildTransformedAnalysisCsv, buildStudyDesignCsv,
    buildReportHtml, validPngBase64, safeFilename
  }
})
