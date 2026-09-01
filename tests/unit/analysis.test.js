const fs = require('node:fs')
const path = require('node:path')

function loadAnalysisFunctions() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/analysis.js'), 'utf8')
  return new Function('t', `${source}\nreturn { validateAnalysisResult }`)(key => key)
}

function resultWithSelection(selection) {
  const unavailable = { performed: false, reason: { code: 'test', detail: 'test' } }
  return {
    analysisSchemaVersion: 3,
    selection,
    protocol: unavailable,
    population: unavailable,
    descriptive: unavailable,
    scores: unavailable,
    blockAnova: unavailable,
    primaryComparisons: unavailable,
    controlResponse: unavailable,
    doseTrend: unavailable,
    nonParametric: unavailable,
    transformedAnalysis: unavailable,
    charts: unavailable
  }
}

describe('analysis result contract', () => {
  const expectedSelection = {
    selectionSchemaVersion: 1,
    mode: 'explicit',
    availableReplicateNumbers: [1, 2, 3],
    selectedReplicateNumbers: [1, 3],
    excludedReplicateNumbers: [2],
    exclusionReason: 'Instrument failure',
    selectedAt: '2026-09-01T12:00:00.000Z'
  }

  it('rejects a result when the engine did not accept the requested selection', () => {
    const { validateAnalysisResult } = loadAnalysisFunctions()
    expect(() => validateAnalysisResult(resultWithSelection({
      performed: false,
      reason: { code: 'invalid_selection_options', detail: 'Invalid selection.' }
    }), expectedSelection)).toThrow('analysis.v2.error.invalidSchema')
  })

  it('accepts the exact selection returned by the engine', () => {
    const { validateAnalysisResult } = loadAnalysisFunctions()
    expect(() => validateAnalysisResult(resultWithSelection({
      performed: true,
      selectionSchemaVersion: 1,
      mode: 'explicit',
      availableBlockNumbers: [1, 2, 3],
      selectedBlockNumbers: [1, 3],
      excludedBlockNumbers: [2],
      exclusionReason: 'Instrument failure',
      selectedAt: '2026-09-01T12:00:00.000Z'
    }), expectedSelection)).not.toThrow()
  })
})
