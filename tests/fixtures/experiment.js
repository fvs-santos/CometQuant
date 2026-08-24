function completeGel(overrides = {}) {
  return {
    blindCode: 'AA1', treatment: 'Control', treatmentIndex: 0, gelNumber: 1,
    class0: 0, class1: 0, class2: 100, class3: 0, class4: 0,
    total: 100, status: 'counted', completion: 'complete', recordedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  }
}

function experiment(overrides = {}) {
  return {
    schemaVersion: 6, id: 'exp-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    status: 'completed', researcher: 'Researcher', agent: 'Agent', cells: 'CHO-K1', negControl: 'Control',
    posControl: '', solControl: '', nucleoidsPerGel: 100, slidesPerTreatment: 1, concUnit: 'µM',
    treatments: ['Control'], progress: null,
    treatmentMetadata: [{ treatmentIndex: 0, role: 'negative-control', concentration: null }],
    studyDesign: {
      version: 1, status: 'unconfigured', assayType: null, primaryReferenceTreatmentIndex: null,
      primaryTreatmentIndices: [], validationComparison: null, alpha: 0.05, alternative: 'two-sided',
      pAdjustment: 'holm', trendReferenceAsZero: true, configurationSource: null
    },
    slideEditHistory: [],
    replicates: [{
      replicateNumber: 1, date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      assignments: [{ blindCode: 'AA1', treatmentIndex: 0, gelNumber: 1, status: 'counted', recordedAt: '2026-01-02T00:00:00.000Z' }],
      gels: [completeGel()]
    }],
    ...overrides
  }
}

module.exports = { experiment, completeGel }
