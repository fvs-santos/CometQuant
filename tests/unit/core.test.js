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
    expect(migrated.schemaVersion).toBe(3)
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

  it('requires a complete, unique assignment map in schema v3', () => {
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

  it('accepts the 100th slide code without accepting zero-padded overflow', () => {
    const data = experiment({ slidesPerTreatment: 100 })
    data.replicates[0].assignments = Array.from({ length: 100 }, (_, index) => ({
      blindCode: `ABCD-${String(index + 1).padStart(2, '0')}`,
      treatmentIndex: 0,
      gelNumber: index + 1,
      status: 'pending'
    }))
    data.replicates[0].gels = []
    expect(core.validateExperiment(data, { source: 'import' }).valid).toBe(true)

    data.replicates[0].assignments[99].blindCode = 'ABCD-00'
    expect(core.validateExperiment(data, { source: 'import' }).valid).toBe(false)
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
})
