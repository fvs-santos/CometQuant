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

  function htmlTable(headers, rows) {
    return `<table><thead><tr>${headers.map(value => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  }

  function validPngBase64(value) {
    return typeof value === 'string' && value.length < 20_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.startsWith('iVBORw0KGgo')
  }

  function buildReportHtml(experiment, analysis, lang = 'en') {
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
