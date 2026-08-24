(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantLegacyXlsx = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MAX_XLSX_SIZE = 5 * 1024 * 1024
  const MAX_XML_SIZE = 8 * 1024 * 1024
  const MAX_ROWS = 2000
  const MAX_COLUMNS = 150
  const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

  function textContent(node) {
    return Array.from(node?.getElementsByTagName('t') || [], item => item.textContent || '').join('')
  }

  function parseXml(source, DomParser) {
    const document = new DomParser().parseFromString(source, 'application/xml')
    if (document.getElementsByTagName('parsererror').length) throw new Error('invalid-xlsx-xml')
    return document
  }

  async function readEntry(zip, path, required = true) {
    const entry = zip.file(path)
    if (!entry) {
      if (required) throw new Error(`missing-xlsx-entry:${path}`)
      return null
    }
    const source = await entry.async('string')
    if (source.length > MAX_XML_SIZE) throw new Error('xlsx-entry-too-large')
    return source
  }

  function relationshipTarget(workbook, relationships, sheetName) {
    const sheet = Array.from(workbook.getElementsByTagName('sheet')).find(item => item.getAttribute('name') === sheetName)
    if (!sheet) throw new Error('missing-comet-assay-sheet')
    const relationshipId = sheet.getAttributeNS(RELATIONSHIP_NS, 'id') || sheet.getAttribute('r:id')
    const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(item => item.getAttribute('Id') === relationshipId)
    if (!relationship) throw new Error('missing-sheet-relationship')
    const target = relationship.getAttribute('Target') || ''
    const normalized = target.replace(/^\//, '').replace(/\\/g, '/')
    return normalized.startsWith('xl/') ? normalized : `xl/${normalized.replace(/^\.\//, '')}`
  }

  function columnNumber(reference) {
    const letters = /^([A-Z]+)\d+$/i.exec(reference)?.[1]?.toUpperCase()
    if (!letters) return null
    let value = 0
    for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
    return value
  }

  function cellValue(cell, sharedStrings) {
    if (cell.getElementsByTagName('f').length) return { formula: true, value: null }
    const type = cell.getAttribute('t')
    if (type === 'inlineStr') return { formula: false, value: textContent(cell) }
    const raw = cell.getElementsByTagName('v')[0]?.textContent
    if (raw === undefined) return { formula: false, value: null }
    if (type === 's') return { formula: false, value: sharedStrings[Number(raw)] ?? '' }
    if (type === 'str') return { formula: false, value: raw }
    if (type === 'b') return { formula: false, value: raw === '1' }
    const numeric = Number(raw)
    return { formula: false, value: Number.isFinite(numeric) ? numeric : raw }
  }

  function worksheetCells(worksheet, sharedStrings) {
    const cells = new Map()
    const formulas = new Set()
    for (const cell of worksheet.getElementsByTagName('c')) {
      const reference = cell.getAttribute('r')
      const match = /^([A-Z]+)(\d+)$/i.exec(reference || '')
      const column = columnNumber(reference)
      const row = Number(match?.[2])
      if (!column || !Number.isInteger(row) || row < 1 || row > MAX_ROWS || column > MAX_COLUMNS) throw new Error('xlsx-range-too-large')
      const parsed = cellValue(cell, sharedStrings)
      cells.set(`${row}:${column}`, parsed.value)
      if (parsed.formula) formulas.add(`${row}:${column}`)
    }
    return { cells, formulas }
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : value
  }

  function valueAt(grid, row, column) {
    return clean(grid.cells.get(`${row}:${column}`) ?? null)
  }

  function metadataValue(grid, patterns) {
    for (let row = 1; row <= 30; row++) {
      const value = valueAt(grid, row, 1)
      if (typeof value !== 'string') continue
      for (const pattern of patterns) {
        const match = pattern.exec(value)
        if (match) return clean(match[1])
      }
    }
    return ''
  }

  function positiveInteger(value, code) {
    const numeric = Number(value)
    if (!Number.isInteger(numeric) || numeric < 1) throw new Error(code)
    return numeric
  }

  function parseConcentration(label) {
    if (typeof label !== 'string') return null
    const match = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s+(.+)$/i.exec(label.trim())
    if (!match) return null
    const concentration = Number(match[1].replace(',', '.'))
    if (!Number.isFinite(concentration) || concentration < 0) return null
    const unit = match[2].replace(/�/g, 'µ').trim()
    return { concentration, unit }
  }

  async function readFileBytes(file, FileReaderCtor) {
    if (typeof file.arrayBuffer === 'function') {
      try {
        return await file.arrayBuffer()
      } catch (_) {
        // Fall through for WebKit versions with an incomplete Blob.arrayBuffer implementation.
      }
    }
    if (!FileReaderCtor) throw new Error('xlsx-file-reader-unavailable')
    return new Promise((resolve, reject) => {
      const reader = new FileReaderCtor()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error || new Error('xlsx-file-read-failed'))
      reader.readAsArrayBuffer(file)
    })
  }

  function parseClassBlocks(grid) {
    const blocks = new Map()
    for (let row = 1; row <= MAX_ROWS; row++) {
      const heading = valueAt(grid, row, 1)
      if (typeof heading !== 'string') continue
      const match = /(?:comets?|cometas?).*class(?:e)?\s*([0-4])|class(?:e)?\s*([0-4])/i.exec(heading)
      if (!match) continue
      const classIndex = Number(match[1] ?? match[2])
      if (blocks.has(classIndex)) throw new Error(`duplicate-class-block:${classIndex}`)
      let headerRow = row + 1
      while (headerRow <= row + 4 && valueAt(grid, headerRow, 2) === null) headerRow++
      const treatments = []
      for (let column = 2; column <= MAX_COLUMNS; column++) {
        const treatment = valueAt(grid, headerRow, column)
        if (treatment === null || treatment === '') break
        treatments.push(String(treatment).replace(/�/g, 'µ').trim())
      }
      if (!treatments.length) throw new Error(`missing-treatment-headers:${classIndex}`)
      const gels = new Map()
      for (let dataRow = headerRow + 1; dataRow <= MAX_ROWS; dataRow++) {
        const label = valueAt(grid, dataRow, 1)
        if (typeof label !== 'string') {
          if (gels.size) break
          continue
        }
        const gelMatch = /^(?:gel|l[aâ]mina)\s*(\d+)$/i.exec(label)
        if (!gelMatch) {
          if (gels.size) break
          continue
        }
        const gelNumber = positiveInteger(gelMatch[1], 'invalid-gel-number')
        if (gels.has(gelNumber)) throw new Error(`duplicate-gel:${classIndex}:${gelNumber}`)
        gels.set(gelNumber, treatments.map((_, index) => ({
          value: valueAt(grid, dataRow, index + 2),
          formula: grid.formulas.has(`${dataRow}:${index + 2}`)
        })))
      }
      if (!gels.size) throw new Error(`missing-gel-rows:${classIndex}`)
      blocks.set(classIndex, { treatments, gels })
    }
    if (blocks.size !== 5 || [0, 1, 2, 3, 4].some(index => !blocks.has(index))) throw new Error('missing-class-block')
    return blocks
  }

  function validateBlocks(blocks) {
    const first = blocks.get(0)
    const treatments = first.treatments
    const gelNumbers = Array.from(first.gels.keys()).sort((a, b) => a - b)
    for (let index = 0; index < 5; index++) {
      const block = blocks.get(index)
      if (block.treatments.length !== treatments.length || block.treatments.some((item, treatmentIndex) => item !== treatments[treatmentIndex])) {
        throw new Error(`inconsistent-treatment-headers:${index}`)
      }
      const currentGels = Array.from(block.gels.keys()).sort((a, b) => a - b)
      if (currentGels.length !== gelNumbers.length || currentGels.some((item, gelIndex) => item !== gelNumbers[gelIndex])) {
        throw new Error(`inconsistent-gel-rows:${index}`)
      }
    }
    if (gelNumbers.some((value, index) => value !== index + 1)) throw new Error('non-sequential-gels')
    return { treatments, gelNumbers }
  }

  function extractEntries(blocks, treatments, gelNumbers, target) {
    const entries = []
    const mismatches = []
    for (const globalGelNumber of gelNumbers) {
      treatments.forEach((treatment, treatmentIndex) => {
        const cells = [0, 1, 2, 3, 4].map(classIndex => blocks.get(classIndex).gels.get(globalGelNumber)[treatmentIndex])
        if (cells.some(cell => cell.formula)) throw new Error(`formula-in-count:${globalGelNumber}:${treatmentIndex + 1}`)
        const values = cells.map(cell => cell.value)
        const empty = values.map(value => value === null || value === '')
        if (empty.every(Boolean)) {
          entries.push({ globalGelNumber, treatmentIndex, treatment, counts: null, total: null })
          return
        }
        if (empty.some(Boolean)) throw new Error(`partial-count:${globalGelNumber}:${treatmentIndex + 1}`)
        if (!values.every(value => Number.isInteger(value) && value >= 0)) throw new Error(`invalid-count:${globalGelNumber}:${treatmentIndex + 1}`)
        const total = values.reduce((sum, value) => sum + value, 0)
        entries.push({ globalGelNumber, treatmentIndex, treatment, counts: values, total })
        if (total !== target) mismatches.push({ globalGelNumber, treatmentIndex, treatment, total, target })
      })
    }
    return { entries, mismatches }
  }

  async function parse(file, dependencies = {}) {
    if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_XLSX_SIZE) throw new Error('invalid-xlsx-size')
    const Zip = dependencies.JSZip || globalThis.JSZip
    const DomParser = dependencies.DOMParser || globalThis.DOMParser
    const FileReaderCtor = dependencies.FileReader || globalThis.FileReader
    if (!Zip || !DomParser) throw new Error('xlsx-parser-unavailable')
    const zip = await Zip.loadAsync(await readFileBytes(file, FileReaderCtor))
    if (Object.keys(zip.files).length > 100) throw new Error('too-many-xlsx-entries')
    const workbook = parseXml(await readEntry(zip, 'xl/workbook.xml'), DomParser)
    const relationships = parseXml(await readEntry(zip, 'xl/_rels/workbook.xml.rels'), DomParser)
    const sheetPath = relationshipTarget(workbook, relationships, 'Comet Assay')
    const sharedSource = await readEntry(zip, 'xl/sharedStrings.xml', false)
    const sharedStrings = sharedSource
      ? Array.from(parseXml(sharedSource, DomParser).getElementsByTagName('si'), textContent)
      : []
    const worksheet = parseXml(await readEntry(zip, sheetPath), DomParser)
    const grid = worksheetCells(worksheet, sharedStrings)
    const researcher = metadataValue(grid, [/^(?:researcher|pesquisador(?:a)?):\s*(.*)$/i])
    const agent = metadataValue(grid, [/^(?:agent|agente):\s*(.*)$/i])
    const cells = metadataValue(grid, [/^(?:cell type|linhagem(?: celular)?|tipo celular):\s*(.*)$/i])
    const target = positiveInteger(metadataValue(grid, [/^(?:nucleoids counted\/gel|nucleoides contados\/gel):\s*(.*)$/i]), 'invalid-nucleoid-target')
    const slidesPerTreatment = positiveInteger(metadataValue(grid, [/^(?:gels\/experiment|geis\/experimento|l[aâ]minas\/experimento):\s*(.*)$/i]), 'invalid-slides-per-treatment')
    if (!agent) throw new Error('missing-agent')
    if (!cells) throw new Error('missing-cell-type')
    const blocks = parseClassBlocks(grid)
    const { treatments, gelNumbers } = validateBlocks(blocks)
    if (gelNumbers.length % slidesPerTreatment !== 0) throw new Error('gels-not-divisible-by-slides')
    const { entries, mismatches } = extractEntries(blocks, treatments, gelNumbers, target)
    const suggestions = treatments.map(label => parseConcentration(label))
    const units = Array.from(new Set(suggestions.filter(Boolean).map(item => item.unit)))
    return {
      fileName: String(file.name || ''), researcher, agent, cells, target, slidesPerTreatment,
      replicateCount: gelNumbers.length / slidesPerTreatment,
      treatments, entries, mismatches,
      absentCount: entries.filter(item => item.counts === null).length,
      suggestedUnit: units.length === 1 ? units[0] : '',
      concentrationSuggestions: suggestions
    }
  }

  function blindBase(index) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if (!Number.isInteger(index) || index < 0 || index >= alphabet.length ** 2) throw new Error('too-many-imported-treatment-blocks')
    return `${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}`
  }

  function buildExperiment(parsed, configuration, createId, now = new Date().toISOString()) {
    const roles = configuration?.roles
    if (!Array.isArray(roles) || roles.length !== parsed.treatments.length) throw new Error('invalid-treatment-roles')
    const allowedRoles = new Set(['positive-control', 'negative-control', 'solvent-control', 'test-concentration', 'other'])
    if (roles.some(item => !item || !allowedRoles.has(item.role))) throw new Error('invalid-treatment-roles')
    for (const role of ['positive-control', 'negative-control', 'solvent-control']) {
      if (roles.filter(item => item.role === role).length > 1) throw new Error(`duplicate-${role}`)
    }
    const concentrationRoles = roles.filter(item => item.role === 'test-concentration')
    if (!concentrationRoles.length || concentrationRoles.some(item => !Number.isFinite(item.concentration) || item.concentration < 0)) throw new Error('invalid-imported-concentrations')
    if (roles.filter(item => item.role === 'positive-control').length !== 1) throw new Error('positive-control-required')
    if (!roles.some(item => item.role === 'negative-control' || item.role === 'solvent-control')) throw new Error('basal-control-required')
    const unit = String(configuration.unit || '').trim()
    if (!unit) throw new Error('unit-required')

    const roleLabel = role => {
      const index = roles.findIndex(item => item.role === role)
      return index >= 0 ? parsed.treatments[index] : ''
    }
    const experiment = {
      schemaVersion: CometQuantCore.SCHEMA_VERSION,
      id: createId(),
      createdAt: now,
      updatedAt: now,
      status: 'completed',
      researcher: parsed.researcher,
      agent: parsed.agent,
      cells: parsed.cells,
      negControl: roleLabel('negative-control'),
      posControl: roleLabel('positive-control'),
      solControl: roleLabel('solvent-control'),
      nucleoidsPerGel: parsed.target,
      slidesPerTreatment: parsed.slidesPerTreatment,
      concUnit: unit,
      treatments: parsed.treatments.slice(),
      treatmentMetadata: roles.map((item, treatmentIndex) => ({
        treatmentIndex,
        role: item.role,
        concentration: item.role === 'test-concentration' ? item.concentration : null
      })),
      studyDesign: {
        version: 1, status: 'unconfigured', assayType: null, primaryReferenceTreatmentIndex: null,
        primaryTreatmentIndices: [], validationComparison: null, alpha: 0.05, alternative: 'two-sided',
        pAdjustment: 'holm', trendReferenceAsZero: true, configurationSource: null
      },
      slideEditHistory: [],
      replicates: [],
      progress: null,
      provenance: {
        source: 'legacy-comet-visualscore-xlsx',
        importedAt: now,
        sourceFileName: parsed.fileName
      }
    }
    for (let replicateNumber = 1; replicateNumber <= parsed.replicateCount; replicateNumber++) {
      const replicate = { replicateNumber, date: null, createdAt: now, updatedAt: now, assignments: [], gels: [] }
      parsed.treatments.forEach((treatment, treatmentIndex) => {
        const base = blindBase((replicateNumber - 1) * parsed.treatments.length + treatmentIndex)
        for (let gelNumber = 1; gelNumber <= parsed.slidesPerTreatment; gelNumber++) {
          const globalGelNumber = (replicateNumber - 1) * parsed.slidesPerTreatment + gelNumber
          const source = parsed.entries.find(item => item.globalGelNumber === globalGelNumber && item.treatmentIndex === treatmentIndex)
          const blindCode = `${base}${gelNumber}`
          if (!source || source.counts === null) {
            replicate.assignments.push({
              blindCode, treatmentIndex, gelNumber, status: 'absent',
              absenceReason: { code: 'legacy-unjustified', detail: '' }
            })
            continue
          }
          replicate.assignments.push({ blindCode, treatmentIndex, gelNumber, status: 'counted' })
          const gel = {
            blindCode, treatment, treatmentIndex, gelNumber,
            class0: source.counts[0], class1: source.counts[1], class2: source.counts[2],
            class3: source.counts[3], class4: source.counts[4], total: source.total,
            status: 'counted', completion: source.total === parsed.target ? 'complete' : 'incomplete'
          }
          if (gel.completion === 'incomplete') gel.incompleteReason = { code: 'legacy-unjustified', detail: '' }
          replicate.gels.push(gel)
        }
      })
      experiment.replicates.push(replicate)
    }
    return experiment
  }

  return { MAX_XLSX_SIZE, parse, parseConcentration, buildExperiment }
})
