(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const SCHEMA_VERSION = 4
  const MAX_FILE_SIZE = 5 * 1024 * 1024
  const LIMITS = { nucleoids: 10000, slides: 100, concentrations: 100, text: 120, detail: 500 }
  const LEGACY_BLIND_CODE_PATTERN = /^([A-Z2-9]{4})-(0[1-9]|[1-9]\d|100)$/
  const COMPACT_BLIND_CODE_PATTERN = /^([A-Z]{2})([1-9]|[1-9]\d|100)$/
  const ASSIGNMENT_STATUSES = new Set(['pending', 'counting', 'counted', 'absent'])
  const ABSENCE_REASONS = new Set(['broken', 'lost', 'quality', 'insufficient', 'other', 'legacy-unjustified'])
  const INCOMPLETE_REASONS = new Set(['insufficient-cells', 'poor-quality', 'damaged', 'technical-error', 'time-limit', 'other', 'legacy-unjustified'])

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function cleanText(value, max = LIMITS.text) {
    if (typeof value !== 'string') return ''
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
  }

  function validIsoDate(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
  }

  function parseBlindCode(value) {
    if (typeof value !== 'string') return null
    const compact = COMPACT_BLIND_CODE_PATTERN.exec(value)
    if (compact) return { format: 'compact', base: compact[1], gelNumber: Number(compact[2]) }
    const legacy = LEGACY_BLIND_CODE_PATTERN.exec(value)
    if (legacy) return { format: 'legacy', base: legacy[1], gelNumber: Number(legacy[2]) }
    return null
  }

  function availableBlindCodeBases(experiment) {
    const usedBases = new Set()
    ;(experiment?.replicates || []).forEach(replicate => {
      ;(replicate.assignments || []).forEach(assignment => {
        const parsed = parseBlindCode(assignment.blindCode)
        if (parsed?.format === 'compact') usedBases.add(parsed.base)
      })
    })
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const bases = []
    for (const first of alphabet) {
      for (const second of alphabet) {
        const base = `${first}${second}`
        if (!usedBases.has(base)) bases.push(base)
      }
    }
    return bases
  }

  function calculateVisualScore(gel, target) {
    if (!isObject(gel) || !Number.isInteger(target) || target < 1) return null
    const values = [gel.class0, gel.class1, gel.class2, gel.class3, gel.class4]
    if (!values.every(value => Number.isInteger(value) && value >= 0)) return null
    return ((0.25 * values[1] + 0.5 * values[2] + 0.75 * values[3] + values[4]) / target) * 100
  }

  function isIncludedGel(gel, target) {
    return gel && gel.status === 'counted' && gel.completion === 'complete' && gel.total === target
  }

  function reasonObject(value, fallbackCode) {
    if (isObject(value)) return { code: cleanText(value.code, 40), detail: cleanText(value.detail || '', LIMITS.detail) }
    if (typeof value === 'string' && value.trim()) return { code: cleanText(value, 40), detail: '' }
    return { code: fallbackCode, detail: '' }
  }

  function legacyBlindCode(treatmentIndex, gelNumber) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let value = treatmentIndex
    let base = ''
    for (let index = 0; index < 4; index++) {
      base = alphabet[value % alphabet.length] + base
      value = Math.floor(value / alphabet.length)
    }
    return `${base}-${String(gelNumber).padStart(2, '0')}`
  }

  function migrateExperiment(raw) {
    if (!isObject(raw)) throw new Error('invalid-root')
    const version = raw.schemaVersion === undefined ? 1 : Number(raw.schemaVersion)
    if (!Number.isInteger(version) || version < 1) throw new Error('invalid-schema-version')
    if (version > SCHEMA_VERSION) throw new Error('future-schema-version')

    const experiment = clone(raw)
    if (version < 3) {
      const missingRequiredFields = ['agent', 'cells'].filter(field => !cleanText(experiment[field]))
      experiment.migration = {
        ...(isObject(experiment.migration) ? experiment.migration : {}),
        sourceSchemaVersion: version,
        missingRequiredFields
      }
    }
    // Schema v4 adds compact blind codes while preserving every legacy code verbatim.
    experiment.schemaVersion = SCHEMA_VERSION
    experiment.slidesPerTreatment = Number.isInteger(Number(experiment.slidesPerTreatment))
      ? Number(experiment.slidesPerTreatment) : 1
    experiment.replicates = Array.isArray(experiment.replicates) ? experiment.replicates : []
    experiment.progress = isObject(experiment.progress) ? experiment.progress : null
    experiment.createdAt = validIsoDate(experiment.createdAt)
      ? experiment.createdAt : `${experiment.replicates[0]?.date || '1970-01-01'}T00:00:00.000Z`
    experiment.updatedAt = validIsoDate(experiment.updatedAt) ? experiment.updatedAt : experiment.createdAt

    experiment.replicates.forEach(replicate => {
      replicate.gels = Array.isArray(replicate.gels) ? replicate.gels : []
      if (replicate.assignments !== undefined && !Array.isArray(replicate.assignments)) replicate.assignments = []
      replicate.createdAt = validIsoDate(replicate.createdAt)
        ? replicate.createdAt : `${replicate.date || '1970-01-01'}T00:00:00.000Z`
      replicate.updatedAt = validIsoDate(replicate.updatedAt) ? replicate.updatedAt : replicate.createdAt
      replicate.gels.forEach(gel => {
        gel.status = gel.status || 'counted'
        gel.completion = gel.total === experiment.nucleoidsPerGel ? 'complete' : 'incomplete'
        if (gel.completion === 'incomplete') {
          gel.incompleteReason = reasonObject(gel.incompleteReason, 'legacy-unjustified')
        } else {
          delete gel.incompleteReason
        }
      })
      if (version < 3 && !Array.isArray(replicate.assignments) && Array.isArray(experiment.treatments) && experiment.slidesPerTreatment >= 1 && experiment.slidesPerTreatment <= LIMITS.slides) {
        const nextGelNumber = new Map()
        replicate.gels.forEach(gel => {
          const treatmentIndex = Number.isInteger(gel.treatmentIndex)
            ? gel.treatmentIndex
            : experiment.treatments.indexOf(gel.treatment)
          if (treatmentIndex < 0 || treatmentIndex >= experiment.treatments.length) return
          const next = (nextGelNumber.get(treatmentIndex) || 0) + 1
          if (!Number.isInteger(gel.gelNumber) || gel.gelNumber < 1) gel.gelNumber = next
          nextGelNumber.set(treatmentIndex, Math.max(next, gel.gelNumber))
          gel.treatmentIndex = treatmentIndex
          gel.treatment = experiment.treatments[treatmentIndex]
          gel.blindCode = legacyBlindCode(treatmentIndex, gel.gelNumber)
        })
        replicate.assignments = []
        experiment.treatments.forEach((treatment, treatmentIndex) => {
          for (let gelNumber = 1; gelNumber <= experiment.slidesPerTreatment; gelNumber++) {
            const blindCode = legacyBlindCode(treatmentIndex, gelNumber)
            const gel = replicate.gels.find(item => item.treatmentIndex === treatmentIndex && item.gelNumber === gelNumber)
            replicate.assignments.push(gel
              ? { blindCode, treatmentIndex, gelNumber, status: 'counted', ...(gel.recordedAt ? { recordedAt: gel.recordedAt } : {}) }
              : { blindCode, treatmentIndex, gelNumber, status: 'pending' })
          }
        })
      }
      ;(replicate.assignments || []).forEach(assignment => {
        if (assignment.status === 'absent') {
          assignment.absenceReason = reasonObject(assignment.absenceReason, 'legacy-unjustified')
        }
      })
    })
    experiment.status = hasPendingSlides(experiment) ? 'in-progress' : 'completed'
    return experiment
  }

  function validateReason(reason, allowed, allowLegacy) {
    if (!isObject(reason) || !allowed.has(reason.code)) return false
    if (!allowLegacy && reason.code === 'legacy-unjustified') return false
    return reason.code !== 'other' || cleanText(reason.detail, LIMITS.detail).length > 0
  }

  function validateExperiment(raw, options = {}) {
    const errors = []
    const sourceVersion = raw && raw.schemaVersion === undefined ? 1 : Number(raw?.schemaVersion)
    const requiresAssignmentMapping = sourceVersion >= 3
    let experiment
    try {
      experiment = migrateExperiment(raw)
    } catch (error) {
      return { valid: false, errors: [error.message], experiment: null }
    }
    const imported = options.source === 'import'
    const push = (condition, code) => { if (!condition) errors.push(code) }
    const legacyMissingFields = isObject(experiment.migration) && Number(experiment.migration.sourceSchemaVersion) < 3 && Array.isArray(experiment.migration.missingRequiredFields)
      ? new Set(experiment.migration.missingRequiredFields)
      : new Set()

    push(typeof experiment.id === 'string' && experiment.id.length > 0 && experiment.id.length <= 200, 'invalid-id')
    push(cleanText(experiment.agent).length > 0 || legacyMissingFields.has('agent'), 'agent-required')
    push(cleanText(experiment.cells).length > 0 || legacyMissingFields.has('cells'), 'cells-required')
    push(validIsoDate(experiment.createdAt) && validIsoDate(experiment.updatedAt), 'invalid-dates')
    push(Number.isInteger(experiment.nucleoidsPerGel) && experiment.nucleoidsPerGel >= 1 && experiment.nucleoidsPerGel <= LIMITS.nucleoids, 'invalid-nucleoids')
    push(Number.isInteger(experiment.slidesPerTreatment) && experiment.slidesPerTreatment >= 1 && experiment.slidesPerTreatment <= LIMITS.slides, 'invalid-slides')
    push(Array.isArray(experiment.treatments) && experiment.treatments.length > 0 && experiment.treatments.length <= 103, 'invalid-treatments')
    const treatments = Array.isArray(experiment.treatments) ? experiment.treatments : []
    const normalizedTreatments = treatments.map(value => cleanText(value).toLocaleLowerCase())
    push(treatments.every(value => typeof value === 'string' && cleanText(value).length > 0), 'invalid-treatment-name')
    push(new Set(normalizedTreatments).size === normalizedTreatments.length, 'duplicate-treatment')
    push(Array.isArray(experiment.replicates) && experiment.replicates.length <= 1000, 'invalid-replicates')

    const replicateNumbers = new Set()
    const compactBaseOwners = new Map()
    const compactOwnerBases = new Map()
    experiment.replicates.forEach((replicate, repIndex) => {
      const prefix = `replicate-${repIndex + 1}`
      push(isObject(replicate), `${prefix}-invalid`)
      if (!isObject(replicate)) return
      push(Number.isInteger(replicate.replicateNumber) && replicate.replicateNumber > 0, `${prefix}-number`)
      push(!replicateNumbers.has(replicate.replicateNumber), `${prefix}-duplicate`)
      replicateNumbers.add(replicate.replicateNumber)
      push(Array.isArray(replicate.gels), `${prefix}-gels`)
      const assignments = Array.isArray(replicate.assignments) ? replicate.assignments : null
      push(Boolean(assignments) || !requiresAssignmentMapping, `${prefix}-assignments`)
      const codes = new Set()
      const assignmentKeys = new Set()
      if (assignments) {
        push(assignments.length === treatments.length * experiment.slidesPerTreatment, `${prefix}-assignment-count`)
        assignments.forEach((assignment, assignmentIndex) => {
          const item = `${prefix}-assignment-${assignmentIndex + 1}`
          push(isObject(assignment), `${item}-invalid`)
          if (!isObject(assignment)) return
          const parsedCode = parseBlindCode(assignment.blindCode)
          push(Boolean(parsedCode), `${item}-code`)
          push(!codes.has(assignment.blindCode), `${item}-duplicate-code`)
          codes.add(assignment.blindCode)
          push(Number.isInteger(assignment.treatmentIndex) && assignment.treatmentIndex >= 0 && assignment.treatmentIndex < treatments.length, `${item}-treatment`)
          push(Number.isInteger(assignment.gelNumber) && assignment.gelNumber >= 1 && assignment.gelNumber <= experiment.slidesPerTreatment, `${item}-gel`)
          if (parsedCode?.format === 'compact') {
            const owner = `${repIndex}:${assignment.treatmentIndex}`
            push(parsedCode.gelNumber === assignment.gelNumber, `${item}-code-gel`)
            push(!compactBaseOwners.has(parsedCode.base) || compactBaseOwners.get(parsedCode.base) === owner, `${item}-duplicate-code-base`)
            push(!compactOwnerBases.has(owner) || compactOwnerBases.get(owner) === parsedCode.base, `${item}-treatment-code-base`)
            if (!compactBaseOwners.has(parsedCode.base)) compactBaseOwners.set(parsedCode.base, owner)
            if (!compactOwnerBases.has(owner)) compactOwnerBases.set(owner, parsedCode.base)
          }
          const assignmentKey = `${assignment.treatmentIndex}:${assignment.gelNumber}`
          push(!assignmentKeys.has(assignmentKey), `${item}-duplicate-laminate`)
          assignmentKeys.add(assignmentKey)
          push(ASSIGNMENT_STATUSES.has(assignment.status), `${item}-status`)
          if (assignment.status === 'absent') push(validateReason(assignment.absenceReason, ABSENCE_REASONS, true), `${item}-absence-reason`)
        })
      }
      const gelKeys = new Set()
      const gelCodes = new Set()
      ;(replicate.gels || []).forEach((gel, gelIndex) => {
        const item = `${prefix}-gel-${gelIndex + 1}`
        push(isObject(gel), `${item}-invalid`)
        if (!isObject(gel)) return
        const counts = [gel.class0, gel.class1, gel.class2, gel.class3, gel.class4]
        push(counts.every(value => Number.isInteger(value) && value >= 0), `${item}-counts`)
        const sum = counts.reduce((total, value) => total + (Number.isInteger(value) ? value : 0), 0)
        push(Number.isInteger(gel.total) && gel.total === sum && gel.total <= experiment.nucleoidsPerGel, `${item}-total`)
        push(gel.status === 'counted', `${item}-status`)
        push(gel.completion === (gel.total === experiment.nucleoidsPerGel ? 'complete' : 'incomplete'), `${item}-completion`)
        if (gel.completion === 'incomplete') push(validateReason(gel.incompleteReason, INCOMPLETE_REASONS, true), `${item}-incomplete-reason`)
        if (assignments) {
          const parsedCode = parseBlindCode(gel.blindCode)
          push(Boolean(parsedCode), `${item}-code`)
          push(Number.isInteger(gel.treatmentIndex) && gel.treatmentIndex >= 0 && gel.treatmentIndex < treatments.length, `${item}-treatment-index`)
          push(Number.isInteger(gel.gelNumber) && gel.gelNumber >= 1 && gel.gelNumber <= experiment.slidesPerTreatment, `${item}-gel-number`)
          if (parsedCode?.format === 'compact') push(parsedCode.gelNumber === gel.gelNumber, `${item}-code-gel`)
          push(gel.treatment === treatments[gel.treatmentIndex], `${item}-treatment`)
          const gelKey = `${gel.treatmentIndex}:${gel.gelNumber}`
          push(!gelKeys.has(gelKey), `${item}-duplicate-laminate`)
          gelKeys.add(gelKey)
          push(!gelCodes.has(gel.blindCode), `${item}-duplicate-code`)
          gelCodes.add(gel.blindCode)
          const assignment = assignments.find(value => value.blindCode === gel.blindCode)
          push(Boolean(assignment) && assignment.status === 'counted' && assignment.treatmentIndex === gel.treatmentIndex && assignment.gelNumber === gel.gelNumber, `${item}-assignment`)
        } else if (Number.isInteger(gel.treatmentIndex)) {
          push(gel.treatment === treatments[gel.treatmentIndex], `${item}-treatment`)
        }
      })
      if (assignments) {
        assignments.forEach((assignment, assignmentIndex) => {
          const item = `${prefix}-assignment-${assignmentIndex + 1}`
          const gel = (replicate.gels || []).find(value => value && value.blindCode === assignment.blindCode)
          push(assignment.status === 'counted' ? Boolean(gel) : !gel, `${item}-gel-correspondence`)
        })
      }
    })

    if (experiment.progress) {
      const progress = experiment.progress
      const replicate = experiment.replicates.find(value => value.replicateNumber === progress.replicateNumber)
      const assignment = replicate?.assignments?.find(value => value.blindCode === progress.blindCode)
      push(Boolean(replicate && assignment && assignment.status === 'counting'), 'invalid-progress-reference')
      push(Array.isArray(progress.counts) && progress.counts.length === 5 && progress.counts.every(value => Number.isInteger(value) && value >= 0), 'invalid-progress-counts')
      push(Array.isArray(progress.clickHistory) && progress.clickHistory.every(value => Number.isInteger(value) && value >= 0 && value <= 4), 'invalid-progress-history')
      if (Array.isArray(progress.counts) && Array.isArray(progress.clickHistory)) {
        const histogram = [0, 0, 0, 0, 0]
        progress.clickHistory.forEach(value => { if (value >= 0 && value <= 4) histogram[value]++ })
        push(histogram.every((value, index) => value === progress.counts[index]), 'progress-history-mismatch')
        push(progress.counts.reduce((sum, value) => sum + value, 0) <= experiment.nucleoidsPerGel, 'progress-over-target')
      }
    }
    return { valid: errors.length === 0, errors, experiment }
  }

  function validateSetup(input) {
    const errors = []
    const requiredText = ['agent', 'cells']
    requiredText.forEach(key => { if (!cleanText(input[key])) errors.push(`${key}-required`) })
    if (![input.negControl, input.posControl, input.solControl].some(value => cleanText(value))) errors.push('control-required')
    const integerRules = [['nucleoidsPerGel', 1, LIMITS.nucleoids], ['slidesPerTreatment', 1, LIMITS.slides], ['conditions', 1, LIMITS.concentrations]]
    integerRules.forEach(([key, min, max]) => {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) errors.push(`invalid-${key}`)
    })
    if (!cleanText(input.concUnit, 20)) errors.push('unit-required')
    if (!Array.isArray(input.concentrations) || input.concentrations.length !== input.conditions || input.concentrations.some(value => !Number.isFinite(value) || value < 0)) errors.push('invalid-concentrations')
    const labels = [...[input.posControl, input.negControl, input.solControl].filter(value => cleanText(value)), ...(input.concentrations || []).map(value => `${value} ${input.concUnit}`.trim())]
    if (new Set(labels.map(value => cleanText(value).toLocaleLowerCase())).size !== labels.length) errors.push('duplicate-treatment')
    return { valid: errors.length === 0, errors }
  }

  function hasPendingSlides(experiment) {
    return Boolean(experiment?.replicates?.some(replicate => replicate.assignments?.some(item => item.status === 'pending' || item.status === 'counting')))
  }

  function aggregateReplicateScores(experiment) {
    const rows = []
    experiment.replicates.forEach(replicate => {
      experiment.treatments.forEach((treatment, treatmentIndex) => {
        const gels = replicate.gels.filter(gel => gel.treatmentIndex === treatmentIndex || (!Number.isInteger(gel.treatmentIndex) && gel.treatment === treatment))
        const complete = gels.filter(gel => isIncludedGel(gel, experiment.nucleoidsPerGel))
        const scores = complete.map(gel => calculateVisualScore(gel, experiment.nucleoidsPerGel))
        const assignments = replicate.assignments?.filter(item => item.treatmentIndex === treatmentIndex) || []
        rows.push({
          treatmentIndex,
          treatment,
          replicateNumber: replicate.replicateNumber,
          expectedSlides: assignments.length || experiment.slidesPerTreatment,
          countedSlides: gels.length,
          completeSlides: complete.length,
          incompleteSlides: gels.length - complete.length,
          absentSlides: assignments.filter(item => item.status === 'absent').length,
          score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
        })
      })
    })
    return rows
  }

  function gelIdentity(replicateNumber, gel) {
    return `${replicateNumber}:${gel.blindCode || `${gel.treatmentIndex ?? gel.treatment}:${gel.gelNumber}`}`
  }

  function stableEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function sameGelData(a, b) {
    const keys = ['blindCode', 'treatment', 'treatmentIndex', 'gelNumber', 'class0', 'class1', 'class2', 'class3', 'class4', 'total', 'status', 'completion', 'incompleteReason']
    return keys.every(key => stableEqual(a[key], b[key]))
  }

  function mergeAssignment(existing, candidate) {
    const mappingKeys = ['blindCode', 'treatmentIndex', 'gelNumber']
    if (!mappingKeys.every(key => stableEqual(existing[key], candidate[key]))) throw new Error(`assignment-conflict:${candidate.blindCode}`)
    if (existing.status === candidate.status) {
      if (existing.status === 'absent' && !stableEqual(existing.absenceReason, candidate.absenceReason)) throw new Error(`assignment-conflict:${candidate.blindCode}`)
      return Date.parse(candidate.recordedAt || 0) > Date.parse(existing.recordedAt || 0) ? clone(candidate) : existing
    }
    const terminal = new Set(['counted', 'absent'])
    if (terminal.has(existing.status) && terminal.has(candidate.status)) throw new Error(`assignment-conflict:${candidate.blindCode}`)
    return terminal.has(candidate.status) || candidate.status === 'counting' ? clone(candidate) : existing
  }

  function mergeExperiments(rawExperiments, createId) {
    if (!Array.isArray(rawExperiments) || !rawExperiments.length) throw new Error('no-experiments')
    const experiments = rawExperiments.map(raw => {
      const result = validateExperiment(raw, { source: 'import' })
      if (!result.valid) throw new Error(`invalid-experiment:${result.errors.join(',')}`)
      return result.experiment
    })
    const reference = experiments[0]
    const keys = ['agent', 'cells', 'negControl', 'posControl', 'solControl', 'concUnit', 'nucleoidsPerGel', 'slidesPerTreatment']
    if (!experiments.every(item => keys.every(key => item[key] === reference[key]) && stableEqual(item.treatments, reference.treatments))) throw new Error('incompatible-experiments')
    if (experiments.some(item => item.progress || item.replicates.some(rep => rep.assignments?.some(assignment => assignment.status === 'counting')))) throw new Error('partial-progress-conflict')

    const result = clone(reference)
    result.id = createId()
    result.progress = null
    result.replicates = []
    const replicateMap = new Map()
    experiments.forEach(experiment => experiment.replicates.forEach(rep => {
      let merged = replicateMap.get(rep.replicateNumber)
      if (!merged) {
        merged = clone(rep)
        replicateMap.set(rep.replicateNumber, merged)
        return
      }
      const gels = new Map(merged.gels.map(gel => [gelIdentity(rep.replicateNumber, gel), gel]))
      rep.gels.forEach(gel => {
        const key = gelIdentity(rep.replicateNumber, gel)
        if (gels.has(key) && !sameGelData(gels.get(key), gel)) throw new Error(`gel-conflict:${key}`)
        if (!gels.has(key)) merged.gels.push(clone(gel))
      })
      if (rep.assignments) {
        merged.assignments = merged.assignments || []
        const assignments = new Map(merged.assignments.map(item => [item.blindCode, item]))
        rep.assignments.forEach(item => {
          if (assignments.has(item.blindCode)) {
            const mergedItem = mergeAssignment(assignments.get(item.blindCode), item)
            const index = merged.assignments.findIndex(value => value.blindCode === item.blindCode)
            merged.assignments[index] = mergedItem
            assignments.set(item.blindCode, mergedItem)
          } else {
            const logicalMatch = merged.assignments.find(value => value.treatmentIndex === item.treatmentIndex && value.gelNumber === item.gelNumber)
            if (logicalMatch) throw new Error(`assignment-conflict:${item.treatmentIndex}:${item.gelNumber}`)
            const added = clone(item)
            merged.assignments.push(added)
            assignments.set(item.blindCode, added)
          }
        })
      }
    }))
    result.replicates = Array.from(replicateMap.values()).sort((a, b) => a.replicateNumber - b.replicateNumber)
    result.updatedAt = new Date().toISOString()
    result.status = hasPendingSlides(result) ? 'in-progress' : 'completed'
    const validation = validateExperiment(result, { source: 'import' })
    if (!validation.valid) throw new Error(`invalid-merged-experiment:${validation.errors.join(',')}`)
    return validation.experiment
  }

  return {
    SCHEMA_VERSION, MAX_FILE_SIZE, LIMITS, ABSENCE_REASONS, INCOMPLETE_REASONS,
    cleanText, parseBlindCode, availableBlindCodeBases, calculateVisualScore, isIncludedGel, migrateExperiment, validateExperiment,
    validateSetup, hasPendingSlides, aggregateReplicateScores, mergeExperiments
  }
})
