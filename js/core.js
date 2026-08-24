(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const SCHEMA_VERSION = 6
  const STUDY_DESIGN_VERSION = 1
  const MAX_FILE_SIZE = 5 * 1024 * 1024
  const LIMITS = { nucleoids: 10000, slides: 100, concentrations: 100, text: 120, detail: 500 }
  const LEGACY_BLIND_CODE_PATTERN = /^([A-Z2-9]{4})-(0[1-9]|[1-9]\d|100)$/
  const COMPACT_BLIND_CODE_PATTERN = /^([A-Z]{2})([1-9]|[1-9]\d|100)$/
  const ASSIGNMENT_STATUSES = new Set(['pending', 'counting', 'counted', 'absent'])
  const ABSENCE_REASONS = new Set(['broken', 'lost', 'quality', 'insufficient', 'other', 'legacy-unjustified'])
  const INCOMPLETE_REASONS = new Set(['insufficient-cells', 'poor-quality', 'damaged', 'technical-error', 'time-limit', 'other', 'legacy-unjustified'])
  const TREATMENT_ROLES = new Set(['positive-control', 'negative-control', 'solvent-control', 'test-concentration', 'other'])
  const ASSAY_TYPES = new Set(['genotoxicity', 'antigenotoxicity'])

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

  function calculateVisualScore(gel) {
    if (!isObject(gel)) return null
    const values = [gel.class0, gel.class1, gel.class2, gel.class3, gel.class4]
    if (!values.every(value => Number.isInteger(value) && value >= 0)) return null
    const total = values.reduce((sum, value) => sum + value, 0)
    if (total < 1 || (gel.total !== undefined && gel.total !== total)) return null
    return ((0.25 * values[1] + 0.5 * values[2] + 0.75 * values[3] + values[4]) / total) * 100
  }

  function isIncludedGel(gel) {
    return gel?.status === 'counted' && calculateVisualScore(gel) !== null
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

  function unconfiguredStudyDesign() {
    return {
      version: STUDY_DESIGN_VERSION,
      status: 'unconfigured',
      assayType: null,
      primaryReferenceTreatmentIndex: null,
      primaryTreatmentIndices: [],
      validationComparison: null,
      alpha: 0.05,
      alternative: 'two-sided',
      pAdjustment: 'holm',
      trendReferenceAsZero: true,
      configurationSource: null
    }
  }

  function legacyConcentration(label, unit) {
    const normalizedUnit = cleanText(unit, 20)
    if (!normalizedUnit || typeof label !== 'string') return null
    const escapedUnit = normalizedUnit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?) ${escapedUnit}$`, 'i').exec(cleanText(label))
    if (!match) return null
    const value = Number(match[1])
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  function migrateTreatmentMetadata(experiment) {
    const controls = [
      ['positive-control', cleanText(experiment.posControl).toLocaleLowerCase()],
      ['negative-control', cleanText(experiment.negControl).toLocaleLowerCase()],
      ['solvent-control', cleanText(experiment.solControl).toLocaleLowerCase()]
    ]
    return (Array.isArray(experiment.treatments) ? experiment.treatments : []).map((treatment, treatmentIndex) => {
      const normalized = cleanText(treatment).toLocaleLowerCase()
      const controlMatches = controls.filter(([, label]) => label && label === normalized)
      if (controlMatches.length === 1) return { treatmentIndex, role: controlMatches[0][0], concentration: null }
      const concentration = legacyConcentration(treatment, experiment.concUnit)
      return {
        treatmentIndex,
        role: concentration === null ? 'other' : 'test-concentration',
        concentration
      }
    })
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
    // Schema v6 adds an append-only slide correction history.
    experiment.schemaVersion = SCHEMA_VERSION
    experiment.slidesPerTreatment = Number.isInteger(Number(experiment.slidesPerTreatment))
      ? Number(experiment.slidesPerTreatment) : 1
    experiment.replicates = Array.isArray(experiment.replicates) ? experiment.replicates : []
    experiment.progress = isObject(experiment.progress) ? experiment.progress : null
    experiment.createdAt = validIsoDate(experiment.createdAt)
      ? experiment.createdAt : `${experiment.replicates[0]?.date || '1970-01-01'}T00:00:00.000Z`
    experiment.updatedAt = validIsoDate(experiment.updatedAt) ? experiment.updatedAt : experiment.createdAt
    if (version < 5 || experiment.treatmentMetadata === undefined) {
      experiment.treatmentMetadata = migrateTreatmentMetadata(experiment)
    }
    if (version < 5 || experiment.studyDesign === undefined) {
      experiment.studyDesign = unconfiguredStudyDesign()
    }
    if (version < 6) experiment.slideEditHistory = []

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

  function validateTreatmentMetadata(metadata, treatments) {
    const errors = []
    if (!Array.isArray(metadata) || metadata.length !== treatments.length) return ['invalid-treatment-metadata']
    metadata.forEach((item, index) => {
      const prefix = `treatment-metadata-${index + 1}`
      if (!isObject(item)) {
        errors.push(`${prefix}-invalid`)
        return
      }
      if (item.treatmentIndex !== index) errors.push(`${prefix}-index`)
      if (!TREATMENT_ROLES.has(item.role)) errors.push(`${prefix}-role`)
      if (item.role === 'test-concentration') {
        if (!Number.isFinite(item.concentration) || item.concentration < 0) errors.push(`${prefix}-concentration`)
      } else if (item.concentration !== null) {
        errors.push(`${prefix}-concentration`)
      }
    })
    return errors
  }

  function validateStudyDesign(design, metadata, treatments) {
    const errors = []
    const validIndex = value => Number.isInteger(value) && value >= 0 && value < treatments.length
    if (!isObject(design)) return ['invalid-study-design']
    if (design.version !== STUDY_DESIGN_VERSION) errors.push('invalid-study-design-version')
    if (!['unconfigured', 'configured'].includes(design.status)) errors.push('invalid-study-design-status')
    if (design.alpha !== 0.05) errors.push('invalid-study-design-alpha')
    if (design.alternative !== 'two-sided') errors.push('invalid-study-design-alternative')
    if (design.pAdjustment !== 'holm') errors.push('invalid-study-design-adjustment')
    if (design.trendReferenceAsZero !== true) errors.push('invalid-study-design-trend-reference')

    if (design.status === 'unconfigured') {
      if (design.assayType !== null) errors.push('unconfigured-study-design-assay')
      if (design.primaryReferenceTreatmentIndex !== null) errors.push('unconfigured-study-design-reference')
      if (!Array.isArray(design.primaryTreatmentIndices) || design.primaryTreatmentIndices.length !== 0) errors.push('unconfigured-study-design-treatments')
      if (design.validationComparison !== null) errors.push('unconfigured-study-design-validation')
      if (design.configurationSource !== null) errors.push('unconfigured-study-design-source')
      return errors
    }

    if (!ASSAY_TYPES.has(design.assayType)) errors.push('invalid-assay-type')
    if (!validIndex(design.primaryReferenceTreatmentIndex)) errors.push('invalid-primary-reference')
    if (!Array.isArray(design.primaryTreatmentIndices) || !design.primaryTreatmentIndices.length ||
      design.primaryTreatmentIndices.some(index => !validIndex(index)) ||
      new Set(design.primaryTreatmentIndices).size !== design.primaryTreatmentIndices.length ||
      design.primaryTreatmentIndices.includes(design.primaryReferenceTreatmentIndex)) {
      errors.push('invalid-primary-treatments')
    }
    if (!cleanText(design.configurationSource, 40)) errors.push('invalid-configuration-source')

    const comparison = design.validationComparison
    if (!isObject(comparison) || !validIndex(comparison.referenceTreatmentIndex) ||
      !validIndex(comparison.treatmentIndex) || comparison.referenceTreatmentIndex === comparison.treatmentIndex) {
      errors.push('invalid-validation-comparison')
    }

    const roleAt = index => metadata?.[index]?.role
    const basalRoles = new Set(['negative-control', 'solvent-control'])
    if (design.assayType === 'genotoxicity') {
      if (!basalRoles.has(roleAt(design.primaryReferenceTreatmentIndex))) errors.push('invalid-genotoxicity-reference')
      if (isObject(comparison) && (comparison.referenceTreatmentIndex !== design.primaryReferenceTreatmentIndex || roleAt(comparison.treatmentIndex) !== 'positive-control')) errors.push('invalid-genotoxicity-validation')
    }
    if (design.assayType === 'antigenotoxicity') {
      if (roleAt(design.primaryReferenceTreatmentIndex) !== 'positive-control') errors.push('invalid-antigenotoxicity-reference')
      if (isObject(comparison) && (!basalRoles.has(roleAt(comparison.referenceTreatmentIndex)) || comparison.treatmentIndex !== design.primaryReferenceTreatmentIndex)) errors.push('invalid-antigenotoxicity-validation')
    }
    if (Array.isArray(design.primaryTreatmentIndices) && design.primaryTreatmentIndices.some(index => roleAt(index) !== 'test-concentration')) errors.push('invalid-primary-treatment-role')
    return errors
  }

  function createSlideEditSnapshot(assignment, gel) {
    if (!isObject(assignment)) return null
    const assignmentSnapshot = {
      blindCode: assignment.blindCode,
      treatmentIndex: assignment.treatmentIndex,
      gelNumber: assignment.gelNumber,
      status: assignment.status
    }
    if (assignment.recordedAt !== undefined) assignmentSnapshot.recordedAt = assignment.recordedAt
    if (assignment.status === 'absent') assignmentSnapshot.absenceReason = clone(assignment.absenceReason)

    let gelSnapshot = null
    if (gel !== null && gel !== undefined) {
      gelSnapshot = {
        blindCode: gel.blindCode,
        treatment: gel.treatment,
        treatmentIndex: gel.treatmentIndex,
        gelNumber: gel.gelNumber,
        class0: gel.class0,
        class1: gel.class1,
        class2: gel.class2,
        class3: gel.class3,
        class4: gel.class4,
        total: gel.total,
        status: gel.status,
        completion: gel.completion
      }
      if (gel.recordedAt !== undefined) gelSnapshot.recordedAt = gel.recordedAt
      if (gel.completion === 'incomplete') gelSnapshot.incompleteReason = clone(gel.incompleteReason)
    }
    return { assignment: assignmentSnapshot, gel: gelSnapshot }
  }

  function slideEditKey(slide) {
    return `${slide.replicateNumber}:${slide.blindCode}`
  }

  function validateSlideEditSnapshot(snapshot, slide, treatments, target) {
    if (!isObject(snapshot) || !isObject(snapshot.assignment)) return false
    const assignment = snapshot.assignment
    if (assignment.blindCode !== slide.blindCode || assignment.treatmentIndex !== slide.treatmentIndex || assignment.gelNumber !== slide.gelNumber) return false
    if (!['counted', 'absent'].includes(assignment.status)) return false
    if (assignment.recordedAt !== undefined && !validIsoDate(assignment.recordedAt)) return false
    if (assignment.status === 'absent') {
      if (snapshot.gel !== null || !validateReason(assignment.absenceReason, ABSENCE_REASONS, true)) return false
    } else {
      if (!isObject(snapshot.gel)) return false
      const gel = snapshot.gel
      const counts = [gel.class0, gel.class1, gel.class2, gel.class3, gel.class4]
      if (gel.blindCode !== slide.blindCode || gel.treatmentIndex !== slide.treatmentIndex || gel.gelNumber !== slide.gelNumber || gel.treatment !== treatments[slide.treatmentIndex]) return false
      if (!counts.every(value => Number.isInteger(value) && value >= 0)) return false
      if (!Number.isInteger(gel.total) || gel.total !== counts.reduce((sum, value) => sum + value, 0)) return false
      if (gel.status !== 'counted' || gel.completion !== (gel.total === target ? 'complete' : 'incomplete')) return false
      if (gel.recordedAt !== undefined && !validIsoDate(gel.recordedAt)) return false
      if (gel.completion === 'incomplete' && !validateReason(gel.incompleteReason, INCOMPLETE_REASONS, true)) return false
    }
    return stableEqual(snapshot, createSlideEditSnapshot(assignment, snapshot.gel))
  }

  function validateSlideEditHistory(experiment) {
    const errors = []
    const history = experiment.slideEditHistory
    if (!Array.isArray(history) || history.length > 10000) return ['invalid-slide-edit-history']
    const editIds = new Set()
    const latestBySlide = new Map()
    history.forEach((event, index) => {
      const prefix = `slide-edit-${index + 1}`
      if (!isObject(event)) {
        errors.push(`${prefix}-invalid`)
        return
      }
      if (event.version !== 1) errors.push(`${prefix}-version`)
      if (typeof event.editId !== 'string' || !event.editId || event.editId.length > 200 || editIds.has(event.editId)) errors.push(`${prefix}-id`)
      editIds.add(event.editId)
      if (!validIsoDate(event.editedAt)) errors.push(`${prefix}-date`)
      if (typeof event.editedBy !== 'string' || !cleanText(event.editedBy) || cleanText(event.editedBy) !== event.editedBy) errors.push(`${prefix}-editor`)
      if (typeof event.reason !== 'string' || !cleanText(event.reason, LIMITS.detail) || cleanText(event.reason, LIMITS.detail) !== event.reason) errors.push(`${prefix}-reason`)
      const slide = event.slide
      const validSlide = isObject(slide) && Number.isInteger(slide.replicateNumber) && slide.replicateNumber > 0 &&
        Boolean(parseBlindCode(slide.blindCode)) && Number.isInteger(slide.treatmentIndex) && slide.treatmentIndex >= 0 && slide.treatmentIndex < experiment.treatments.length &&
        Number.isInteger(slide.gelNumber) && slide.gelNumber >= 1 && slide.gelNumber <= experiment.slidesPerTreatment
      if (!validSlide) {
        errors.push(`${prefix}-slide`)
        return
      }
      if (!validateSlideEditSnapshot(event.before, slide, experiment.treatments, experiment.nucleoidsPerGel)) errors.push(`${prefix}-before`)
      if (!validateSlideEditSnapshot(event.after, slide, experiment.treatments, experiment.nucleoidsPerGel)) errors.push(`${prefix}-after`)
      if (stableEqual(event.before, event.after)) errors.push(`${prefix}-no-change`)
      const key = slideEditKey(slide)
      if (latestBySlide.has(key) && !stableEqual(latestBySlide.get(key), event.before)) errors.push(`${prefix}-chain`)
      latestBySlide.set(key, event.after)
    })

    latestBySlide.forEach((snapshot, key) => {
      const separator = key.indexOf(':')
      const replicateNumber = Number(key.slice(0, separator))
      const blindCode = key.slice(separator + 1)
      const replicate = experiment.replicates.find(item => item.replicateNumber === replicateNumber)
      const assignment = replicate?.assignments?.find(item => item.blindCode === blindCode)
      const gel = replicate?.gels?.find(item => item.blindCode === blindCode) || null
      if (!assignment || !stableEqual(snapshot, createSlideEditSnapshot(assignment, gel))) errors.push(`slide-edit-current-state-${key}`)
    })
    return errors
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
    validateTreatmentMetadata(experiment.treatmentMetadata, treatments).forEach(error => errors.push(error))
    validateStudyDesign(experiment.studyDesign, experiment.treatmentMetadata, treatments).forEach(error => errors.push(error))
    validateSlideEditHistory(experiment).forEach(error => errors.push(error))
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
        push(Number.isInteger(gel.total) && gel.total === sum, `${item}-total`)
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

  function terminalSlideSnapshots(experiment) {
    const snapshots = new Map()
    experiment.replicates.forEach(replicate => {
      ;(replicate.assignments || []).forEach(assignment => {
        if (!['counted', 'absent'].includes(assignment.status)) return
        const gel = replicate.gels.find(item => item.blindCode === assignment.blindCode) || null
        snapshots.set(`${replicate.replicateNumber}:${assignment.blindCode}`, createSlideEditSnapshot(assignment, gel))
      })
    })
    return snapshots
  }

  function validateExperimentTransition(previousRaw, candidateRaw) {
    const previousResult = validateExperiment(previousRaw, { source: 'local' })
    const candidateResult = validateExperiment(candidateRaw, { source: 'local' })
    if (!previousResult.valid || !candidateResult.valid) return { valid: false, errors: ['invalid-transition-document'] }
    const previous = previousResult.experiment
    const candidate = candidateResult.experiment
    const errors = []
    const oldHistory = previous.slideEditHistory
    const newHistory = candidate.slideEditHistory
    if (newHistory.length < oldHistory.length || !oldHistory.every((event, index) => stableEqual(event, newHistory[index]))) {
      return { valid: false, errors: ['slide-edit-history-not-append-only'] }
    }

    const oldSnapshots = terminalSlideSnapshots(previous)
    const newSnapshots = terminalSlideSnapshots(candidate)
    const changed = []
    oldSnapshots.forEach((before, key) => {
      const after = newSnapshots.get(key)
      if (!after) errors.push(`terminal-slide-removed:${key}`)
      else if (!stableEqual(before, after)) changed.push({ key, before, after })
    })
    const appended = newHistory.slice(oldHistory.length)
    if (appended.length !== changed.length) errors.push('slide-edit-event-count')
    changed.forEach(change => {
      const event = appended.find(item => slideEditKey(item.slide) === change.key)
      if (!event || !stableEqual(event.before, change.before) || !stableEqual(event.after, change.after)) errors.push(`slide-edit-event-mismatch:${change.key}`)
    })
    appended.forEach(event => {
      if (!changed.some(change => change.key === slideEditKey(event.slide))) errors.push(`slide-edit-event-without-change:${slideEditKey(event.slide)}`)
    })
    return { valid: errors.length === 0, errors }
  }

  function validateSetup(input = {}, options = {}) {
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
    const designKeys = ['assayType', 'primaryReferenceTreatmentIndex', 'primaryTreatmentIndices', 'validationComparison', 'alpha', 'alternative', 'pAdjustment', 'trendReferenceAsZero', 'configurationSource']
    const hasDesign = isObject(input.studyDesign) || options.requireStudyDesign === true || designKeys.some(key => Object.prototype.hasOwnProperty.call(input, key))
    let treatmentMetadata = null
    let studyDesign = null
    if (hasDesign) {
      if (!cleanText(input.posControl)) errors.push('positive-control-required')
      if (![input.negControl, input.solControl].some(value => cleanText(value))) errors.push('basal-control-required')
      treatmentMetadata = migrateTreatmentMetadata({
        posControl: input.posControl,
        negControl: input.negControl,
        solControl: input.solControl,
        concUnit: input.concUnit,
        treatments: labels
      })
      studyDesign = isObject(input.studyDesign)
        ? clone(input.studyDesign)
        : {
            version: STUDY_DESIGN_VERSION,
            status: 'configured',
            assayType: input.assayType,
            primaryReferenceTreatmentIndex: input.primaryReferenceTreatmentIndex,
            primaryTreatmentIndices: input.primaryTreatmentIndices,
            validationComparison: input.validationComparison,
            alpha: input.alpha,
            alternative: input.alternative,
            pAdjustment: input.pAdjustment,
            trendReferenceAsZero: input.trendReferenceAsZero,
            configurationSource: input.configurationSource
          }
      validateTreatmentMetadata(treatmentMetadata, labels).forEach(error => errors.push(error))
      validateStudyDesign(studyDesign, treatmentMetadata, labels).forEach(error => errors.push(error))
    }
    return { valid: errors.length === 0, errors, ...(hasDesign ? { treatmentMetadata, studyDesign } : {}) }
  }

  function hasPendingSlides(experiment) {
    return Boolean(experiment?.replicates?.some(replicate => replicate.assignments?.some(item => item.status === 'pending' || item.status === 'counting')))
  }

  function aggregateReplicateScores(experiment) {
    const rows = []
    experiment.replicates.forEach(replicate => {
      experiment.treatments.forEach((treatment, treatmentIndex) => {
        const gels = replicate.gels.filter(gel => gel.treatmentIndex === treatmentIndex || (!Number.isInteger(gel.treatmentIndex) && gel.treatment === treatment))
        const analyzable = gels.filter(isIncludedGel)
        const scores = analyzable.map(calculateVisualScore)
        const onTarget = gels.filter(gel => gel.total === experiment.nucleoidsPerGel)
        const assignments = replicate.assignments?.filter(item => item.treatmentIndex === treatmentIndex) || []
        rows.push({
          treatmentIndex,
          treatment,
          replicateNumber: replicate.replicateNumber,
          expectedSlides: assignments.length || experiment.slidesPerTreatment,
          countedSlides: gels.length,
          analyzedSlides: analyzable.length,
          completeSlides: onTarget.length,
          incompleteSlides: gels.length - onTarget.length,
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
    if (a === b) return true
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => stableEqual(value, b[index]))
    }
    if (isObject(a) || isObject(b)) {
      if (!isObject(a) || !isObject(b)) return false
      const aKeys = Object.keys(a).sort()
      const bKeys = Object.keys(b).sort()
      return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && stableEqual(a[key], b[key]))
    }
    return false
  }

  function analyticalContract(experiment) {
    return {
      treatmentMetadata: experiment.treatmentMetadata.map(item => ({
        treatmentIndex: item.treatmentIndex,
        role: item.role,
        concentration: item.concentration
      })),
      studyDesign: {
        version: experiment.studyDesign.version,
        status: experiment.studyDesign.status,
        assayType: experiment.studyDesign.assayType,
        primaryReferenceTreatmentIndex: experiment.studyDesign.primaryReferenceTreatmentIndex,
        primaryTreatmentIndices: experiment.studyDesign.primaryTreatmentIndices,
        validationComparison: experiment.studyDesign.validationComparison && {
          referenceTreatmentIndex: experiment.studyDesign.validationComparison.referenceTreatmentIndex,
          treatmentIndex: experiment.studyDesign.validationComparison.treatmentIndex
        },
        alpha: experiment.studyDesign.alpha,
        alternative: experiment.studyDesign.alternative,
        pAdjustment: experiment.studyDesign.pAdjustment,
        trendReferenceAsZero: experiment.studyDesign.trendReferenceAsZero,
        configurationSource: experiment.studyDesign.configurationSource
      }
    }
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
    if (!experiments.every(item => keys.every(key => item[key] === reference[key]) &&
      stableEqual(item.treatments, reference.treatments) &&
      stableEqual(analyticalContract(item), analyticalContract(reference)))) throw new Error('incompatible-experiments')
    if (experiments.some(item => item.progress || item.replicates.some(rep => rep.assignments?.some(assignment => assignment.status === 'counting')))) throw new Error('partial-progress-conflict')

    const longestHistory = experiments.map(item => item.slideEditHistory).sort((a, b) => b.length - a.length)[0]
    if (!experiments.every(item => item.slideEditHistory.every((event, index) => stableEqual(event, longestHistory[index])))) throw new Error('slide-edit-history-conflict')
    const historySource = experiments.find(item => item.slideEditHistory.length === longestHistory.length)
    const orderedExperiments = [historySource, ...experiments.filter(item => item !== historySource)]
    const currentHistorySnapshots = terminalSlideSnapshots(historySource)
    const supersededKeys = new Map()
    experiments.forEach(experiment => {
      if (experiment.slideEditHistory.length === longestHistory.length) {
        supersededKeys.set(experiment, new Set())
        return
      }
      const expected = new Map(currentHistorySnapshots)
      for (let index = longestHistory.length - 1; index >= experiment.slideEditHistory.length; index--) {
        const event = longestHistory[index]
        expected.set(slideEditKey(event.slide), event.before)
      }
      const actual = terminalSlideSnapshots(experiment)
      actual.forEach((snapshot, key) => {
        if (expected.has(key) && !stableEqual(snapshot, expected.get(key))) throw new Error(`slide-edit-ancestor-conflict:${key}`)
      })
      supersededKeys.set(experiment, new Set(Array.from(expected, ([key, snapshot]) =>
        !stableEqual(snapshot, currentHistorySnapshots.get(key)) ? key : null).filter(Boolean)))
    })
    const result = clone(historySource)
    result.slideEditHistory = clone(longestHistory)
    result.id = createId()
    result.progress = null
    result.replicates = []
    const replicateMap = new Map()
    orderedExperiments.forEach(experiment => experiment.replicates.forEach(rep => {
      let merged = replicateMap.get(rep.replicateNumber)
      if (!merged) {
        merged = clone(rep)
        replicateMap.set(rep.replicateNumber, merged)
        return
      }
      const gels = new Map(merged.gels.map(gel => [gelIdentity(rep.replicateNumber, gel), gel]))
      rep.gels.forEach(gel => {
        const key = gelIdentity(rep.replicateNumber, gel)
        if (supersededKeys.get(experiment).has(key)) return
        if (gels.has(key) && !sameGelData(gels.get(key), gel)) throw new Error(`gel-conflict:${key}`)
        if (!gels.has(key)) merged.gels.push(clone(gel))
      })
      if (rep.assignments) {
        merged.assignments = merged.assignments || []
        const assignments = new Map(merged.assignments.map(item => [item.blindCode, item]))
        rep.assignments.forEach(item => {
          if (supersededKeys.get(experiment).has(`${rep.replicateNumber}:${item.blindCode}`)) return
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
    SCHEMA_VERSION, STUDY_DESIGN_VERSION, MAX_FILE_SIZE, LIMITS, ABSENCE_REASONS, INCOMPLETE_REASONS,
    cleanText, parseBlindCode, availableBlindCodeBases, calculateVisualScore, isIncludedGel, migrateExperiment, validateExperiment,
    createSlideEditSnapshot, validateExperimentTransition,
    validateSetup, hasPendingSlides, aggregateReplicateScores, mergeExperiments
  }
})
