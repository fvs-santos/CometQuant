(function (root, factory) {
  const core = root.CometQuantCore || (typeof require === 'function' ? require('./core.js') : null)
  const api = factory(core)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantExport = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict'

  const APP_VERSION = '2.3.0'

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

  function flagText(value) {
    return typeof value === 'boolean' ? String(value) : ''
  }

  function replicateAnalysisFlags(analysis, replicateNumber) {
    if (!analysis) {
      return {
        selected_for_analysis: '', selection_exclusion_reason: '', primary_eligible: '', primary_included: '',
        validation_eligible: '', validation_included: ''
      }
    }
    const population = analysis.population
    const selection = analysis.selection
    const block = (population?.blocks || []).find(item => item.replicateNumber === replicateNumber)
    const fromNumbers = (value, numbers) => typeof value === 'boolean' ? value : (Array.isArray(numbers) ? numbers.includes(replicateNumber) : undefined)
    const selected = fromNumbers(block?.selected, selection?.performed ? selection.selectedBlockNumbers : undefined)
    const primaryEligible = fromNumbers(block?.primaryEligible, population?.primary?.eligibleBlockNumbers)
    const primaryIncluded = fromNumbers(block?.primaryIncluded, population?.primary?.includedBlockNumbers)
    const validationEligible = fromNumbers(block?.validationEligible, population?.validation?.eligibleBlockNumbers)
    const validationIncluded = fromNumbers(block?.validationIncluded, population?.validation?.includedBlockNumbers)
    return {
      selected_for_analysis: flagText(selected),
      selection_exclusion_reason: selected === false ? (selection?.exclusionReason || '') : '',
      primary_eligible: flagText(primaryEligible),
      primary_included: flagText(primaryIncluded),
      validation_eligible: flagText(validationEligible),
      validation_included: flagText(validationIncluded)
    }
  }

  function buildRawRows(experiment, analysis) {
    const rows = []
    experiment.replicates.forEach(replicate => {
      const assignments = replicate.assignments || []
      if (!assignments.length) {
        replicate.gels.forEach(gel => rows.push(rawRow(experiment, replicate, null, gel, analysis)))
        return
      }
      assignments.forEach(assignment => {
        const gel = replicate.gels.find(item => item.blindCode === assignment.blindCode)
        rows.push(rawRow(experiment, replicate, assignment, gel, analysis))
      })
    })
    return rows.sort((a, b) => a.replicate_number - b.replicate_number || a.treatment_index - b.treatment_index || a.gel_number - b.gel_number)
  }

  function rawRow(experiment, replicate, assignment, gel, analysis) {
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
      ...replicateAnalysisFlags(analysis, replicate.replicateNumber),
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

  const RAW_COLUMNS = ['schema_version', 'experiment_id', 'created_at', 'updated_at', 'researcher', 'agent', 'cells', 'negative_control', 'positive_control', 'solvent_control', 'concentration_unit', 'target_nucleoids', 'slides_per_treatment', 'replicate_number', 'replicate_date', 'selected_for_analysis', 'selection_exclusion_reason', 'primary_eligible', 'primary_included', 'validation_eligible', 'validation_included', 'blind_code', 'treatment_index', 'treatment', 'gel_number', 'status', 'absence_reason', 'incomplete_reason', 'recorded_at', 'class0', 'class1', 'class2', 'class3', 'class4', 'total_counted', 'completion', 'included_in_analysis', 'visual_score'].map(key => ({ key }))
  const AGGREGATE_COLUMNS = ['treatment_index', 'treatment', 'replicate_number', 'selected_for_analysis', 'selection_exclusion_reason', 'primary_eligible', 'primary_included', 'validation_eligible', 'validation_included', 'expected_slides', 'counted_slides', 'analyzed_slides', 'complete_slides', 'incomplete_slides', 'absent_slides', 'replicate_score_mean'].map(key => ({ key }))

  function buildRawCsv(experiment, analysis) {
    return serializeCsv(RAW_COLUMNS, buildRawRows(experiment, analysis))
  }

  function buildAggregateCsv(experiment, analysis) {
    const rows = core.aggregateReplicateScores(experiment).map(row => ({
      treatment_index: row.treatmentIndex, treatment: row.treatment, replicate_number: row.replicateNumber,
      ...replicateAnalysisFlags(analysis, row.replicateNumber),
      expected_slides: row.expectedSlides, counted_slides: row.countedSlides, analyzed_slides: row.analyzedSlides, complete_slides: row.completeSlides,
      incomplete_slides: row.incompleteSlides, absent_slides: row.absentSlides,
      replicate_score_mean: row.score === null ? '' : row.score.toFixed(4)
    }))
    return serializeCsv(AGGREGATE_COLUMNS, rows)
  }

  function snapshotEditFields(prefix, snapshot) {
    const gel = snapshot?.gel
    return {
      [`${prefix}_status`]: snapshot?.assignment?.status || '',
      [`${prefix}_absence_reason`]: reasonText(snapshot?.assignment?.absenceReason),
      [`${prefix}_class0`]: gel?.class0 ?? '',
      [`${prefix}_class1`]: gel?.class1 ?? '',
      [`${prefix}_class2`]: gel?.class2 ?? '',
      [`${prefix}_class3`]: gel?.class3 ?? '',
      [`${prefix}_class4`]: gel?.class4 ?? '',
      [`${prefix}_total`]: gel?.total ?? '',
      [`${prefix}_completion`]: gel?.completion || '',
      [`${prefix}_incomplete_reason`]: reasonText(gel?.incompleteReason),
      [`${prefix}_assignment_recorded_at`]: snapshot?.assignment?.recordedAt || '',
      [`${prefix}_gel_recorded_at`]: gel?.recordedAt || '',
      [`${prefix}_visual_score`]: gel && core.calculateVisualScore(gel) !== null ? core.calculateVisualScore(gel).toFixed(4) : ''
    }
  }

  function buildSlideEditRows(experiment) {
    return (experiment.slideEditHistory || []).map(event => ({
      edit_id: event.editId,
      edited_at: event.editedAt,
      edited_by: event.editedBy,
      reason: event.reason,
      replicate_number: event.slide.replicateNumber,
      blind_code: event.slide.blindCode,
      treatment_index: event.slide.treatmentIndex,
      treatment: experiment.treatments[event.slide.treatmentIndex] || '',
      gel_number: event.slide.gelNumber,
      ...snapshotEditFields('before', event.before),
      ...snapshotEditFields('after', event.after)
    }))
  }

  const SLIDE_EDIT_COLUMNS = [
    'edit_id', 'edited_at', 'edited_by', 'reason', 'replicate_number', 'blind_code', 'treatment_index', 'treatment', 'gel_number',
    'before_status', 'after_status', 'before_absence_reason', 'after_absence_reason',
    'before_class0', 'before_class1', 'before_class2', 'before_class3', 'before_class4', 'before_total', 'before_completion', 'before_incomplete_reason', 'before_assignment_recorded_at', 'before_gel_recorded_at', 'before_visual_score',
    'after_class0', 'after_class1', 'after_class2', 'after_class3', 'after_class4', 'after_total', 'after_completion', 'after_incomplete_reason', 'after_assignment_recorded_at', 'after_gel_recorded_at', 'after_visual_score'
  ].map(key => ({ key }))

  function buildSlideEditCsv(experiment) {
    return serializeCsv(SLIDE_EDIT_COLUMNS, buildSlideEditRows(experiment))
  }

  function slideEditSnapshotText(prefix, row) {
    if (row[`${prefix}_status`] === 'absent') return `absent; ${row[`${prefix}_absence_reason`] || '-'}; assignment_recorded_at=${row[`${prefix}_assignment_recorded_at`] || '-'}`
    const counts = [0, 1, 2, 3, 4].map(classIndex => row[`${prefix}_class${classIndex}`]).join('/')
    return `${row[`${prefix}_status`]}; ${counts}; total=${row[`${prefix}_total`]}; score=${row[`${prefix}_visual_score`] || '-'}; completion=${row[`${prefix}_completion`] || '-'}; incomplete_reason=${row[`${prefix}_incomplete_reason`] || '-'}; assignment_recorded_at=${row[`${prefix}_assignment_recorded_at`] || '-'}; gel_recorded_at=${row[`${prefix}_gel_recorded_at`] || '-'}`
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

  const POPULATION_COLUMNS = ['replicate_number', 'selected_for_analysis', 'selection_exclusion_reason', 'primary_eligible', 'primary_included', 'primary_exclusion_reasons', 'validation_eligible', 'validation_included', 'validation_exclusion_reasons', 'treatment_index', 'treatment', 'expected_slides', 'valid_slides', 'invalid_slides', 'absent_slides', 'score', 'technical_replication_complete'].map(key => ({ key }))
  const VALIDATION_COLUMNS = ['independent_experiment_count', 'minimum_required_experiments', 'estimable', 'basal_control_present', 'positive_control_present', 'viability_data_available', 'score_out_of_range_count', 'floor_ceiling_flagged', 'floor_ceiling_ratio', 'replicate_number', 'treatment_index', 'treatment', 'expected_slides', 'valid_slides', 'absent_slides', 'score_available'].map(key => ({ key }))
  const BLOCK_ANOVA_COLUMNS = ['performed', 'reason_code', 'reason_context', 'model', 'block_count', 'treatment_indices', 'residual_df', 'MSE', 'term', 'SS', 'DF', 'MS', 'F', 'p'].map(key => ({ key }))
  const COMPARISON_COLUMNS = ['performed', 'reason_code', 'reason_context', 'comparison_method', 'family', 'family_size', 'confidence_level', 'confidence_intervals', 'dunnett_critical_value', 'random_state_seed', 'reference_treatment_index', 'reference_treatment', 'treatment_index', 'treatment', 'block_count', 'reference_mean', 'treatment_mean', 'difference', 'standard_error', 't', 'DF', 'ci_low', 'ci_high', 'p_raw', 'p_adjusted', 'significant', 'direction', 'increase_detected'].map(key => ({ key }))
  const CONTROL_RESPONSE_COLUMNS = ['performed', 'reason_code', 'reason_context', 'purpose', 'block_numbers', 'notes', 'reference_treatment_index', 'reference_treatment', 'treatment_index', 'treatment', 'block_count', 'reference_mean', 'treatment_mean', 'difference', 'standard_error', 't', 'DF', 'ci_low', 'ci_high', 'p_raw', 'significant', 'direction'].map(key => ({ key }))
  const TREND_COLUMNS = ['performed', 'reason_code', 'reason_context', 'block_count', 'treatment_indices', 'direction', 'direction_source', 'statistic', 'p_exact', 'p_exact_opposite', 'exact_arrangements'].map(key => ({ key }))
  const DIAGNOSTICS_RESIDUAL_COLUMNS = ['performed', 'reason_code', 'reason_context', 'leverage', 'unstable', 'replicate_number', 'treatment_index', 'fitted', 'residual', 'standardized_residual'].map(key => ({ key }))
  const DIAGNOSTICS_INFLUENCE_COLUMNS = ['performed', 'reason_code', 'reason_context', 'omitted_replicate_number', 'influence_performed', 'treatment_index', 'difference', 'direction', 'direction_changed_from_full_sample'].map(key => ({ key }))
  const INTERPRETATION_COLUMNS = ['performed', 'reason_code', 'reason_context', 'conclusion_code', 'validity_criterion_met', 'validity_code', 'dunnett_any_positive_significant', 'page_trend_significant', 'alerts'].map(key => ({ key }))
  const STUDY_DESIGN_COLUMNS = ['study_design_version', 'status', 'assay_type', 'comparison_method', 'primary_reference_treatment_index', 'primary_reference_treatment', 'primary_treatment_indices', 'validation_reference_treatment_index', 'validation_treatment_index', 'alpha', 'alternative', 'confidence_level', 'include_primary_reference_as_zero', 'treatment_index', 'treatment', 'role', 'concentration', 'concentration_unit'].map(key => ({ key }))

  function buildPopulationCsv(analysis) {
    const population = analysis?.population
    if (!population || population.performed === false) {
      return serializeCsv(POPULATION_COLUMNS, [])
    }
    const validationExcluded = new Map((population.validation?.excludedBlocks || []).map(block => [block.replicateNumber, joinedReasons(block.reasons)]))
    const rows = []
    ;(population.blocks || []).forEach(block => {
      const primaryReasons = joinedReasons(block.primaryExclusionReasons)
      const flags = replicateAnalysisFlags(analysis, block.replicateNumber)
      ;(block.cells || []).forEach(cell => rows.push({
        replicate_number: block.replicateNumber,
        ...flags,
        primary_exclusion_reasons: primaryReasons,
        validation_exclusion_reasons: joinedReasons(block.validationExclusionReasons) || validationExcluded.get(block.replicateNumber) || '',
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

  function buildValidationCsv(analysis) {
    const result = analysis?.validation
    if (!result || result.performed === false) {
      return serializeCsv(VALIDATION_COLUMNS, [unavailableRow(result)])
    }
    const common = {
      performed: 'true',
      independent_experiment_count: result.independentExperimentCount,
      minimum_required_experiments: result.minimumRequiredExperiments,
      estimable: String(Boolean(result.estimable)),
      basal_control_present: String(Boolean(result.basalControlPresent)),
      positive_control_present: String(Boolean(result.positiveControlPresent)),
      viability_data_available: String(Boolean(result.viabilityDataAvailable)),
      score_out_of_range_count: result.scoreOutOfRangeCount,
      floor_ceiling_flagged: String(Boolean(result.floorCeilingFlag?.flagged)),
      floor_ceiling_ratio: result.floorCeilingFlag?.ratio ?? ''
    }
    const rows = (result.cellCompleteness || []).map(cell => ({
      ...common,
      replicate_number: cell.replicateNumber,
      treatment_index: cell.treatmentIndex,
      treatment: cell.treatment,
      expected_slides: cell.expectedSlides,
      valid_slides: cell.validSlides,
      absent_slides: cell.absentSlides,
      score_available: String(Boolean(cell.scoreAvailable))
    }))
    return serializeCsv(VALIDATION_COLUMNS, rows.length ? rows : [common])
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
      significant: String(Boolean(comparison.significant)),
      direction: comparison.direction
    }
  }

  function buildPrimaryComparisonsCsv(analysis) {
    const result = analysis?.primaryComparisons
    if (!result || result.performed === false) {
      return serializeCsv(COMPARISON_COLUMNS, [unavailableRow(result)])
    }
    return serializeCsv(COMPARISON_COLUMNS, (result.comparisons || []).map(comparison => ({
      performed: 'true', comparison_method: result.comparisonMethod, family: result.family, family_size: result.familySize,
      confidence_level: result.confidenceLevel, confidence_intervals: result.confidenceIntervals,
      dunnett_critical_value: result.dunnettCriticalValue ?? '', random_state_seed: result.randomStateSeed ?? '',
      ...comparisonRow(comparison),
      p_adjusted: comparison.pAdjusted,
      increase_detected: String(Boolean(comparison.increaseDetected))
    })))
  }

  function buildControlResponseCsv(analysis) {
    const result = analysis?.controlResponse
    if (!result || result.performed === false) {
      return serializeCsv(CONTROL_RESPONSE_COLUMNS, [unavailableRow(result)])
    }
    return serializeCsv(CONTROL_RESPONSE_COLUMNS, [{
      performed: 'true', purpose: result.purpose, block_numbers: (result.blockNumbers || []).join(';'),
      notes: (result.notes || []).map(note => note.code).join(';'),
      ...comparisonRow(result.comparison || {})
    }])
  }

  function buildTrendCsv(analysis) {
    const result = analysis?.trendAnalysis
    if (!result || result.performed === false) {
      return serializeCsv(TREND_COLUMNS, [unavailableRow(result)])
    }
    const page = result.pageTrend
    if (!page || page.performed === false) {
      return serializeCsv(TREND_COLUMNS, [unavailableRow(page || result)])
    }
    return serializeCsv(TREND_COLUMNS, [{
      performed: 'true', block_count: page.blockCount ?? '', treatment_indices: (page.treatmentIndices || []).join(';'),
      direction: page.direction ?? '', direction_source: page.directionSource ?? '', statistic: page.statistic ?? '',
      p_exact: page.pExact ?? '', p_exact_opposite: page.pExactOpposite ?? '', exact_arrangements: page.exactArrangements ?? ''
    }])
  }

  function buildDiagnosticsResidualsCsv(analysis) {
    const result = analysis?.diagnostics
    if (!result || result.performed === false) {
      return serializeCsv(DIAGNOSTICS_RESIDUAL_COLUMNS, [unavailableRow(result)])
    }
    const common = { performed: 'true', leverage: result.leverage, unstable: String(Boolean(result.unstable)) }
    return serializeCsv(DIAGNOSTICS_RESIDUAL_COLUMNS, (result.residuals || []).map(point => ({
      ...common, replicate_number: point.replicateNumber, treatment_index: point.treatmentIndex,
      fitted: point.fitted, residual: point.residual, standardized_residual: point.standardizedResidual
    })))
  }

  function buildDiagnosticsInfluenceCsv(analysis) {
    const result = analysis?.diagnostics
    if (!result || result.performed === false) {
      return serializeCsv(DIAGNOSTICS_INFLUENCE_COLUMNS, [unavailableRow(result)])
    }
    const rows = []
    ;(result.influence || []).forEach(entry => {
      const common = {
        performed: 'true', omitted_replicate_number: entry.omittedReplicateNumber,
        influence_performed: String(Boolean(entry.performed))
      }
      if (entry.performed) {
        (entry.comparisons || []).forEach(comparison => rows.push({
          ...common, treatment_index: comparison.treatmentIndex, difference: comparison.difference,
          direction: comparison.direction, direction_changed_from_full_sample: String(Boolean(comparison.directionChangedFromFullSample))
        }))
      } else {
        rows.push({ ...common, reason_code: entry.reason?.code || '', treatment_index: '', difference: '', direction: '', direction_changed_from_full_sample: '' })
      }
    })
    return serializeCsv(DIAGNOSTICS_INFLUENCE_COLUMNS, rows)
  }

  function buildInterpretationCsv(analysis) {
    const result = analysis?.interpretation
    if (!result || result.performed === false) {
      return serializeCsv(INTERPRETATION_COLUMNS, [unavailableRow(result)])
    }
    return serializeCsv(INTERPRETATION_COLUMNS, [{
      performed: 'true', conclusion_code: result.conclusionCode, validity_criterion_met: String(Boolean(result.validityCriterionMet)),
      validity_code: result.validityCode, dunnett_any_positive_significant: result.dunnettAnyPositiveSignificant === null ? '' : String(Boolean(result.dunnettAnyPositiveSignificant)),
      page_trend_significant: result.pageTrendSignificant === null ? '' : String(Boolean(result.pageTrendSignificant)),
      alerts: (result.alerts || []).map(alert => alert.code).join(';')
    }])
  }

  function buildStudyDesignCsv(experiment, analysis) {
    const design = experiment?.studyDesign || {}
    const protocol = analysis?.protocol?.performed === false ? {} : (analysis?.protocol || {})
    const validation = protocol.validationComparison || design.validationComparison || {}
    const referenceIndex = protocol.primaryReferenceTreatmentIndex ?? design.primaryReferenceTreatmentIndex
    const primaryIndices = protocol.primaryTreatmentIndices || design.primaryTreatmentIndices || []
    const common = {
      study_design_version: protocol.studyDesignVersion ?? design.version ?? '', status: design.status || '',
      assay_type: protocol.assayType ?? design.assayType ?? '', comparison_method: analysis?.comparisonMethod || '',
      primary_reference_treatment_index: referenceIndex ?? '',
      primary_reference_treatment: protocol.primaryReferenceTreatment || experiment?.treatments?.[referenceIndex] || '',
      primary_treatment_indices: primaryIndices.join(';'), validation_reference_treatment_index: validation.referenceTreatmentIndex ?? '',
      validation_treatment_index: validation.treatmentIndex ?? '', alpha: protocol.alpha ?? design.alpha ?? '',
      alternative: protocol.alternative ?? design.alternative ?? '',
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

  function reportLabels(pt) {
    return pt ? {
      researcher: 'Pesquisador', agent: 'Agente', cells: 'Tipo celular', target: 'Meta de nucleoides', slides: 'Lâminas por tratamento',
      exclusion: 'Lâminas contadas fora da meta usam o total efetivo e permanecem na análise; apenas ausentes ou sem contagem válida são excluídas.',
      conclusion: 'Síntese das evidências', validityCardTitle: 'Validade do ensaio', comparisonsCardTitle: 'Comparações contra a referência', trendCardTitle: 'Tendência relacionada à concentração',
      conclusionCode_increase_detected_with_ordered_trend: 'Evidência de {effect} acompanhada de resposta ordenada relacionada à concentração',
      conclusionCode_increase_detected_without_ordered_trend: 'Evidência de {effect} em concentração ou concentrações específicas, sem resposta ordenada relacionada à concentração',
      conclusionCode_ordered_trend_without_individual_increase: 'Resposta ordenada detectada, mas nenhuma concentração individual diferiu da referência após ajuste de multiplicidade',
      conclusionCode_no_increase_detected: 'Não foi detectada evidência de {effect} nas condições experimentais',
      conclusionCode_inconclusive_validity_not_met: 'Resultado inconclusivo devido ao não atendimento dos critérios de validade do ensaio',
      effectIncrease: 'aumento do dano ao DNA', effectReduction: 'redução do dano ao DNA',
      validityCode_expected_control_response_detected: 'O controle positivo respondeu na direção esperada, com significância estatística.',
      validityCode_expected_control_response_not_detected: 'O controle positivo não atingiu significância estatística na direção esperada; a incerteza sobre a resposta do sistema fica maior.',
      validityCode_control_response_unexpected_direction: 'O controle positivo respondeu de forma estatisticamente significativa na direção oposta à esperada.',
      validityCode_control_response_not_estimable: 'A resposta do controle positivo não pôde ser estimada com os dados disponíveis.',
      alert_viability_not_collected: 'Dados de viabilidade/citotoxicidade não são coletados por esta versão do aplicativo.',
      alert_elevated_uncertainty_minimum_blocks: 'A comparação do controle positivo usa o número mínimo de três experimentos independentes, com incerteza elevada.',
      alert_floor_ceiling_effect: 'Os scores da população principal se acumulam perto dos limites da escala (0 ou 100), o que pode comprimir diferenças observáveis.',
      alert_influence_instability: 'A direção de ao menos uma comparação muda quando um único experimento independente é removido; considere replicação independente.',
      alert_control_response_uncertainty: 'O controle positivo não atingiu significância estatística na direção esperada.',
      alert_assay_validity_criterion_not_met: 'O critério essencial de validade do ensaio não foi atendido.',
      alert_no_positive_control: 'Nenhum controle positivo foi configurado neste desenho de estudo.',
      decisionNotice: 'Este painel resume a balança de evidências com linguagem orientativa; não classifica automaticamente a substância como genotóxica ou não genotóxica, e ausência de significância não é apresentada como prova de ausência de efeito. A conclusão final cabe ao pesquisador, considerando citotoxicidade, controles históricos e o guia adotado. Os valores no HTML são arredondados apenas para leitura; JSON e CSV preservam a precisão integral.',
      dataIntegrity: 'Validade e integridade dos dados', independentExperimentCount: 'Experimentos independentes', minimumRequired: 'Mínimo exigido', estimable: 'Análise principal estimável', basalControlPresent: 'Controle negativo/veículo presente', positiveControlPresent: 'Controle positivo presente', viabilityData: 'Dados de viabilidade', scoreOutOfRange: 'Scores fora da faixa 0-100', floorCeiling: 'Efeito piso/teto sinalizado',
      visualOverview: 'Gráfico principal: experimentos independentes por tratamento', visualOverviewReading: 'Cada ponto é um experimento independente; pontos do mesmo experimento são conectados por uma linha fina para mostrar o bloqueio. O traço horizontal mostra a média fornecida pelo motor estatístico. Os controles são identificados por texto, não apenas por cor.',
      negativeControl: 'Controle negativo', positiveControl: 'Controle positivo', solventControl: 'Controle do solvente', testConcentration: 'Concentração teste', role: 'Papel', concentration: 'Concentração', independentExperiment: 'Experimento independente', independentExperiments: 'experimentos independentes', engineMean: 'Média do motor', visualScore: 'Score visual', chartData: 'Dados acessíveis do gráfico',
      columnChart: 'Médias da análise principal', columnChartReading: 'As colunas mostram a média dos experimentos independentes e as hastes mostram o desvio-padrão entre esses experimentos. Os asteriscos identificam somente comparações planejadas com p ajustado por Dunnett menor que 0,05.', columnMeaning: 'Coluna = média; haste = DP entre experimentos independentes', dunnettLegend: '* p ajustado por Dunnett < 0,05', biologicalN: 'n (experimentos independentes)', notEstimable: 'Não estimável',
      contents: 'Neste relatório', summary: 'Síntese', visualizations: 'Visualizações', analysisDetails: 'Evidências e detalhes', audit: 'Dados e auditoria',
      raw: 'Dados brutos', scores: 'Scores por repetição', replicate: 'Repetição', treatment: 'Tratamento', slide: 'Lâmina', completion: 'Completude', reason: 'Motivo', complete: 'Na meta', incomplete: 'Fora da meta', absent: 'Ausentes',
      protocol: 'Protocolo científico', population: 'População de análise', item: 'Item', value: 'Valor', availableBlocks: 'Repetições disponíveis', selectedBlocks: 'Repetições selecionadas', unselectedBlocks: 'Repetições não selecionadas', selectionReason: 'Justificativa da seleção', selectedAt: 'Seleção registrada em', primaryIncluded: 'Blocos primários incluídos', primaryExcluded: 'Blocos primários excluídos', validationIncluded: 'Blocos de validação incluídos',
      rcbd: 'ANOVA em blocos casualizados (apêndice técnico)', term: 'Termo', comparisons: 'Comparações primárias planejadas (Dunnett)', reference: 'Referência', difference: 'Diferença', ci: 'IC simultâneo 95%', rawP: 'p bruto', adjustedP: 'p ajustado (Dunnett)', decision: 'Resultado estatístico', direction: 'Direção', significant: 'SIGNIFICATIVO', notSignificant: 'NÃO SIGNIFICATIVO', increaseDetected: 'Aumento detectado', increaseNotDetected: 'Aumento não detectado', reductionDetected: 'Redução detectada', reductionNotDetected: 'Redução não detectada',
      control: 'Resposta do controle positivo (teste t pareado)', trend: 'Tendência de dose (Page L)', slope: 'Inclinação', blocks: 'Blocos', observations: 'Observações', notPerformed: 'Não realizado',
      charts: 'Gráficos técnicos', chartScores: 'Scores por bloco', chartDifferences: 'Diferenças com IC simultâneo 95%', chartClasses: 'Distribuição por classes',
      statistic: 'Estatística', exactP: 'p exato', exactPOpposite: 'p oposto', arrangements: 'Arranjos',
      dispersion: 'Dispersão por tratamento', mean: 'Média', sd: 'DP', cv: 'CV (%)', technicalDetails: 'Detalhamento técnico', simpleReading: 'Descrição', caution: 'Ponto de atenção', glossary: 'Glossário de bancada', generated: 'Gerado por',
      diagnostics: 'Diagnósticos e robustez', diagnosticsReading: 'Bloco técnico recolhido: resíduos, gráfico Q-Q, diferenças tratamento-referência por bloco e análise de influência por retirada de um experimento de cada vez. Não gera novos valores de p.', residualsTitle: 'Resíduos vs. valores ajustados', qqTitle: 'Gráfico Q-Q dos resíduos', treatmentControlDiffTitle: 'Diferenças tratamento-referência por bloco', influenceTitle: 'Análise de influência (retirada de um experimento)', omittedReplicate: 'Experimento retirado', fitted: 'Ajustado', residual: 'Resíduo', standardizedResidual: 'Resíduo padronizado', theoreticalQuantile: 'Quantil teórico', directionChanged: 'Direção mudou',
      methods: 'Métodos estatísticos', appendix: 'Apêndice técnico',
      editHistory: 'Histórico de correções das lâminas', editHistoryReading: 'As correções abaixo registram quem alterou cada lâmina, quando, por quê e os valores anteriores e posteriores.', editedAt: 'Editado em', editedBy: 'Responsável', before: 'Antes', after: 'Depois', blindCode: 'Código cego', experimentId: 'ID do experimento', experimentUpdatedAt: 'Experimento atualizado em', reportGeneratedAt: 'Relatório gerado em', appVersion: 'Versão do CometQuant', experimentSchema: 'Schema do experimento', analysisSchema: 'Schema da análise'
    } : {
      researcher: 'Researcher', agent: 'Agent', cells: 'Cell type', target: 'Nucleoid target', slides: 'Slides per treatment',
      exclusion: 'Counted slides outside the target use their effective total and remain in analysis; only absent slides or slides without a valid count are excluded.',
      conclusion: 'Evidence summary', validityCardTitle: 'Assay validity', comparisonsCardTitle: 'Comparisons against the reference', trendCardTitle: 'Concentration-related trend',
      conclusionCode_increase_detected_with_ordered_trend: 'Evidence of {effect} accompanied by an ordered concentration-related response',
      conclusionCode_increase_detected_without_ordered_trend: 'Evidence of {effect} at one or more specific concentrations, without an ordered concentration-related response',
      conclusionCode_ordered_trend_without_individual_increase: 'An ordered response was detected, but no individual concentration differed from the reference after multiplicity adjustment',
      conclusionCode_no_increase_detected: 'No evidence of {effect} was detected under the experimental conditions',
      conclusionCode_inconclusive_validity_not_met: 'Inconclusive result because the assay validity criteria were not met',
      effectIncrease: 'increased DNA damage', effectReduction: 'reduced DNA damage',
      validityCode_expected_control_response_detected: 'The positive control responded in the expected direction with statistical significance.',
      validityCode_expected_control_response_not_detected: 'The positive control did not reach statistical significance in the expected direction; uncertainty about the system response is elevated.',
      validityCode_control_response_unexpected_direction: 'The positive control responded with statistical significance in the direction opposite to expected.',
      validityCode_control_response_not_estimable: 'The positive control response could not be estimated with the available data.',
      alert_viability_not_collected: 'Viability/cytotoxicity data is not collected by this version of the application.',
      alert_elevated_uncertainty_minimum_blocks: 'The positive-control comparison uses the minimum of three independent experiments, carrying elevated uncertainty.',
      alert_floor_ceiling_effect: 'Primary-population scores accumulate near the scale limits (0 or 100), which may compress observable differences.',
      alert_influence_instability: 'The direction of at least one comparison changes when a single independent experiment is removed; consider independent replication.',
      alert_control_response_uncertainty: 'The positive control did not reach statistical significance in the expected direction.',
      alert_assay_validity_criterion_not_met: 'The essential assay validity criterion was not met.',
      alert_no_positive_control: 'No positive control was configured for this study design.',
      decisionNotice: 'This panel summarizes the balance of evidence in orientative language; it does not automatically classify the substance as genotoxic or non-genotoxic, and absence of significance is not presented as proof of absence of effect. The final conclusion belongs to the researcher, considering cytotoxicity, historical controls, and the adopted guideline. Values in the HTML are rounded for readability only; JSON and CSV retain full precision.',
      dataIntegrity: 'Validity and data integrity', independentExperimentCount: 'Independent experiments', minimumRequired: 'Minimum required', estimable: 'Primary analysis estimable', basalControlPresent: 'Negative/vehicle control present', positiveControlPresent: 'Positive control present', viabilityData: 'Viability data', scoreOutOfRange: 'Scores out of 0-100 range', floorCeiling: 'Floor/ceiling effect flagged',
      visualOverview: 'Main chart: independent experiments by treatment', visualOverviewReading: 'Each point is an independent experiment; points from the same experiment are connected by a thin line to show the blocking. The horizontal mark is the mean supplied by the statistical engine. Controls are identified by text, not color alone.',
      negativeControl: 'Negative control', positiveControl: 'Positive control', solventControl: 'Solvent control', testConcentration: 'Test concentration', role: 'Role', concentration: 'Concentration', independentExperiment: 'Independent experiment', independentExperiments: 'independent experiments', engineMean: 'Engine mean', visualScore: 'Visual score', chartData: 'Accessible chart data',
      columnChart: 'Primary analysis means', columnChartReading: 'Columns show the mean of independent experiments and error bars show the standard deviation among those experiments. Asterisks identify planned comparisons with a Dunnett-adjusted p-value below 0.05 only.', columnMeaning: 'Column = mean; error bar = SD among independent experiments', dunnettLegend: '* Dunnett-adjusted p < 0.05', biologicalN: 'n (independent experiments)', notEstimable: 'Not estimable',
      contents: 'In this report', summary: 'Summary', visualizations: 'Visualizations', analysisDetails: 'Evidence and details', audit: 'Data and audit',
      raw: 'Raw data', scores: 'Scores by replicate', replicate: 'Replicate', treatment: 'Treatment', slide: 'Slide', completion: 'Completion', reason: 'Reason', complete: 'On target', incomplete: 'Off target', absent: 'Absent',
      protocol: 'Scientific protocol', population: 'Analysis population', item: 'Item', value: 'Value', availableBlocks: 'Available replicates', selectedBlocks: 'Selected replicates', unselectedBlocks: 'Unselected replicates', selectionReason: 'Selection rationale', selectedAt: 'Selection recorded at', primaryIncluded: 'Included primary blocks', primaryExcluded: 'Excluded primary blocks', validationIncluded: 'Included validation blocks',
      rcbd: 'Randomized complete block ANOVA (technical appendix)', term: 'Term', comparisons: 'Planned primary comparisons (Dunnett)', reference: 'Reference', difference: 'Difference', ci: 'Simultaneous 95% CI', rawP: 'Raw p', adjustedP: 'Adjusted p (Dunnett)', decision: 'Statistical result', direction: 'Direction', significant: 'SIGNIFICANT', notSignificant: 'NOT SIGNIFICANT', increaseDetected: 'Increase detected', increaseNotDetected: 'Increase not detected', reductionDetected: 'Reduction detected', reductionNotDetected: 'Reduction not detected',
      control: 'Positive control response (paired t-test)', trend: 'Dose trend (Page L)', slope: 'Slope', blocks: 'Blocks', observations: 'Observations', notPerformed: 'Not performed',
      charts: 'Technical charts', chartScores: 'Scores by block', chartDifferences: 'Differences with simultaneous 95% CI', chartClasses: 'Class distribution',
      statistic: 'Statistic', exactP: 'Exact p', exactPOpposite: 'Opposite p', arrangements: 'Arrangements',
      dispersion: 'Per-treatment dispersion', mean: 'Mean', sd: 'SD', cv: 'CV (%)', technicalDetails: 'Technical detail', simpleReading: 'Description', caution: 'Point of attention', glossary: 'Bench glossary', generated: 'Generated by',
      diagnostics: 'Diagnostics and robustness', diagnosticsReading: 'Collapsed technical block: residuals, Q-Q plot, per-block treatment-vs-reference differences and leave-one-experiment-out influence analysis. It does not generate new p-values.', residualsTitle: 'Residuals vs. fitted values', qqTitle: 'Q-Q plot of residuals', treatmentControlDiffTitle: 'Treatment-vs-reference differences by block', influenceTitle: 'Influence analysis (leave-one-experiment-out)', omittedReplicate: 'Omitted experiment', fitted: 'Fitted', residual: 'Residual', standardizedResidual: 'Standardized residual', theoreticalQuantile: 'Theoretical quantile', directionChanged: 'Direction changed',
      methods: 'Statistical methods', appendix: 'Technical appendix',
      editHistory: 'Slide correction history', editHistoryReading: 'The corrections below record who changed each slide, when, why, and the values before and after.', editedAt: 'Edited at', editedBy: 'Responsible person', before: 'Before', after: 'After', blindCode: 'Blind code', experimentId: 'Experiment ID', experimentUpdatedAt: 'Experiment updated at', reportGeneratedAt: 'Report generated at', appVersion: 'CometQuant version', experimentSchema: 'Experiment schema', analysisSchema: 'Analysis schema'
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

  function localizedScientificValue(value, pt) {
    const values = pt ? {
      genotoxicity: 'genotoxicidade', antigenotoxicity: 'antigenotoxicidade', higher: 'maior', lower: 'menor', equal: 'igual',
      increasing: 'crescente', decreasing: 'decrescente', treatment: 'tratamento', block: 'experimento (bloco)', residual: 'resíduo',
      'two-sided': 'bilateral', holm: 'Holm', effective_counted_nucleoids: 'nucleoides efetivamente contados', true: 'sim', false: 'não'
    } : {
      genotoxicity: 'genotoxicity', antigenotoxicity: 'antigenotoxicity', higher: 'higher', lower: 'lower',
      increasing: 'increasing', decreasing: 'decreasing', treatment: 'treatment', block: 'experiment (block)', residual: 'residual',
      'two-sided': 'two-sided', holm: 'Holm', effective_counted_nucleoids: 'effectively counted nucleoids', true: 'yes', false: 'no'
    }
    const key = String(value)
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : value
  }

  function protocolLabel(key, pt) {
    const labels = pt ? {
      studyDesignVersion: 'Versão do desenho do estudo', assayType: 'Tipo de ensaio', primaryReferenceTreatment: 'Tratamento de referência principal',
      primaryTreatmentIndices: 'Índices dos tratamentos principais', validationComparison: 'Comparação de validação', alpha: 'Alfa', alternative: 'Alternativa',
      multiplicityAdjustment: 'Ajuste de multiplicidade', confidenceLevel: 'Nível de confiança', includePrimaryReferenceAsZero: 'Referência incluída como dose zero',
      visualScoreDenominator: 'Denominador do score visual', offTargetSlidesIncluded: 'Lâminas fora da meta incluídas'
    } : {
      studyDesignVersion: 'Study design version', assayType: 'Assay type', primaryReferenceTreatment: 'Primary reference treatment',
      primaryTreatmentIndices: 'Primary treatment indices', validationComparison: 'Validation comparison', alpha: 'Alpha', alternative: 'Alternative',
      multiplicityAdjustment: 'Multiplicity adjustment', confidenceLevel: 'Confidence level', includePrimaryReferenceAsZero: 'Primary reference included as dose zero',
      visualScoreDenominator: 'Visual score denominator', offTargetSlidesIncluded: 'Off-target slides included'
    }
    return labels[key] || key
  }

  function reportDateTime(value, pt) {
    const date = new Date(value)
    if (!value || Number.isNaN(date.getTime())) return '-'
    return `${new Intl.DateTimeFormat(pt ? 'pt-BR' : 'en-US', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(date)} UTC`
  }

  function reportSection(id, title, reading, content, labels, caution = '') {
    const warning = caution ? `<p class="caution"><strong>${escapeHtml(labels.caution)}:</strong> ${escapeHtml(caution)}</p>` : ''
    return `<section class="report-section" id="${escapeHtml(id)}"><h2>${escapeHtml(title)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(reading)}</p>${warning}<details><summary>${escapeHtml(labels.technicalDetails)}</summary><div class="details-body">${content}</div></details></section>`
  }

  function statusCard(title, result) {
    return `<article class="status-card status-${escapeHtml(result.tone)}"><div class="status-heading"><span class="status-icon" aria-hidden="true">${result.icon}</span><div><h3>${escapeHtml(title)}</h3><p class="status-label">${escapeHtml(result.status)}</p></div></div><p>${escapeHtml(result.reason)}</p></article>`
  }

  function buildInterpretation(analysis, labels, pt) {
    const notAssessable = pt ? 'Não avaliável' : 'Not assessable'
    const interpretation = analysis?.interpretation
    const validation = analysis?.validation
    const localizedAlert = code => labels[`alert_${code}`] || code

    if (!interpretation || interpretation.performed === false) {
      const reason = reasonText(interpretation?.reason || validation?.reason) || notAssessable
      const placeholder = { tone: 'attention', icon: '?', status: notAssessable, reason }
      return { conclusionText: reason, conclusionTone: 'attention', validity: placeholder, comparisons: placeholder, trend: placeholder, alerts: [] }
    }

    const validityToneByCode = {
      expected_control_response_detected: 'good',
      expected_control_response_not_detected: 'attention',
      control_response_unexpected_direction: 'bad',
      control_response_not_estimable: 'bad'
    }
    const control = analysis?.controlResponse
    const controlComparison = control?.performed ? control.comparison : null
    let validityReason = labels[`validityCode_${interpretation.validityCode}`] || notAssessable
    if (controlComparison) {
      const difference = `${Number(controlComparison.difference) >= 0 ? '+' : ''}${reportNumber(controlComparison.difference, pt)}`
      validityReason += ` ${controlComparison.treatment} vs. ${controlComparison.referenceTreatment}: ${difference} ${pt ? 'pontos' : 'points'}, ${reportP(controlComparison.pRaw, pt)}.`
    }
    const validity = {
      tone: validityToneByCode[interpretation.validityCode] || 'attention',
      icon: interpretation.validityCriterionMet ? '&#10003;' : '!',
      status: interpretation.validityCriterionMet ? (pt ? 'Critério atendido' : 'Criterion met') : (pt ? 'Critério não atendido' : 'Criterion not met'),
      reason: validityReason
    }

    const antigenotoxic = analysis?.protocol?.assayType === 'antigenotoxicity'
    const effect = antigenotoxic ? labels.effectReduction : labels.effectIncrease
    const comparisonsResult = analysis?.primaryComparisons
    const rows = comparisonsResult?.performed ? (comparisonsResult.comparisons || []) : []
    const detected = rows.filter(row => row.increaseDetected)
    const notDetected = rows.filter(row => !row.increaseDetected)
    const comparisonsCard = !rows.length
      ? { tone: 'attention', icon: '?', status: notAssessable, reason: reasonText(comparisonsResult?.reason) || notAssessable }
      : {
          tone: detected.length ? 'good' : 'neutral',
          icon: detected.length ? (antigenotoxic ? '&#8595;' : '&#8593;') : '&#8212;',
          status: detected.length
            ? (antigenotoxic ? labels.reductionDetected : labels.increaseDetected)
            : (antigenotoxic ? labels.reductionNotDetected : labels.increaseNotDetected),
          reason: pt
            ? `${detected.length} de ${rows.length} concentrações mostraram ${effect} detectado(a)${detected.length ? ` (${detected.map(row => row.treatment).join(', ')})` : ''}${notDetected.length ? `; sem efeito detectado: ${notDetected.map(row => row.treatment).join(', ')}` : ''}.`
            : `${detected.length} of ${rows.length} concentrations showed detected ${effect}${detected.length ? ` (${detected.map(row => row.treatment).join(', ')})` : ''}${notDetected.length ? `; no detected effect: ${notDetected.map(row => row.treatment).join(', ')}` : ''}.`
        }

    const page = analysis?.trendAnalysis?.performed ? analysis.trendAnalysis.pageTrend : null
    const trendCard = !page || page.performed === false
      ? { tone: 'attention', icon: '?', status: notAssessable, reason: reasonText(page?.reason || analysis?.trendAnalysis?.reason) || notAssessable }
      : {
          tone: interpretation.pageTrendSignificant ? 'good' : 'neutral',
          icon: interpretation.pageTrendSignificant ? '&#8599;' : '&#8212;',
          status: interpretation.pageTrendSignificant ? (pt ? 'Tendência ordenada detectada' : 'Ordered trend detected') : (pt ? 'Tendência não detectada' : 'Trend not detected'),
          reason: pt
            ? `Page L verifica a ordem ${page.direction === 'decreasing' ? 'decrescente' : 'crescente'} predefinida pelo tipo de ensaio; ${reportP(page.pExact, pt, 'p exato')}.`
            : `Page L checks the ${page.direction} order predefined by the assay type; ${reportP(page.pExact, pt, 'exact p')}.`
        }

    const alerts = (interpretation.alerts || []).map(alert => localizedAlert(alert.code))
    const conclusionTemplate = labels[`conclusionCode_${interpretation.conclusionCode}`] || interpretation.conclusionCode
    const conclusionText = conclusionTemplate.replace('{effect}', effect)
    const conclusionTone = !interpretation.validityCriterionMet ? 'bad' : comparisonsCard.tone
    return { conclusionText, conclusionTone, validity, comparisons: comparisonsCard, trend: trendCard, alerts }
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
    const plottedByReplicate = new Map()
    const marks = chartGroups.map((group, groupIndex) => {
      const x = left + xStep * (groupIndex + 0.5)
      const color = colors[groupIndex % colors.length]
      const pointMarks = group.points.map((point, pointIndex) => {
        const jitter = (pointIndex - (group.points.length - 1) / 2) * Math.min(14, 34 / Math.max(1, group.points.length - 1))
        const plottedX = x + jitter
        const plottedY = y(point.score)
        const list = plottedByReplicate.get(point.replicateNumber) || []
        list.push({ x: plottedX, y: plottedY, groupIndex })
        plottedByReplicate.set(point.replicateNumber, list)
        const title = `${labels.independentExperiment} ${point.replicateNumber}: ${reportNumber(point.score, pt)}`
        return `<circle class="data-point" cx="${plottedX}" cy="${plottedY}" r="7" fill="${color}" stroke="#ffffff" stroke-width="2"><title>${escapeHtml(title)}</title></circle>`
      }).join('')
      return `${pointMarks}<line x1="${x - 24}" y1="${y(group.mean)}" x2="${x + 24}" y2="${y(group.mean)}" stroke="#111827" stroke-width="5"><title>${escapeHtml(`${labels.engineMean}: ${reportNumber(group.mean, pt)}`)}</title></line><text x="${x}" y="${height - 66}" text-anchor="middle" class="chart-label">${escapeHtml(group.treatment)}</text><text x="${x}" y="${height - 42}" text-anchor="middle" class="chart-mean">${escapeHtml(`${labels.mean}: ${reportNumber(group.mean, pt)}`)}</text>`
    }).join('')
    // Connect points from the same independent experiment across treatments so the blocking
    // structure and its within-block consistency remain visible, not just the point cloud.
    const blockLines = Array.from(plottedByReplicate.entries()).map(([replicateNumber, points]) => {
      if (points.length < 2) return ''
      const ordered = points.slice().sort((a, b) => a.groupIndex - b.groupIndex)
      const path = ordered.map(point => `${point.x},${point.y}`).join(' ')
      const title = `${labels.independentExperiment} ${replicateNumber}`
      return `<polyline class="block-line" points="${path}" fill="none" stroke="#7c8aa0" stroke-width="1.5" stroke-opacity="0.55"><title>${escapeHtml(title)}</title></polyline>`
    }).join('')
    const accessibleRows = chartGroups.flatMap(group => {
      const role = group.role === 'negative-control' ? labels.negativeControl : group.role === 'positive-control' ? labels.positiveControl : group.role === 'solvent-control' ? labels.solventControl : labels.testConcentration
      const concentration = group.concentration !== null && group.concentration !== undefined && group.concentration !== '' && Number.isFinite(Number(group.concentration)) ? `${reportNumber(group.concentration, pt)} ${experiment.concUnit || ''}`.trim() : '-'
      return group.points.map(point => [group.treatment, role, concentration, point.replicateNumber, point.score, group.mean])
    })
    const accessibleTable = htmlTable([labels.treatment, labels.role, labels.concentration, labels.replicate, labels.visualScore, labels.engineMean], accessibleRows)
    return `<div class="dose-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dose-chart-title dose-chart-desc"><title id="dose-chart-title">${escapeHtml(labels.visualOverview)}</title><desc id="dose-chart-desc">${escapeHtml(labels.visualOverviewReading)}</desc><style>.chart-grid{stroke:#d7dee8;stroke-width:1}.chart-tick,.chart-label,.chart-role,.chart-mean,.chart-axis{font-family:Arial,sans-serif;fill:#27364a}.chart-tick{font-size:13px}.chart-label{font-size:13px;font-weight:700}.chart-role{font-size:11px}.chart-mean{font-size:11px;font-weight:700}.chart-axis{font-size:14px;font-weight:700}</style>${grid}<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#67768a"/><line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" stroke="#67768a"/><text x="18" y="${top + plotHeight / 2}" transform="rotate(-90 18 ${top + plotHeight / 2})" text-anchor="middle" class="chart-axis">${escapeHtml(labels.visualScore)}</text>${blockLines}${marks}<circle class="chart-legend-point" cx="${left}" cy="${height - 12}" r="6" fill="#0072B2"/><text x="${left + 12}" y="${height - 8}" class="chart-role">${escapeHtml(labels.independentExperiment)}</text><line x1="${left + 190}" y1="${height - 12}" x2="${left + 228}" y2="${height - 12}" stroke="#111827" stroke-width="5"/><text x="${left + 238}" y="${height - 8}" class="chart-role">${escapeHtml(labels.engineMean)}</text></svg><div class="sr-only"><h3>${escapeHtml(labels.chartData)}</h3>${accessibleTable}</div></div>`
  }

  function buildPrimaryColumnSvg(experiment, analysis, labels, pt) {
    const protocol = analysis?.protocol
    const descriptive = analysis?.descriptive
    const comparisons = analysis?.primaryComparisons
    if (!protocol || protocol.performed === false || !descriptive?.performed || !comparisons?.performed) return ''
    const referenceIndex = protocol.primaryReferenceTreatmentIndex
    const indices = Array.from(new Set([referenceIndex, ...(protocol.primaryTreatmentIndices || [])])).filter(Number.isInteger)
    const metadata = new Map((experiment.treatmentMetadata || []).map(item => [item.treatmentIndex, item]))
    const descriptiveByIndex = new Map((descriptive.treatments || []).map(item => [item.treatmentIndex, item]))
    const comparisonByIndex = new Map((comparisons.comparisons || []).map(item => [item.treatmentIndex, item]))
    const groups = indices.map(treatmentIndex => {
      const item = descriptiveByIndex.get(treatmentIndex)
      const comparison = comparisonByIndex.get(treatmentIndex)
      return item ? {
        treatmentIndex,
        treatment: item.treatment,
        mean: Number(item.mean),
        sd: Number(item.standardDeviation),
        n: Number(item.blockCount),
        concentration: metadata.get(treatmentIndex)?.concentration,
        comparison
      } : null
    }).filter(item => item && Number.isFinite(item.mean)).sort((a, b) => {
      if (a.treatmentIndex === referenceIndex) return -1
      if (b.treatmentIndex === referenceIndex) return 1
      return Number(a.concentration ?? Number.POSITIVE_INFINITY) - Number(b.concentration ?? Number.POSITIVE_INFINITY) || a.treatmentIndex - b.treatmentIndex
    })
    if (!groups.length) return ''

    const width = Math.max(900, groups.length * 170)
    const height = 520
    const left = 76
    const right = 28
    const top = 44
    const bottom = 138
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const lower = Math.min(0, ...groups.map(group => group.n > 1 && Number.isFinite(group.sd) ? group.mean - group.sd : group.mean))
    const upper = Math.max(100, ...groups.map(group => group.n > 1 && Number.isFinite(group.sd) ? group.mean + group.sd : group.mean))
    const padding = Math.max(5, (upper - lower) * 0.05)
    const domainMin = lower < 0 ? Math.floor((lower - padding) / 10) * 10 : 0
    const domainMax = upper > 100 ? Math.ceil((upper + padding) / 10) * 10 : 100
    const y = value => top + (domainMax - value) / (domainMax - domainMin) * plotHeight
    const baselineY = y(0)
    const xStep = plotWidth / groups.length
    const barWidth = Math.min(88, xStep * 0.5)
    const tickStep = (domainMax - domainMin) / 4
    const grid = Array.from({ length: 5 }, (_, index) => domainMin + tickStep * index).map(value => `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="column-grid"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end" class="column-tick">${escapeHtml(reportNumber(value, pt, 0))}</text>`).join('')
    const marks = groups.map((group, index) => {
      const x = left + xStep * (index + 0.5)
      const barTop = y(group.mean)
      const barHeight = Math.max(0, baselineY - barTop)
      const isReference = group.treatmentIndex === referenceIndex
      const significant = !isReference && Boolean(group.comparison?.significant)
      const hasSd = group.n > 1 && Number.isFinite(group.sd)
      const error = hasSd ? `<line class="error-bar" x1="${x}" y1="${y(group.mean - group.sd)}" x2="${x}" y2="${y(group.mean + group.sd)}"/><line class="error-bar" x1="${x - 10}" y1="${y(group.mean - group.sd)}" x2="${x + 10}" y2="${y(group.mean - group.sd)}"/><line class="error-bar" x1="${x - 10}" y1="${y(group.mean + group.sd)}" x2="${x + 10}" y2="${y(group.mean + group.sd)}"/>` : ''
      const markerY = y(group.mean + (hasSd ? group.sd : 0)) - 14
      const marker = significant ? `<text class="dunnett-marker" x="${x}" y="${markerY}" text-anchor="middle" aria-hidden="true">*</text>` : ''
      const pText = Number.isFinite(Number(group.comparison?.pAdjusted)) ? `${labels.adjustedP}: ${reportProbability(group.comparison.pAdjusted, pt)}` : ''
      const title = [group.treatment, `${labels.mean}: ${reportNumber(group.mean, pt)}`, `${labels.sd}: ${hasSd ? reportNumber(group.sd, pt) : labels.notEstimable}`, `${labels.biologicalN}: ${group.n}`, pText].filter(Boolean).join('; ')
      const treatmentLabel = isReference ? `${group.treatment} (${labels.reference})` : group.treatment
      return `<rect class="column-bar${isReference ? ' reference-bar' : ''}" x="${x - barWidth / 2}" y="${barTop}" width="${barWidth}" height="${barHeight}"><title>${escapeHtml(title)}</title></rect>${error}${marker}<text x="${x}" y="${height - 78}" text-anchor="middle" class="column-label">${escapeHtml(treatmentLabel)}</text><text x="${x}" y="${height - 56}" text-anchor="middle" class="column-value">${escapeHtml(`${labels.mean}: ${reportNumber(group.mean, pt)}`)}</text><text x="${x}" y="${height - 36}" text-anchor="middle" class="column-n">${escapeHtml(`n=${group.n}`)}</text>`
    }).join('')
    const rows = groups.map(group => {
      const isReference = group.treatmentIndex === referenceIndex
      const pAdjusted = !isReference && Number.isFinite(Number(group.comparison?.pAdjusted)) ? reportProbability(group.comparison.pAdjusted, pt) : '-'
      const decision = isReference ? labels.reference : (group.comparison?.significant ? labels.significant : labels.notSignificant)
      return [group.treatment, reportNumber(group.mean, pt), group.n > 1 && Number.isFinite(group.sd) ? reportNumber(group.sd, pt) : labels.notEstimable, group.n, pAdjusted, decision]
    })
    const table = htmlTable([labels.treatment, labels.mean, labels.sd, labels.biologicalN, labels.adjustedP, labels.decision], rows)
    const reference = groups.find(group => group.treatmentIndex === referenceIndex)?.treatment || protocol.primaryReferenceTreatment || '-'
    return `<div class="column-chart"><svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-labelledby="column-chart-title column-chart-desc"><title id="column-chart-title">${escapeHtml(labels.columnChart)}</title><desc id="column-chart-desc">${escapeHtml(`${labels.columnChartReading} ${labels.columnMeaning}. ${labels.reference}: ${reference}. ${labels.dunnettLegend}.`)}</desc><style>.column-grid{stroke:#d7dee8;stroke-width:1}.column-tick,.column-label,.column-value,.column-n,.column-axis{font-family:Arial,sans-serif;fill:#27364a}.column-tick{font-size:13px}.column-label{font-size:13px;font-weight:700}.column-value,.column-n{font-size:11px}.column-axis{font-size:14px;font-weight:700}.column-bar{fill:#4f8fba;stroke:#24587a;stroke-width:1}.reference-bar{fill:#8799aa}.error-bar{stroke:#17202a;stroke-width:2}.dunnett-marker{font-family:Arial,sans-serif;font-size:26px;font-weight:800;fill:#962f2f}</style>${grid}<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#67768a"/><line x1="${left}" y1="${baselineY}" x2="${width - right}" y2="${baselineY}" stroke="#67768a"/><text x="20" y="${top + plotHeight / 2}" transform="rotate(-90 20 ${top + plotHeight / 2})" text-anchor="middle" class="column-axis">${escapeHtml(labels.visualScore)}</text>${marks}<text x="${left}" y="${height - 10}" class="column-n">${escapeHtml(`${labels.reference}: ${reference}; ${labels.columnMeaning}; ${labels.dunnettLegend}`)}</text></svg><div class="sr-only"><h3>${escapeHtml(labels.chartData)}</h3>${table}</div></div>`
  }

  function reportGlossary(labels, pt) {
    const entries = pt ? [
      ['p-valor', 'Probabilidade de observar um resultado tão extremo quanto este se não houvesse diferença no modelo. Um p pequeno indica evidência, não o tamanho nem a importância biológica do efeito.'],
      ['Ajuste de Dunnett', 'Ajuste de multiplicidade para comparações planejadas de várias concentrações contra a mesma referência, com intervalo de confiança simultâneo coerente com o p ajustado.'],
      ['Intervalo de confiança simultâneo', 'Faixa de valores compatíveis com a diferença estimada, válida para todas as comparações em conjunto; intervalos largos indicam maior incerteza.'],
      ['Bloco / repetição', 'Um experimento independente, normalmente executado em outro dia. Lâminas do mesmo experimento são réplicas técnicas, não novos blocos.'],
      ['Page L', 'Teste exato de tendência ordenada; verifica se o dano aumenta (ou diminui) de forma consistente com a concentração, sem substituir as comparações de Dunnett.'],
      ['Análise de influência (leave-one-out)', 'Recalcula as comparações removendo um experimento independente de cada vez para mostrar se a direção e a magnitude do efeito permanecem estáveis; não gera novos valores de p.'],
      [labels.positiveControl, 'Tratamento conhecido por produzir dano e usado para confirmar que o sistema experimental respondeu.'],
      [labels.negativeControl, 'Condição basal usada como referência para o dano de fundo.'],
      ['CV', 'Variação entre experimentos em relação à média. O relatório mostra o valor, mas não inventa um limite universal de CV elevado.']
    ] : [
      ['p-value', 'Probability of observing a result this extreme if there were no difference in the model. A small p-value indicates evidence, not effect size or biological importance.'],
      ['Dunnett adjustment', 'Multiplicity adjustment for planned comparisons of several concentrations against the same reference, with a simultaneous confidence interval coherent with the adjusted p-value.'],
      ['Simultaneous confidence interval', 'Range of values compatible with the estimated difference, valid for all comparisons taken together; wider intervals mean more uncertainty.'],
      ['Block / replicate', 'One independent experiment, usually run on a different day. Slides from the same experiment are technical replicates, not new blocks.'],
      ['Page L', 'Exact ordered-trend test; checks whether damage increases (or decreases) consistently with concentration, without replacing the Dunnett comparisons.'],
      ['Leave-one-out influence analysis', 'Recomputes the comparisons while omitting one independent experiment at a time to show whether the effect direction and magnitude stay stable; it does not generate new p-values.'],
      [labels.positiveControl, 'A treatment known to cause damage, used to confirm that the experimental system responded.'],
      [labels.negativeControl, 'The basal condition used as the reference for background damage.'],
      ['CV', 'Variation among experiments relative to the mean. The report displays it but does not invent a universal high-CV cutoff.']
    ]
    return `${labels.slideEditHistoryHtml || ''}<section class="glossary"><h2>${escapeHtml(labels.glossary)}</h2><dl>${entries.map(([term, definition]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(definition)}</dd>`).join('')}</dl></section>`
  }

  function reportStyles() {
    return `:root{--ink:#17202a;--muted:#56657a;--line:#cbd5e1;--paper:#fff;--soft:#f4f7fb;--blue:#155b8f;--good:#176b43;--good-bg:#e7f4ec;--bad:#962f2f;--bad-bg:#fbeaea;--attention:#815600;--attention-bg:#fff4d6;--neutral:#315b7d;--neutral-bg:#e9f1f7}*{box-sizing:border-box}body{font-family:Arial,sans-serif;max-width:1120px;margin:auto;padding:32px;color:var(--ink);background:var(--paper);line-height:1.45}h1,h2{color:var(--blue)}h1{margin-bottom:6px}h2{margin-top:0}.subtitle{color:var(--muted);margin-top:0}.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.metadata p{margin:0}.warning,.caution{color:var(--attention);background:var(--attention-bg);border-left:5px solid var(--attention);padding:10px 12px}.conclusion-panel{margin:28px 0;padding:22px;border:2px solid #99adc1;border-radius:16px;background:#f8fbfe}.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.status-card{border:1px solid var(--line);border-top:6px solid;padding:15px;border-radius:10px;background:#fff}.status-card h3,.status-card p{margin:0}.status-card>p{margin-top:10px}.status-heading{display:flex;gap:10px;align-items:center}.status-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;font-weight:800;font-size:20px;background:#fff}.status-label{font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.04em}.status-good{border-top-color:var(--good);background:var(--good-bg)}.status-good .status-label,.status-good .status-icon{color:var(--good)}.status-bad{border-top-color:var(--bad);background:var(--bad-bg)}.status-bad .status-label,.status-bad .status-icon{color:var(--bad)}.status-attention{border-top-color:var(--attention);background:var(--attention-bg)}.status-attention .status-label,.status-attention .status-icon{color:var(--attention)}.status-neutral{border-top-color:var(--neutral);background:var(--neutral-bg)}.status-neutral .status-label,.status-neutral .status-icon{color:var(--neutral)}.decision-notice{font-weight:700;margin:18px 0 0;padding-top:16px;border-top:1px solid var(--line)}.conclusion-headline{font-size:20px;font-weight:800;margin:0 0 16px;padding:10px 14px;border-radius:8px}.conclusion-headline.status-good{color:var(--good);background:var(--good-bg)}.conclusion-headline.status-bad{color:var(--bad);background:var(--bad-bg)}.conclusion-headline.status-attention{color:var(--attention);background:var(--attention-bg)}.conclusion-headline.status-neutral{color:var(--neutral);background:var(--neutral-bg)}.alerts-list{margin:14px 0 0;padding-left:22px}.alerts-list li{margin-bottom:6px}.appendix-heading{margin:36px 0 0;padding-top:22px;border-top:3px double var(--line);color:var(--muted);font-size:1.3rem}.report-section,.glossary{margin:26px 0;padding-top:20px;border-top:2px solid #dce5ee}.simple-reading{font-size:17px;background:#eef5fb;padding:12px 14px;border-left:5px solid var(--blue)}.simple-reading span{font-weight:800}.dose-chart{border:1px solid var(--line);border-radius:12px;padding:8px;overflow:auto}.dose-chart svg{display:block;width:100%;min-width:720px;height:auto}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.table-scroll{overflow-x:auto;margin:12px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #aeb9c6;padding:7px;text-align:center}th{background:#e4edf6;color:#183b56}.row-significant td{background:#e7f4ec}.row-significant td:first-child{border-left:5px solid var(--good)}.row-not-significant td{background:#f4f6f8}.row-not-significant td:first-child{border-left:5px solid #758294}details{border:1px solid var(--line);border-radius:8px;background:#fff}summary{cursor:pointer;padding:12px 14px;font-weight:800;color:var(--blue);background:var(--soft)}.details-body{padding:8px 14px 14px}.details-body h3{margin-top:20px}.details-body>.simple-reading{font-size:14px}figure{margin:22px 0}img{max-width:100%;height:auto}figcaption{text-align:center;font-weight:700;color:var(--muted)}.glossary dl{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:8px 16px}.glossary dt{font-weight:800}.glossary dd{margin:0 0 8px}.technical-group{margin-top:16px}footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted)}@media(max-width:760px){body{padding:16px}.status-grid{grid-template-columns:1fr}.glossary dl{grid-template-columns:1fr}.glossary dd{margin-bottom:14px}}@media print{body{max-width:none;padding:0}.conclusion-panel,.status-card,.simple-reading,.warning,.caution{print-color-adjust:exact;-webkit-print-color-adjust:exact}details>.details-body{display:block}summary{display:none}.dose-chart{overflow:visible}}`
  }

  function buildReportHtmlBase(experiment, analysis, lang = 'en') {
    const pt = lang === 'pt'
    const labels = reportLabels(pt)
    const interpretation = buildInterpretation(analysis, labels, pt)
    const raw = buildRawRows(experiment)
    const aggregate = core.aggregateReplicateScores(experiment)
    const scoreRows = aggregate.map(row => [row.treatment, row.replicateNumber, row.completeSlides, row.incompleteSlides, row.absentSlides, row.score === null ? '-' : row.score.toFixed(2)])
    const rawRows = raw.map(row => [row.replicate_number, row.treatment, row.gel_number, row.status, row.completion || '-', row.absence_reason || row.incomplete_reason || '-', row.total_counted || '-', row.visual_score || '-'])
    const protocol = analysis?.protocol?.performed === false ? null : analysis?.protocol
    const population = analysis?.population?.performed === false ? null : analysis?.population
    const validation = analysis?.validation?.performed === false ? null : analysis?.validation
    const protocolRows = protocol ? [
      [protocolLabel('studyDesignVersion', pt), protocol.studyDesignVersion], [protocolLabel('assayType', pt), localizedScientificValue(protocol.assayType, pt)], [protocolLabel('primaryReferenceTreatment', pt), protocol.primaryReferenceTreatment],
      [protocolLabel('primaryTreatmentIndices', pt), (protocol.primaryTreatmentIndices || []).join(', ')], [protocolLabel('validationComparison', pt), protocol.validationComparison ? `${protocol.validationComparison.referenceTreatmentIndex} / ${protocol.validationComparison.treatmentIndex}` : '-'],
      [protocolLabel('alpha', pt), protocol.alpha], [protocolLabel('alternative', pt), localizedScientificValue(protocol.alternative, pt)], [pt ? 'Método de comparação' : 'Comparison method', localizedScientificValue(analysis?.comparisonMethod, pt)], [protocolLabel('confidenceLevel', pt), protocol.confidenceLevel],
      [protocolLabel('includePrimaryReferenceAsZero', pt), localizedScientificValue(protocol.includePrimaryReferenceAsZero, pt)], [protocolLabel('visualScoreDenominator', pt), localizedScientificValue(protocol.visualScoreDenominator, pt)], [protocolLabel('offTargetSlidesIncluded', pt), localizedScientificValue(protocol.offTargetSlidesIncluded, pt)]
    ] : [[labels.notPerformed, reasonText(analysis?.protocol?.reason)]]
    const selection = analysis?.selection?.performed ? analysis.selection : null
    const selectionRows = selection ? [
      [labels.availableBlocks, (selection.availableBlockNumbers || []).join(', ') || '-'],
      [labels.selectedBlocks, (selection.selectedBlockNumbers || []).join(', ') || '-'],
      [labels.unselectedBlocks, (selection.excludedBlockNumbers || []).join(', ') || '-'],
      [labels.selectionReason, selection.exclusionReason || '-'],
      [labels.selectedAt, selection.selectedAt || '-']
    ] : []
    const populationRows = population ? [
      ...selectionRows,
      [labels.primaryIncluded, (population.primary?.includedBlockNumbers || []).join(', ') || '-'],
      [labels.primaryExcluded, (population.primary?.excludedBlocks || []).map(block => `${block.replicateNumber}: ${joinedReasons(block.reasons)}`).join('; ') || '-'],
      [labels.validationIncluded, (population.validation?.includedBlockNumbers || []).join(', ') || '-']
    ] : [[labels.notPerformed, reasonText(analysis?.population?.reason)]]
    const validationRows = validation ? [
      [labels.independentExperimentCount, validation.independentExperimentCount], [labels.minimumRequired, validation.minimumRequiredExperiments],
      [labels.estimable, validation.estimable ? (pt ? 'Sim' : 'Yes') : (pt ? 'Não' : 'No')],
      [labels.basalControlPresent, validation.basalControlPresent ? (pt ? 'Sim' : 'Yes') : (pt ? 'Não' : 'No')],
      [labels.positiveControlPresent, validation.positiveControlPresent ? (pt ? 'Sim' : 'Yes') : (pt ? 'Não' : 'No')],
      [labels.viabilityData, validation.viabilityDataAvailable ? (pt ? 'Disponível' : 'Available') : (pt ? 'Não coletada' : 'Not collected')],
      [labels.scoreOutOfRange, validation.scoreOutOfRangeCount],
      [labels.floorCeiling, validation.floorCeilingFlag?.flagged ? (pt ? 'Sim' : 'Yes') : (pt ? 'Não' : 'No')]
    ] : [[labels.notPerformed, reasonText(analysis?.validation?.reason)]]
    const validationReading = validation
      ? (pt
          ? `${validation.independentExperimentCount} de ${validation.minimumRequiredExperiments} experimentos independentes mínimos; análise principal ${validation.estimable ? 'estimável' : 'não estimável'}.`
          : `${validation.independentExperimentCount} of ${validation.minimumRequiredExperiments} minimum independent experiments; primary analysis ${validation.estimable ? 'estimable' : 'not estimable'}.`)
      : (pt ? 'A validação do desenho não pôde ser calculada.' : 'Design validation could not be computed.')
    const anova = analysis?.blockAnova
    const alpha = Number(protocol?.alpha) || 0.05
    const anovaRows = anova?.performed ? (anova.terms || []).map(term => ({
      cells: [localizedScientificValue(term.term, pt), reportTechnicalNumber(term.SS, pt), term.DF, reportTechnicalNumber(term.MS, pt), reportTechnicalNumber(term.F, pt), reportProbability(term.p, pt)],
      className: Number.isFinite(Number(term.p)) ? (Number(term.p) < alpha ? 'row-significant' : 'row-not-significant') : ''
    })) : [[labels.notPerformed, reasonText(anova?.reason), '-', '-', '-', '-']]
    const comparisons = analysis?.primaryComparisons
    const reportAntigenotoxic = protocol?.assayType === 'antigenotoxicity'
    const comparisonRows = comparisons?.performed ? (comparisons.comparisons || []).map(row => ({
      cells: [row.referenceTreatment, row.treatment, reportNumber(row.difference, pt), `${reportNumber(row.ciLow, pt)} - ${reportNumber(row.ciHigh, pt)}`, reportProbability(row.pRaw, pt), reportProbability(row.pAdjusted, pt), row.increaseDetected ? (reportAntigenotoxic ? labels.reductionDetected : labels.increaseDetected) : (reportAntigenotoxic ? labels.reductionNotDetected : labels.increaseNotDetected), localizedScientificValue(row.direction, pt)],
      className: row.increaseDetected ? 'row-significant' : 'row-not-significant'
    })) : [[labels.notPerformed, reasonText(comparisons?.reason), '-', '-', '-', '-', '-', '-']]
    const control = analysis?.controlResponse
    const controlRows = control?.performed ? [{
      cells: [control.comparison.referenceTreatment, control.comparison.treatment, reportNumber(control.comparison.difference, pt), `${reportNumber(control.comparison.ciLow, pt)} - ${reportNumber(control.comparison.ciHigh, pt)}`, reportProbability(control.comparison.pRaw, pt), control.comparison.significant ? labels.significant : labels.notSignificant, localizedScientificValue(control.comparison.direction, pt)],
      className: control.comparison.significant ? 'row-significant' : 'row-not-significant'
    }] : [[labels.notPerformed, reasonText(control?.reason), '-', '-', '-', '-', '-']]
    const controlCaution = control?.performed ? (control.notes || []).map(note => note.detail).join(' ') : ''
    const trendAnalysis = analysis?.trendAnalysis
    const page = trendAnalysis?.performed ? trendAnalysis.pageTrend : null
    const trendRows = page?.performed ? [
      [labels.direction, localizedScientificValue(page.direction, pt)], [labels.statistic, reportTechnicalNumber(page.statistic, pt)],
      { cells: [labels.exactP, reportProbability(page.pExact, pt)], className: Number(page.pExact) < alpha ? 'row-significant' : 'row-not-significant' },
      [labels.exactPOpposite, reportProbability(page.pExactOpposite, pt)], [labels.arrangements, page.exactArrangements], [labels.blocks, page.blockCount]
    ] : [[labels.notPerformed, reasonText(page?.reason || trendAnalysis?.reason)]]
    const dispersion = analysis?.descriptive
    const dispersionRows = dispersion?.performed ? (dispersion.treatments || []).map(item => {
      const estimable = Number(item.blockCount) > 1
      return [item.treatment, reportNumber(item.mean, pt), estimable ? reportNumber(item.standardDeviation, pt) : labels.notEstimable, estimable ? reportNumber(item.coefficientOfVariation, pt) : labels.notEstimable, item.blockCount]
    }) : [[labels.notPerformed, '-', '-', '-', '-']]
    const heterogeneity = dispersion?.heterogeneityFlag
    const diagnostics = analysis?.diagnostics
    const diagnosticsResidualRows = diagnostics?.performed ? (diagnostics.residuals || []).map(point => [point.replicateNumber, point.treatmentIndex, reportTechnicalNumber(point.fitted, pt), reportTechnicalNumber(point.residual, pt), reportTechnicalNumber(point.standardizedResidual, pt)]) : [[labels.notPerformed, reasonText(diagnostics?.reason), '-', '-', '-']]
    const diagnosticsQqRows = diagnostics?.performed ? (diagnostics.qqPlot || []).map(point => [reportTechnicalNumber(point.theoreticalQuantile, pt), reportTechnicalNumber(point.standardizedResidual, pt)]) : [[labels.notPerformed, '-']]
    const diagnosticsDiffRows = diagnostics?.performed ? (diagnostics.treatmentControlDifferences || []).map(item => [item.replicateNumber, item.treatmentIndex, reportTechnicalNumber(item.difference, pt)]) : [[labels.notPerformed, '-', '-']]
    const diagnosticsInfluenceRows = diagnostics?.performed ? (diagnostics.influence || []).flatMap(entry => entry.performed
      ? entry.comparisons.map(comparison => ({
          cells: [entry.omittedReplicateNumber, comparison.treatmentIndex, reportTechnicalNumber(comparison.difference, pt), localizedScientificValue(comparison.direction, pt), comparison.directionChangedFromFullSample ? (pt ? 'Sim' : 'Yes') : (pt ? 'Não' : 'No')],
          className: comparison.directionChangedFromFullSample ? 'row-significant' : ''
        }))
      : [[entry.omittedReplicateNumber, labels.notPerformed, reasonText(entry.reason), '-', '-']]
    ) : [[labels.notPerformed, reasonText(diagnostics?.reason), '-', '-', '-']]
    const diagnosticsReading = diagnostics?.performed
      ? (pt
          ? `Ponto de alavancagem constante=${reportTechnicalNumber(diagnostics.leverage, pt)}. ${diagnostics.unstable ? 'A direção de ao menos uma comparação mudou ao remover um experimento.' : 'Nenhuma mudança de direção foi observada ao remover um experimento de cada vez.'}`
          : `Constant leverage point=${reportTechnicalNumber(diagnostics.leverage, pt)}. ${diagnostics.unstable ? 'The direction of at least one comparison changed when an experiment was removed.' : 'No direction change was observed when removing one experiment at a time.'}`)
      : (reasonText(diagnostics?.reason) || labels.notPerformed)
    const instabilityCaution = diagnostics?.performed && diagnostics.unstable ? labels.alert_influence_instability : ''
    const chartItems = [[analysis?.charts?.scores, labels.chartScores], [analysis?.charts?.differences, labels.chartDifferences], [analysis?.charts?.classes, labels.chartClasses]]
      .filter(([image]) => validPngBase64(image)).map(([image, alt]) => `<figure><img src="data:image/png;base64,${image}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`).join('')
    const doseChart = buildDoseResponseSvg(experiment, analysis, labels, pt)
    const treatmentTerm = anova?.performed ? (anova.terms || []).find(term => term.term === 'treatment') : null
    const anovaReading = treatmentTerm ? (pt ? `A ANOVA separa a variação entre tratamentos da variação entre experimentos; para tratamento, ${reportP(treatmentTerm.p, pt)}. Este teste global é apenas apêndice técnico e não condiciona as comparações planejadas.` : `ANOVA separates treatment variation from variation among experiments; treatment ${reportP(treatmentTerm.p, pt)}. This global test is technical-appendix only and does not gate the planned comparisons.`) : (pt ? 'A ANOVA em blocos não pôde ser estimada.' : 'The blocked ANOVA could not be estimated.')
    const populationReading = population ? (pt ? `${population.primary?.includedBlockCount ?? 0} experimento(s) independente(s) entraram na análise primária; exclusões e motivos permanecem abaixo.` : `${population.primary?.includedBlockCount ?? 0} independent experiment(s) entered the primary analysis; exclusions and reasons remain below.`) : (pt ? 'A população analítica não pôde ser definida.' : 'The analysis population could not be defined.')
    const protocolReading = protocol ? (pt ? `O desenho é de ${protocol.assayType === 'antigenotoxicity' ? 'antigenotoxicidade' : 'genotoxicidade'}, com alfa=${protocol.alpha}, teste bilateral e comparações ajustadas por ${localizedScientificValue(analysis?.comparisonMethod, pt)}.` : `The design is ${protocol.assayType}, with alpha=${protocol.alpha}, two-sided tests and comparisons adjusted by ${localizedScientificValue(analysis?.comparisonMethod, pt)}.`) : (pt ? 'O protocolo científico não estava disponível.' : 'The scientific protocol was unavailable.')
    const cvReading = dispersion?.performed ? (pt ? `CVs observados: ${(dispersion.treatments || []).map(item => `${item.treatment} ${Number(item.blockCount) > 1 ? `${reportNumber(item.coefficientOfVariation, pt)}%` : labels.notEstimable}`).join('; ')}. Nenhum limite universal de CV elevado foi aplicado; o CV não integra a síntese principal.` : `Observed CVs: ${(dispersion.treatments || []).map(item => `${item.treatment} ${Number(item.blockCount) > 1 ? `${reportNumber(item.coefficientOfVariation, pt)}%` : labels.notEstimable}`).join('; ')}. No universal high-CV cutoff was applied; CV is not part of the primary synthesis.`) : (pt ? 'A dispersão entre repetições não pôde ser estimada.' : 'Between-replicate dispersion could not be estimated.')
    const heterogeneityCaution = heterogeneity?.performed && heterogeneity.flagged ? (pt ? `O motor sinalizou variabilidade desigual entre tratamentos: razão entre o maior e o menor DP=${reportNumber(heterogeneity.ratio, pt)}.` : `The engine flagged unequal variability across treatments: largest-to-smallest SD ratio=${reportNumber(heterogeneity.ratio, pt)}.`) : ''
    const trendReading = page?.performed ? (pt ? `Page L verifica a ordem ${page.direction === 'decreasing' ? 'decrescente' : 'crescente'} predefinida pelo tipo de ensaio, sem substituir as comparações de Dunnett; ${reportP(page.pExact, pt, 'p exato')}.` : `Page L checks the ${page.direction} order predefined by the assay type, without replacing the Dunnett comparisons; ${reportP(page.pExact, pt, 'exact p')}.`) : (reasonText(page?.reason || trendAnalysis?.reason) || labels.notPerformed)
    const scoreReading = pt ? `${aggregate.length} célula(s) experimento x tratamento resumem as réplicas técnicas antes da inferência.` : `${aggregate.length} experiment-by-treatment cell(s) summarize technical replicates before inference.`
    const rawReading = pt ? `${raw.length} registro(s) de lâmina são preservados para auditoria; valores fora da meta não são convertidos em zero.` : `${raw.length} slide record(s) are preserved for audit; off-target values are not converted to zero.`
    const slideEditRows = buildSlideEditRows(experiment)
    if (slideEditRows.length) {
      const rows = slideEditRows.map(row => [
        row.replicate_number, row.blind_code, row.treatment, row.gel_number, row.edited_at, row.edited_by, row.reason,
        slideEditSnapshotText('before', row),
        slideEditSnapshotText('after', row)
      ])
      labels.slideEditHistoryHtml = reportSection('slide-edit-history', labels.editHistory, labels.editHistoryReading,
        htmlTable([labels.replicate, labels.blindCode, labels.treatment, labels.slide, labels.editedAt, labels.editedBy, labels.reason, labels.before, labels.after], rows), labels)
    }
    const alertsHtml = interpretation.alerts.length
      ? `<ul class="alerts-list">${interpretation.alerts.map(alert => `<li>${escapeHtml(alert)}</li>`).join('')}</ul>`
      : ''
    const methodsParagraph = protocol
      ? (pt
          ? `Os scores das lâminas técnicas foram promediados dentro de cada tratamento e experimento independente e analisados com um modelo linear com tratamento como fator categórico e experimento como fator de bloqueio. Comparações pré-especificadas entre cada concentração e a referência concorrente foram realizadas com contrastes ajustados por ${localizedScientificValue(analysis?.comparisonMethod, pt)}, com intervalos de confiança simultâneos de 95%. A resposta ordenada relacionada à concentração foi avaliada pelo teste exato de Page L. O controle positivo foi analisado separadamente por teste t pareado. Um valor de p<0,05 foi considerado estatisticamente significativo.`
          : `Scores from technical replicate slides were averaged within each treatment and independent experiment and analyzed using a linear model with treatment as a categorical factor and experiment as a blocking factor. Prespecified comparisons between each concentration and the concurrent reference were performed using ${localizedScientificValue(analysis?.comparisonMethod, pt)}-adjusted contrasts, with simultaneous 95% confidence intervals. An ordered concentration-related response was assessed using the exact Page L test. The positive control was analyzed separately using a paired t-test. A p-value < 0.05 was considered statistically significant.`)
      : (pt ? 'Os métodos não puderam ser determinados porque o protocolo científico não estava disponível.' : 'Methods could not be determined because the scientific protocol was unavailable.')
    return `<!DOCTYPE html><html lang="${pt ? 'pt-BR' : 'en'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CometQuant - ${escapeHtml(experiment.agent)}</title><style>${reportStyles()}</style></head><body><header><h1>CometQuant Lab</h1><p class="subtitle">${escapeHtml(pt ? 'Relatório de evidências do ensaio cometa' : 'Comet assay evidence report')}</p><div class="metadata"><p><strong>${escapeHtml(labels.researcher)}:</strong> ${escapeHtml(experiment.researcher || '-')}</p><p><strong>${escapeHtml(labels.agent)}:</strong> ${escapeHtml(experiment.agent)}</p><p><strong>${escapeHtml(labels.cells)}:</strong> ${escapeHtml(experiment.cells)}</p><p><strong>${escapeHtml(labels.target)}:</strong> ${escapeHtml(experiment.nucleoidsPerGel)}</p><p><strong>${escapeHtml(labels.slides)}:</strong> ${escapeHtml(experiment.slidesPerTreatment)}</p></div></header><main><section class="report-section" id="data-integrity"><h2>${escapeHtml(labels.dataIntegrity)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(validationReading)}</p>${htmlTable([labels.item, labels.value], validationRows)}</section><section class="conclusion-panel" aria-labelledby="conclusion-title"><h2 id="conclusion-title">${escapeHtml(labels.conclusion)}</h2><p class="conclusion-headline status-${escapeHtml(interpretation.conclusionTone)}">${escapeHtml(interpretation.conclusionText)}</p><div class="status-grid">${statusCard(labels.validityCardTitle, interpretation.validity)}${statusCard(labels.comparisonsCardTitle, interpretation.comparisons)}${statusCard(labels.trendCardTitle, interpretation.trend)}</div>${alertsHtml}<p class="decision-notice">${escapeHtml(labels.decisionNotice)}</p></section>${doseChart ? `<section class="report-section"><h2>${escapeHtml(labels.visualOverview)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(labels.visualOverviewReading)}</p>${doseChart}</section>` : ''}${reportSection('comparisons', labels.comparisons, interpretation.comparisons.reason, htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.adjustedP, labels.decision, labels.direction], comparisonRows), labels)}${reportSection('trend', labels.trend, trendReading, htmlTable([labels.item, labels.value], trendRows), labels)}${reportSection('control', labels.control, interpretation.validity.reason, htmlTable([labels.reference, labels.treatment, labels.difference, labels.ci, labels.rawP, labels.decision, labels.direction], controlRows), labels, controlCaution)}<section class="report-section" id="diagnostics"><h2>${escapeHtml(labels.diagnostics)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(labels.diagnosticsReading)}</p>${instabilityCaution ? `<p class="caution"><strong>${escapeHtml(labels.caution)}:</strong> ${escapeHtml(instabilityCaution)}</p>` : ''}<details><summary>${escapeHtml(labels.technicalDetails)}</summary><div class="details-body"><h3>${escapeHtml(labels.residualsTitle)}</h3><p class="simple-reading">${escapeHtml(diagnosticsReading)}</p>${htmlTable([labels.replicate, labels.treatment, labels.fitted, labels.residual, labels.standardizedResidual], diagnosticsResidualRows)}<h3>${escapeHtml(labels.qqTitle)}</h3>${htmlTable([labels.theoreticalQuantile, labels.standardizedResidual], diagnosticsQqRows)}<h3>${escapeHtml(labels.treatmentControlDiffTitle)}</h3>${htmlTable([labels.replicate, labels.treatment, labels.difference], diagnosticsDiffRows)}<h3>${escapeHtml(labels.influenceTitle)}</h3>${htmlTable([labels.omittedReplicate, labels.treatment, labels.difference, labels.direction, labels.directionChanged], diagnosticsInfluenceRows)}</div></details></section><section class="report-section" id="methods"><h2>${escapeHtml(labels.methods)}</h2><p>${escapeHtml(methodsParagraph)}</p></section><h2 class="appendix-heading">${escapeHtml(labels.appendix)}</h2>${reportSection('dispersion', labels.dispersion, cvReading, htmlTable([labels.treatment, labels.mean, labels.sd, labels.cv, labels.blocks], dispersionRows), labels, heterogeneityCaution)}${reportSection('anova', labels.rcbd, anovaReading, htmlTable([labels.term, 'SS', 'DF', 'MS', 'F', 'p'], anovaRows), labels)}${reportSection('population', labels.population, populationReading, htmlTable([labels.item, labels.value], populationRows), labels)}${reportSection('protocol', labels.protocol, protocolReading, htmlTable([labels.item, labels.value], protocolRows), labels)}${reportSection('charts', labels.charts, pt ? 'Os gráficos originais do motor permanecem disponíveis para inspeção técnica de blocos, intervalos e classes.' : "The engine's original charts remain available for technical inspection of blocks, intervals, and classes.", chartItems || `<p>${escapeHtml(labels.notPerformed)}</p>`, labels)}${reportSection('scores', labels.scores, scoreReading, htmlTable([labels.treatment, labels.replicate, labels.complete, labels.incomplete, labels.absent, 'Score'], scoreRows), labels)}${reportSection('raw', labels.raw, rawReading, `<p class="warning">${escapeHtml(labels.exclusion)}</p>${htmlTable([labels.replicate, labels.treatment, labels.slide, 'Status', labels.completion, labels.reason, 'Total', 'Score'], rawRows)}`, labels)}${reportGlossary(labels, pt)}</main><footer><p>${escapeHtml(labels.generated)} CometQuant Lab - schema ${escapeHtml(experiment.schemaVersion)} / analysis ${escapeHtml(analysis?.analysisSchemaVersion || '-')}</p></footer></body></html>`
  }

  function buildReportNavigation(html, labels) {
    const entries = [
      ['data-integrity', labels.dataIntegrity], ['evidence-summary', labels.summary], ['dose-overview', labels.visualOverview], ['primary-means', labels.columnChart],
      ['comparisons', labels.comparisons], ['trend', labels.trend], ['control', labels.control], ['diagnostics', labels.diagnostics], ['methods', labels.methods],
      ['dispersion', labels.dispersion], ['anova', labels.rcbd], ['population', labels.population], ['protocol', labels.protocol],
      ['charts', labels.charts], ['scores', labels.scores], ['raw', labels.raw],
      ['slide-edit-history', labels.editHistory], ['glossary', labels.glossary]
    ].filter(([id]) => html.includes(`id="${id}"`))
    return `<nav class="report-index" aria-label="${escapeHtml(labels.contents)}"><h2>${escapeHtml(labels.contents)}</h2><ul>${entries.map(([id, title]) => `<li><a href="#${id}">${escapeHtml(title)}</a></li>`).join('')}</ul></nav>`
  }

  function buildTraceabilityFooter(experiment, analysis, labels, pt, context) {
    const generatedAt = context.generatedAt || new Date().toISOString()
    const updatedAt = experiment.updatedAt || experiment.createdAt
    const version = context.appVersion || APP_VERSION
    const item = (label, value) => `<p><strong>${escapeHtml(label)}:</strong> ${value}</p>`
    return `<footer class="report-footer">${item(labels.experimentId, escapeHtml(experiment.id || '-'))}${item(labels.experimentUpdatedAt, updatedAt ? `<time datetime="${escapeHtml(updatedAt)}">${escapeHtml(reportDateTime(updatedAt, pt))}</time>` : '-')}${item(labels.reportGeneratedAt, `<time datetime="${escapeHtml(generatedAt)}">${escapeHtml(reportDateTime(generatedAt, pt))}</time>`)}${item(labels.appVersion, escapeHtml(version))}${item(labels.experimentSchema, escapeHtml(experiment.schemaVersion ?? '-'))}${item(labels.analysisSchema, escapeHtml(analysis?.analysisSchemaVersion ?? '-'))}</footer>`
  }

  function buildReportHtml(experiment, analysis, lang = 'en', context = {}) {
    const pt = lang === 'pt'
    const labels = reportLabels(pt)
    let html = buildReportHtmlBase(experiment, analysis, lang)
    html = html.replace('<section class="conclusion-panel" aria-labelledby="conclusion-title">', '<section class="conclusion-panel" id="evidence-summary" aria-labelledby="conclusion-title">')
    html = html.replace(`<section class="report-section"><h2>${escapeHtml(labels.visualOverview)}</h2>`, `<section class="report-section" id="dose-overview"><h2>${escapeHtml(labels.visualOverview)}</h2>`)
    html = html.replace('<section class="glossary">', '<section class="glossary" id="glossary">')

    const columnChart = buildPrimaryColumnSvg(experiment, analysis, labels, pt)
    if (columnChart) {
      const section = `<section class="report-section" id="primary-means"><h2>${escapeHtml(labels.columnChart)}</h2><p class="simple-reading"><span>${escapeHtml(labels.simpleReading)}:</span> ${escapeHtml(labels.columnChartReading)}</p>${columnChart}</section>`
      html = html.replace('<section class="report-section" id="comparisons">', `${section}<section class="report-section" id="comparisons">`)
    }

    const navigation = buildReportNavigation(html, labels)
    html = html.replace('</header><main>', `</header>${navigation}<main>`)
    html = html.replace(/<footer>.*?<\/footer>/, buildTraceabilityFooter(experiment, analysis, labels, pt, context))
    const additionalStyles = '.report-index{margin:24px 0;padding:18px 20px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.report-index h2{font-size:1.2rem}.report-index ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px 20px;margin:0;padding-left:20px}.report-index a{color:var(--blue);text-underline-offset:3px}.report-index a:focus-visible{outline:3px solid var(--attention);outline-offset:3px}.column-chart{overflow-x:auto}.column-chart svg{display:block;width:100%;min-width:720px;height:auto}.report-footer{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 20px;margin-top:32px;padding:20px;border-top:2px solid var(--line);color:var(--muted);font-size:.9rem}.report-footer p{margin:0}@media print{.report-index{break-after:page}.report-index a{color:inherit;text-decoration:none}}'
    html = html.replace('</style></head>', `${additionalStyles}</style></head>`)
    return html
  }

  function safeFilename(value) {
    return String(value || 'Experiment').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Experiment'
  }

  function buildShareFile(content, name, mimeType) {
    return new File([content], name, { type: mimeType })
  }

  function buildShareTextFile(data, name) {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    return new File([text], name, { type: 'text/plain' })
  }

  function canShareFiles(files) {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    try {
      return Boolean(navigator.canShare({ files }))
    } catch (error) {
      return false
    }
  }

  async function shareFiles(files, options = {}) {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return { status: 'unavailable' }
    try {
      await navigator.share({ files, title: options.title, text: options.text })
      return { status: 'shared' }
    } catch (error) {
      if (error && error.name === 'AbortError') return { status: 'cancelled' }
      if (error && error.name === 'NotAllowedError') return { status: 'denied' }
      return { status: 'failed', error }
    }
  }

  return {
    escapeHtml, escapeCsv, serializeCsv, buildRawRows, buildRawCsv, buildAggregateCsv, buildSlideEditRows, buildSlideEditCsv,
    buildPopulationCsv, buildValidationCsv, buildBlockAnovaCsv, buildPrimaryComparisonsCsv, buildControlResponseCsv,
    buildTrendCsv, buildDiagnosticsResidualsCsv, buildDiagnosticsInfluenceCsv, buildInterpretationCsv, buildStudyDesignCsv,
    buildShareFile, buildShareTextFile, canShareFiles, shareFiles,
    APP_VERSION, buildReportHtml, validPngBase64, safeFilename
  }
})
