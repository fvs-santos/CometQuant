const core = require('../../js/core.js')
const { experiment, completeGel } = require('../fixtures/experiment.js')

describe('visual score', () => {
  it.each([
    ['class0', 0], ['class1', 25], ['class2', 50], ['class3', 75], ['class4', 100]
  ])('scores pure %s as %s', (key, expected) => {
    const gel = { class0: 0, class1: 0, class2: 0, class3: 0, class4: 0 }
    gel[key] = 100
    expect(core.calculateVisualScore(gel, 100)).toBe(expected)
  })

  it('rejects invalid counts', () => {
    expect(core.calculateVisualScore({ class0: -1, class1: 0, class2: 0, class3: 0, class4: 0 }, 100)).toBeNull()
  })
})

describe('migration and validation', () => {
  it('marks a legacy short count as incomplete without inventing a reason', () => {
    const legacy = experiment({ schemaVersion: 2 })
    legacy.replicates[0].gels[0] = completeGel({ total: 90, class2: 90, completion: undefined })
    const migrated = core.migrateExperiment(legacy)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.replicates[0].gels[0].completion).toBe('incomplete')
    expect(migrated.replicates[0].gels[0].incompleteReason.code).toBe('legacy-unjustified')
  })

  it('migrates pre-v3 data without assignments idempotently', () => {
    const legacy = experiment({ schemaVersion: 2, agent: '', cells: '' })
    delete legacy.replicates[0].assignments
    delete legacy.replicates[0].gels[0].blindCode
    delete legacy.replicates[0].gels[0].treatmentIndex

    const first = core.validateExperiment(legacy, { source: 'import' })
    expect(first.valid).toBe(true)
    expect(first.experiment.replicates[0].assignments).toEqual([
      expect.objectContaining({ blindCode: 'AAAA-01', treatmentIndex: 0, gelNumber: 1, status: 'counted' })
    ])
    expect(first.experiment.migration.missingRequiredFields).toEqual(['agent', 'cells'])

    const second = core.validateExperiment(first.experiment, { source: 'local' })
    expect(second.valid).toBe(true)
  })

  it('migrates schema v3 without changing legacy blind codes', () => {
    const legacy = experiment({ schemaVersion: 3 })
    legacy.replicates[0].assignments[0].blindCode = 'ABCD-01'
    legacy.replicates[0].gels[0].blindCode = 'ABCD-01'

    const result = core.validateExperiment(legacy, { source: 'import' })
    expect(result.valid).toBe(true)
    expect(result.experiment.schemaVersion).toBe(4)
    expect(result.experiment.replicates[0].assignments[0].blindCode).toBe('ABCD-01')
    expect(result.experiment.replicates[0].gels[0].blindCode).toBe('ABCD-01')
  })

  it('keeps missing legacy treatments pending instead of inventing absences', () => {
    const legacy = experiment({ schemaVersion: 2, treatments: ['Control', 'Dose'] })
    delete legacy.replicates[0].assignments
    const result = core.validateExperiment(legacy, { source: 'import' })
    expect(result.valid).toBe(true)
    expect(result.experiment.replicates[0].assignments.map(item => item.status)).toEqual(['counted', 'pending'])
    expect(result.experiment.status).toBe('in-progress')
  })

  it('rejects inconsistent totals and progress history', () => {
    const invalid = experiment()
    invalid.replicates[0].gels[0].total = 99
    const result = core.validateExperiment(invalid, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-1-gel-1-total')
  })

  it('requires a complete, unique assignment map in schema v4', () => {
    const invalid = experiment()
    invalid.replicates[0].assignments[0].status = 'counted'
    invalid.replicates[0].gels = []
    const result = core.validateExperiment(invalid, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-1-assignment-1-gel-correspondence')

    const duplicate = experiment({ slidesPerTreatment: 2 })
    duplicate.replicates[0].assignments.push({ ...duplicate.replicates[0].assignments[0], blindCode: 'EFGH-02' })
    duplicate.replicates[0].gels.push(completeGel({ blindCode: 'EFGH-02', gelNumber: 1 }))
    const duplicateResult = core.validateExperiment(duplicate, { source: 'import' })
    expect(duplicateResult.valid).toBe(false)
    expect(duplicateResult.errors).toContain('replicate-1-assignment-2-duplicate-laminate')
  })

  it('rejects duplicate gels and gels linked to the wrong assignment', () => {
    const invalid = experiment()
    invalid.replicates[0].gels.push(completeGel({ blindCode: 'EFGH-02' }))
    const result = core.validateExperiment(invalid, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-1-gel-2-duplicate-laminate')
    expect(result.errors).toContain('replicate-1-gel-2-assignment')
  })

  it('requires agent, cells, unit and valid concentrations', () => {
    const result = core.validateSetup({ agent: '', cells: '', negControl: 'PBS', posControl: '', solControl: '', nucleoidsPerGel: 100, slidesPerTreatment: 1, conditions: 1, concUnit: '', concentrations: [NaN] })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining(['agent-required', 'cells-required', 'unit-required', 'invalid-concentrations']))
  })

  it('accepts compact and legacy codes through slide 100 without leading zeroes in compact codes', () => {
    const legacy = experiment({ slidesPerTreatment: 100 })
    legacy.replicates[0].assignments = Array.from({ length: 100 }, (_, index) => ({
      blindCode: `ABCD-${String(index + 1).padStart(2, '0')}`,
      treatmentIndex: 0,
      gelNumber: index + 1,
      status: 'pending'
    }))
    legacy.replicates[0].gels = []
    expect(core.validateExperiment(legacy, { source: 'import' }).valid).toBe(true)

    const compact = experiment({ slidesPerTreatment: 100 })
    compact.replicates[0].assignments = Array.from({ length: 100 }, (_, index) => ({
      blindCode: `AB${index + 1}`,
      treatmentIndex: 0,
      gelNumber: index + 1,
      status: 'pending'
    }))
    compact.replicates[0].gels = []
    expect(core.validateExperiment(compact, { source: 'import' }).valid).toBe(true)

    compact.replicates[0].assignments[0].blindCode = 'AB01'
    expect(core.validateExperiment(compact, { source: 'import' }).valid).toBe(false)
  })

  it('requires compact suffixes to match slide numbers and one base per treatment', () => {
    const data = experiment({ slidesPerTreatment: 2 })
    data.replicates[0].assignments = [
      { blindCode: 'AB1', treatmentIndex: 0, gelNumber: 1, status: 'pending' },
      { blindCode: 'AC2', treatmentIndex: 0, gelNumber: 2, status: 'pending' }
    ]
    data.replicates[0].gels = []
    let result = core.validateExperiment(data, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-1-assignment-2-treatment-code-base')

    data.replicates[0].assignments[1].blindCode = 'AB3'
    result = core.validateExperiment(data, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-1-assignment-2-code-gel')
  })

  it('rejects reuse of a compact base in another replicate', () => {
    const data = experiment()
    data.replicates.push({
      replicateNumber: 2,
      date: '2026-01-03',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      assignments: [{ blindCode: 'AA1', treatmentIndex: 0, gelNumber: 1, status: 'pending' }],
      gels: []
    })
    const result = core.validateExperiment(data, { source: 'import' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('replicate-2-assignment-1-duplicate-code-base')
  })
})

describe('blind code allocation', () => {
  it('recognizes compact ordered bases and legacy codes', () => {
    expect(core.parseBlindCode('AB1')).toEqual({ format: 'compact', base: 'AB', gelNumber: 1 })
    expect(core.parseBlindCode('BA100')).toEqual({ format: 'compact', base: 'BA', gelNumber: 100 })
    expect(core.parseBlindCode('ABCD-01')).toEqual({ format: 'legacy', base: 'ABCD', gelNumber: 1 })
    ;['A1', 'AAA1', 'AB01', 'AB-1', 'ab1'].forEach(code => expect(core.parseBlindCode(code)).toBeNull())
  })

  it('allocates all 676 ordered bases without reusing compact codes', () => {
    const allBases = core.availableBlindCodeBases({ replicates: [] })
    expect(allBases).toHaveLength(676)
    expect(allBases).toEqual(expect.arrayContaining(['AA', 'AB', 'BA', 'ZZ']))

    const used = {
      replicates: [{ assignments: [
        { blindCode: 'AB1' },
        { blindCode: 'BA100' },
        { blindCode: 'ABCD-01' }
      ] }]
    }
    const remaining = core.availableBlindCodeBases(used)
    expect(remaining).toHaveLength(674)
    expect(remaining).not.toContain('AB')
    expect(remaining).not.toContain('BA')

    const exhausted = { replicates: [{ assignments: allBases.map(base => ({ blindCode: `${base}1` })) }] }
    expect(core.availableBlindCodeBases(exhausted)).toEqual([])
  })
})

describe('aggregation and consolidation', () => {
  it('averages complete technical slides and excludes incomplete slides', () => {
    const data = experiment({ slidesPerTreatment: 3 })
    const rep = data.replicates[0]
    rep.assignments = [
      { blindCode: 'ABCD-01', treatmentIndex: 0, gelNumber: 1, status: 'counted' },
      { blindCode: 'ABCD-02', treatmentIndex: 0, gelNumber: 2, status: 'counted' },
      { blindCode: 'ABCD-03', treatmentIndex: 0, gelNumber: 3, status: 'counted' }
    ]
    rep.gels = [completeGel(), completeGel({ blindCode: 'ABCD-02', gelNumber: 2, class2: 0, class4: 100 }), completeGel({ blindCode: 'ABCD-03', gelNumber: 3, total: 50, class2: 50, completion: 'incomplete', incompleteReason: { code: 'poor-quality', detail: '' } })]
    const row = core.aggregateReplicateScores(data)[0]
    expect(row.score).toBe(75)
    expect(row.completeSlides).toBe(2)
    expect(row.incompleteSlides).toBe(1)
  })

  it('rejects conflicting counts for the same blind code', () => {
    const first = experiment()
    const second = experiment({ id: 'exp-2' })
    second.replicates[0].gels[0].class2 = 0
    second.replicates[0].gels[0].class4 = 100
    expect(() => core.mergeExperiments([first, second], () => 'merged')).toThrow(/gel-conflict/)
  })

  it('rejects consolidation while partial counting is active', () => {
    const partial = experiment()
    partial.replicates[0].gels = []
    partial.replicates[0].assignments[0].status = 'counting'
    partial.progress = {
      replicateNumber: 1,
      treatmentIndex: 0,
      gelIndex: 0,
      blindCode: 'AA1',
      counts: [1, 0, 0, 0, 0],
      clickHistory: [0],
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    expect(() => core.mergeExperiments([partial], () => 'merged')).toThrow(/partial-progress-conflict/)
  })

  it('rejects different blind codes for the same logical slide', () => {
    const first = experiment()
    const second = experiment({ id: 'exp-2' })
    second.replicates[0].assignments[0].blindCode = 'EFGH-01'
    second.replicates[0].gels[0].blindCode = 'EFGH-01'
    expect(() => core.mergeExperiments([first, second], () => 'merged')).toThrow(/assignment-conflict/)
  })
})
