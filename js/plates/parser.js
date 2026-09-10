(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantPlatesParser = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const HEADER_ALIASES = {
    treatment: ['tratamento', 'treatment'],
    reference: ['referencia', 'reference'],
    role: ['papel', 'role'],
    concentration: ['concentracao', 'concentration'],
    replicate: ['repeticao', 'replicate', 'independent experiment'],
    visualScore: ['score visual', 'visual score'],
    engineMean: ['media do motor', 'engine mean'],
    mean: ['media', 'mean'],
    sd: ['dp', 'desvio padrao', 'sd', 'standard deviation'],
    n: ['n (experimentos independentes)', 'n (independent experiments)'],
    pHolm: ['p holm', 'holm p'],
    result: ['resultado estatistico', 'statistical result']
  }

  const ROLE_MAP = {
    'controle negativo': 'negative_control',
    'negative control': 'negative_control',
    'negative-control': 'negative_control',
    'negative_control': 'negative_control',
    'controle positivo': 'positive_control',
    'positive control': 'positive_control',
    'positive-control': 'positive_control',
    'positive_control': 'positive_control',
    'controle do solvente': 'solvent_control',
    'controle solvente': 'solvent_control',
    'solvent control': 'solvent_control',
    'vehicle control': 'solvent_control',
    'solvent-control': 'solvent_control',
    'solvent_control': 'solvent_control',
    'concentracao teste': 'test',
    'test concentration': 'test',
    'test-concentration': 'test',
    test: 'test'
  }

  const BASAL_ROLES = new Set(['negative_control', 'solvent_control'])
  const LEGACY_ROUNDING_TOLERANCE = 0.013

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function normalizeAssayType(value) {
    const key = normalize(value)
    if (key === 'genotoxicity' || key === 'genotoxicidade') return 'genotoxicity'
    if (key === 'antigenotoxicity' || key === 'antigenotoxicidade') return 'antigenotoxicity'
    return null
  }

  function fail(filename, message) {
    throw new Error(`${filename}: ${message}`)
  }

  function finiteNumber(value, field, filename) {
    const number = Number(String(value).trim().replace(',', '.'))
    if (!Number.isFinite(number)) fail(filename, `valor inválido em ${field}: ${JSON.stringify(value)}`)
    return number
  }

  function optionalNumber(value, field, filename) {
    const key = normalize(value)
    if (!key || ['-', '—', 'nao estimavel', 'not estimable', 'nao determinado', 'not determined'].includes(key)) return null
    return finiteNumber(value, field, filename)
  }

  function integerAttribute(node, name, filename) {
    const value = node?.getAttribute(name)
    if (value === null || value === '') return null
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0) fail(filename, `atributo ${name} inválido: ${JSON.stringify(value)}`)
    return number
  }

  function tableData(table, filename) {
    const headers = Array.from(table.querySelectorAll('thead th'), cell => cell.textContent.trim())
    const rows = Array.from(table.querySelectorAll('tbody > tr'), element => {
      const cells = Array.from(element.children).filter(cell => cell.tagName.toLowerCase() === 'td')
      if (cells.length !== headers.length) fail(filename, `tabela com ${cells.length} células; esperado: ${headers.length}`)
      return { values: Object.fromEntries(headers.map((header, index) => [header, cells[index].textContent.trim()])), element }
    })
    return { headers, rows }
  }

  function columns(headers, required, filename, section) {
    const normalized = new Map(headers.map(header => [normalize(header), header]))
    const result = {}
    required.forEach(field => {
      const alias = HEADER_ALIASES[field].find(item => normalized.has(item))
      if (!alias) fail(filename, `cabeçalho ausente em ${section}: ${HEADER_ALIASES[field][0]}`)
      result[field] = normalized.get(alias)
    })
    return result
  }

  function optionalColumn(headers, field) {
    const normalized = new Map(headers.map(header => [normalize(header), header]))
    const alias = HEADER_ALIASES[field].find(item => normalized.has(item))
    return alias ? normalized.get(alias) : null
  }

  function concentrationParts(text, label) {
    const value = String(text || '').trim()
    if (!value || value === '-' || value === '—') return { concentration: null, concentrationUnit: null }
    const pattern = /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(.*?)\s*$/
    const match = value.match(pattern)
    if (!match) return { concentration: null, concentrationUnit: null }
    const concentration = Number(match[1].replace(',', '.'))
    let unit = match[2].trim()
    if (!unit) unit = String(label || '').match(pattern)?.[2]?.trim() || ''
    if (!Number.isFinite(concentration) || !unit) return { concentration: null, concentrationUnit: null }
    return { concentration, concentrationUnit: unit.replace(/\s+/g, ' ').replace(/μ/g, 'µ') }
  }

  function sampleSd(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
  }

  function treatmentId(treatmentIndex, label) {
    return Number.isInteger(treatmentIndex) ? `treatment:${treatmentIndex}` : `label:${normalize(label)}`
  }

  function metadataFromDocument(document) {
    const metadata = new Map()
    document.querySelectorAll('header .metadata p, header .meta p, header p').forEach(node => {
      const text = node.textContent.trim()
      const separator = text.indexOf(':')
      if (separator >= 0) metadata.set(normalize(text.slice(0, separator)), text.slice(separator + 1).trim())
    })
    return {
      agent: metadata.get('agente') || metadata.get('agent') || '',
      cellType: metadata.get('tipo celular') || metadata.get('linhagem') || metadata.get('cell type') || ''
    }
  }

  function protocolMetadata(document, filename) {
    const result = { assayType: null, primaryReferenceTreatmentIndex: null, primaryReferenceTreatment: '', validationReferenceTreatmentIndex: null, validationTreatmentIndex: null, source: null }
    const nodes = document.querySelectorAll('section#dose-overview, section#primary-means, section#control, section#protocol, .dose-chart, .column-chart')
    nodes.forEach(node => {
      const assayType = normalizeAssayType(node.getAttribute('data-assay-type'))
      if (assayType && result.assayType && result.assayType !== assayType) fail(filename, 'metadados data-assay-type divergentes')
      if (assayType && !result.assayType) result.assayType = assayType
      ;[
        ['data-primary-reference', 'primaryReferenceTreatmentIndex'],
        ['data-validation-reference', 'validationReferenceTreatmentIndex'],
        ['data-validation-treatment', 'validationTreatmentIndex']
      ].forEach(([attribute, field]) => {
        const value = integerAttribute(node, attribute, filename)
        if (value !== null && result[field] !== null && result[field] !== value) fail(filename, `metadados ${attribute} divergentes`)
        if (value !== null && result[field] === null) result[field] = value
      })
    })
    if (result.assayType || result.primaryReferenceTreatmentIndex !== null || result.validationReferenceTreatmentIndex !== null || result.validationTreatmentIndex !== null) result.source = 'data-attributes'

    const protocol = document.querySelector('section#protocol table')
    if (!protocol) return result
    const entries = new Map(Array.from(protocol.querySelectorAll('tbody > tr'), row => {
      const cells = row.querySelectorAll('td')
      return cells.length >= 2 ? [normalize(cells[0].textContent), cells[1].textContent.trim()] : null
    }).filter(Boolean))
    const protocolAssayType = normalizeAssayType(entries.get('tipo de ensaio') || entries.get('assay type'))
    if (protocolAssayType && result.assayType && protocolAssayType !== result.assayType) fail(filename, 'tipo de ensaio do protocolo diverge dos metadados estruturados')
    if (!result.assayType) result.assayType = protocolAssayType
    result.primaryReferenceTreatment = entries.get('tratamento de referencia principal') || entries.get('primary reference treatment') || ''
    const validation = entries.get('comparacao de validacao') || entries.get('validation comparison') || ''
    const match = validation.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
    if (match) {
      if (result.validationReferenceTreatmentIndex !== null && result.validationReferenceTreatmentIndex !== Number(match[1])) fail(filename, 'referência da validação diverge entre protocolo e metadados estruturados')
      if (result.validationTreatmentIndex !== null && result.validationTreatmentIndex !== Number(match[2])) fail(filename, 'tratamento da validação diverge entre protocolo e metadados estruturados')
      if (result.validationReferenceTreatmentIndex === null) result.validationReferenceTreatmentIndex = Number(match[1])
      if (result.validationTreatmentIndex === null) result.validationTreatmentIndex = Number(match[2])
    }
    if (!result.source && (result.assayType || result.primaryReferenceTreatment || match)) result.source = 'protocol'
    return result
  }

  function inferReferenceRole(document) {
    try {
      const primaryTable = document.querySelector('section#primary-means tbody')
      const doseTable = document.querySelector('section#dose-overview div.sr-only table')
      if (!primaryTable || !doseTable) return null
      const referenceRow = Array.from(primaryTable.querySelectorAll(':scope > tr')).find(row => {
        if (row.getAttribute('data-primary-reference') === 'true') return true
        return Array.from(row.querySelectorAll('td')).some(cell => ['referencia', 'reference'].includes(normalize(cell.textContent)))
      })
      const label = referenceRow?.querySelector('td')?.textContent.trim()
      if (!label) return null
      const { headers, rows } = tableData(doseTable, 'relatório.html')
      const names = columns(headers, ['treatment', 'role'], 'relatório.html', 'dose-overview')
      const row = rows.find(item => normalize(item.values[names.treatment]) === normalize(label))
      return ROLE_MAP[normalize(row?.values[names.role])] || null
    } catch (_) {
      return null
    }
  }

  function detectMetadata(html, dependencies = {}) {
    const Parser = dependencies.DOMParser || globalThis.DOMParser
    if (!Parser) throw new Error('DOMParser indisponível')
    const document = new Parser().parseFromString(String(html), 'text/html')
    const metadata = metadataFromDocument(document)
    const design = protocolMetadata(document, 'relatório.html')
    const role = inferReferenceRole(document)
    const inferredAssayType = role === 'positive_control' ? 'antigenotoxicity' : BASAL_ROLES.has(role) ? 'genotoxicity' : null
    return { ...metadata, assayType: design.assayType || inferredAssayType || '', designSource: design.source }
  }

  function doseStats(document, filename) {
    const tables = document.querySelectorAll('section#dose-overview div.sr-only table')
    if (tables.length !== 1) fail(filename, `esperado 1 conjunto de dados em dose-overview; encontrados ${tables.length}`)
    const { headers, rows } = tableData(tables[0], filename)
    const names = columns(headers, ['treatment', 'role', 'concentration', 'replicate', 'visualScore', 'engineMean'], filename, 'dose-overview')
    const grouped = new Map()
    rows.forEach(({ values: row, element }) => {
      const label = row[names.treatment]
      const visibleRole = ROLE_MAP[normalize(row[names.role])]
      const structuredRole = ROLE_MAP[normalize(element.getAttribute('data-role'))]
      if (structuredRole && visibleRole && structuredRole !== visibleRole) fail(filename, `papel divergente para ${JSON.stringify(label)} entre tabela e metadados estruturados`)
      const role = structuredRole || visibleRole
      if (!role) fail(filename, `papel desconhecido para ${JSON.stringify(label)}: ${JSON.stringify(row[names.role])}`)
      const treatmentIndex = integerAttribute(element, 'data-treatment-index', filename)
      const id = treatmentId(treatmentIndex, label)
      const population = element.getAttribute('data-population') || null
      const concentration = concentrationParts(row[names.concentration], label)
      const current = grouped.get(id) || { id, treatmentIndex, label, role, population, ...concentration, scores: [], means: [], replicates: new Set() }
      if (current.role !== role || current.population !== population || current.concentration !== concentration.concentration || current.concentrationUnit !== concentration.concentrationUnit || normalize(current.label) !== normalize(label)) fail(filename, `metadados inconsistentes para ${JSON.stringify(label)}`)
      const replicate = optionalNumber(row[names.replicate], 'Repetição', filename)
      if (!Number.isInteger(replicate) || replicate < 1) fail(filename, `repetição inválida para ${JSON.stringify(label)}`)
      if (current.replicates.has(replicate)) fail(filename, `repetição duplicada para ${JSON.stringify(label)}: ${replicate}`)
      current.replicates.add(replicate)
      const score = optionalNumber(row[names.visualScore], 'Score visual', filename)
      const mean = optionalNumber(row[names.engineMean], 'Média do motor', filename)
      if ((score !== null && (score < 0 || score > 100)) || (mean !== null && (mean < 0 || mean > 100))) fail(filename, `score ou média fora do intervalo para ${JSON.stringify(label)}`)
      if (score !== null) current.scores.push(score)
      if (mean !== null) current.means.push(mean)
      grouped.set(id, current)
    })
    const groups = Array.from(grouped.values()).map(group => {
      if (group.means.some(value => Math.abs(value - group.means[0]) > 1e-12)) fail(filename, `médias do motor divergentes para ${JSON.stringify(group.label)}`)
      const mean = group.means.length ? group.means[0] : group.scores.length ? group.scores.reduce((sum, value) => sum + value, 0) / group.scores.length : null
      const sd = group.scores.length > 1 ? sampleSd(group.scores) : null
      return { ...group, replicates: Array.from(group.replicates), mean, sd, n: group.scores.length }
    })
    const indexedGroups = groups.filter(group => Number.isInteger(group.treatmentIndex)).length
    if (indexedGroups > 0 && indexedGroups !== groups.length) fail(filename, 'data-treatment-index deve estar presente em todos os tratamentos de dose-overview ou em nenhum')
    const byIndex = new Map(groups.filter(group => Number.isInteger(group.treatmentIndex)).map(group => [group.treatmentIndex, group]))
    const byLabel = new Map()
    groups.forEach(group => {
      const key = normalize(group.label)
      if (byLabel.has(key) && byLabel.get(key).id !== group.id) fail(filename, `rótulo de tratamento ambíguo: ${JSON.stringify(group.label)}`)
      byLabel.set(key, group)
    })
    return { groups, byIndex, byLabel }
  }

  function svgMarkers(section, count, filename) {
    const svg = section.querySelector('div.column-chart > svg')
    if (!svg) fail(filename, 'SVG de médias não encontrado')
    const bars = Array.from(svg.querySelectorAll('rect.column-bar'))
    if (bars.length !== count) fail(filename, `o SVG tem ${bars.length} barras, mas a tabela tem ${count} linhas`)
    const markerX = Array.from(svg.querySelectorAll('text.holm-marker')).filter(node => node.textContent.trim() === '*').map(node => finiteNumber(node.getAttribute('x'), 'x do marcador', filename))
    return bars.map(bar => {
      const center = finiteNumber(bar.getAttribute('x'), 'x da barra', filename) + finiteNumber(bar.getAttribute('width'), 'largura da barra', filename) / 2
      return markerX.some(x => Math.abs(center - x) <= 0.000001)
    })
  }

  function controlComparison(document, filename) {
    const tables = document.querySelectorAll('section#control table')
    if (tables.length !== 1) return null
    const { headers, rows } = tableData(tables[0], filename)
    let names
    try { names = columns(headers, ['treatment', 'result'], filename, 'control') } catch (_) { return null }
    const referenceName = optionalColumn(headers, 'reference')
    const row = rows.find(item => ['significativo', 'significant', 'nao significativo', 'not significant'].includes(normalize(item.values[names.result])))
    if (!row) return null
    return {
      referenceLabel: referenceName ? row.values[referenceName] : '',
      treatmentLabel: row.values[names.treatment],
      referenceTreatmentIndex: integerAttribute(row.element, 'data-validation-reference', filename),
      treatmentIndex: integerAttribute(row.element, 'data-validation-treatment', filename),
      significant: ['significativo', 'significant'].includes(normalize(row.values[names.result]))
    }
  }

  function findTreatment(stats, treatmentIndex, label) {
    if (Number.isInteger(treatmentIndex) && stats.byIndex.size) return stats.byIndex.get(treatmentIndex) || null
    return label ? stats.byLabel.get(normalize(label)) || null : null
  }

  function parseReport(html, options = {}, dependencies = {}) {
    const filename = options.filename || 'relatório.html'
    const Parser = dependencies.DOMParser || globalThis.DOMParser
    if (!Parser) throw new Error('DOMParser indisponível')
    const document = new Parser().parseFromString(String(html), 'text/html')
    const detected = metadataFromDocument(document)
    const agent = String(options.agent || detected.agent).trim()
    const cellType = String(options.cellType || detected.cellType).trim()
    if (!agent || !cellType) fail(filename, 'metadados de agente e tipo celular não foram encontrados')
    const design = protocolMetadata(document, filename)
    const selectedAssayType = normalizeAssayType(options.assayType)
    if (design.assayType && selectedAssayType && design.assayType !== selectedAssayType) fail(filename, 'tipo de ensaio informado diverge dos metadados do relatório')
    const replicateStats = doseStats(document, filename)
    const section = document.querySelector('section#primary-means')
    if (!section) fail(filename, 'section#primary-means não encontrada')
    const tables = section.querySelectorAll('div.column-chart div.sr-only table')
    if (tables.length !== 1) fail(filename, `esperado 1 conjunto de dados acessíveis; encontrados ${tables.length}`)
    const { headers, rows } = tableData(tables[0], filename)
    const names = columns(headers, ['treatment', 'mean', 'sd', 'n', 'pHolm', 'result'], filename, 'primary-means')
    const markers = svgMarkers(section, rows.length, filename)
    const treatments = rows.map(({ values: row, element }, index) => {
      const label = row[names.treatment]
      const treatmentIndex = integerAttribute(element, 'data-treatment-index', filename)
      const stats = findTreatment(replicateStats, treatmentIndex, label)
      if (!stats && (treatmentIndex === null || replicateStats.byIndex.size)) fail(filename, `tratamento ${JSON.stringify(label)} ausente em dose-overview`)
      if (stats && normalize(stats.label) !== normalize(label)) fail(filename, `identidade ${treatmentIndex} associa rótulos divergentes entre primary-means e dose-overview`)
      const resultText = row[names.result]
      const resultKey = normalize(resultText)
      const significant = ['significativo', 'significant'].includes(resultKey)
      const reference = element.getAttribute('data-primary-reference') === 'true' || ['referencia', 'reference'].includes(resultKey)
      if (significant !== markers[index]) fail(filename, `divergência de significância para ${JSON.stringify(label)} entre tabela e SVG`)
      const rowMean = optionalNumber(row[names.mean], 'Média', filename)
      const rowSd = optionalNumber(row[names.sd], 'DP', filename)
      const mean = rowMean ?? stats?.mean ?? null
      const sd = rowSd ?? stats?.sd ?? null
      const nValue = optionalNumber(row[names.n], 'n', filename)
      const n = nValue ?? stats?.n ?? 0
      if (!Number.isInteger(n) || n < 1) fail(filename, `n inválido em ${JSON.stringify(label)}`)
      if (Number.isInteger(stats?.n) && n !== stats.n) fail(filename, `n divergente para ${JSON.stringify(label)} entre primary-means e dose-overview`)
      if (rowMean !== null && Number.isFinite(stats?.mean) && Math.abs(stats.mean - rowMean) > LEGACY_ROUNDING_TOLERANCE) fail(filename, `divergência de média para ${JSON.stringify(label)} entre primary-means e dose-overview`)
      if (rowSd !== null && Number.isFinite(stats?.sd) && Math.abs(stats.sd - rowSd) > LEGACY_ROUNDING_TOLERANCE) fail(filename, `divergência de DP para ${JSON.stringify(label)} entre primary-means e dose-overview`)
      if ((mean !== null && (mean < 0 || mean > 100)) || (sd !== null && sd < 0)) fail(filename, `média ou DP fora do intervalo em ${JSON.stringify(label)}`)
      if (significant && mean === null) fail(filename, `resultado significativo sem média estimável em ${JSON.stringify(label)}`)
      const resolvedIndex = treatmentIndex ?? stats?.treatmentIndex ?? null
      const role = ROLE_MAP[normalize(element.getAttribute('data-role'))] || stats?.role || null
      if (ROLE_MAP[normalize(element.getAttribute('data-role'))] && stats?.role && ROLE_MAP[normalize(element.getAttribute('data-role'))] !== stats.role) fail(filename, `papel divergente para ${JSON.stringify(label)} entre primary-means e dose-overview`)
      return {
        id: treatmentId(resolvedIndex, label), treatmentIndex: resolvedIndex, label, mean, sd, n,
        pHolm: row[names.pHolm], result: resultText, isReference: reference, isSignificant: significant,
        role, concentration: stats?.concentration ?? null, concentrationUnit: stats?.concentrationUnit ?? null
      }
    })
    const references = treatments.filter(item => item.isReference)
    const indexedTreatments = treatments.filter(item => Number.isInteger(item.treatmentIndex)).length
    if (indexedTreatments > 0 && indexedTreatments !== treatments.length) fail(filename, 'data-treatment-index deve estar presente em todos os tratamentos de primary-means ou em nenhum')
    if (Boolean(indexedTreatments) !== Boolean(replicateStats.byIndex.size)) fail(filename, 'identidades estruturadas devem estar presentes conjuntamente em primary-means e dose-overview')
    if (references.length !== 1) fail(filename, `esperado 1 tratamento de referência; encontrados ${references.length}`)
    const reference = references[0]
    if (design.primaryReferenceTreatmentIndex !== null && reference.treatmentIndex !== null && design.primaryReferenceTreatmentIndex !== reference.treatmentIndex) fail(filename, 'referência principal diverge entre a tabela e os metadados estruturados')
    if (design.primaryReferenceTreatment && normalize(design.primaryReferenceTreatment) !== normalize(reference.label)) fail(filename, 'nome da referência principal diverge entre o protocolo e primary-means')
    const inferredAssayType = reference.role === 'positive_control' ? 'antigenotoxicity' : BASAL_ROLES.has(reference.role) ? 'genotoxicity' : null
    const assayType = design.assayType || selectedAssayType || inferredAssayType
    if (!assayType) fail(filename, 'tipo de ensaio ambíguo; confirme genotoxicidade ou antigenotoxicidade no gerador')
    if (assayType === 'genotoxicity' && !BASAL_ROLES.has(reference.role)) fail(filename, 'referência de genotoxicidade não corresponde ao controle negativo ou de solvente')
    if (assayType === 'antigenotoxicity' && reference.role !== 'positive_control') fail(filename, 'referência de antigenotoxicidade não corresponde ao controle positivo')

    const primaryIds = new Set(treatments.map(item => item.id))
    const comparison = controlComparison(document, filename)
    if (design.validationReferenceTreatmentIndex !== null && Number.isInteger(comparison?.referenceTreatmentIndex) && design.validationReferenceTreatmentIndex !== comparison.referenceTreatmentIndex) fail(filename, 'referência da validação diverge entre control e protocolo')
    if (design.validationTreatmentIndex !== null && Number.isInteger(comparison?.treatmentIndex) && design.validationTreatmentIndex !== comparison.treatmentIndex) fail(filename, 'tratamento da validação diverge entre control e protocolo')
    const validationReferenceIndex = design.validationReferenceTreatmentIndex ?? comparison?.referenceTreatmentIndex ?? null
    const validationTreatmentIndex = design.validationTreatmentIndex ?? comparison?.treatmentIndex ?? null
    const validationReference = findTreatment(replicateStats, validationReferenceIndex, comparison?.referenceLabel)
    const validationTreatment = findTreatment(replicateStats, validationTreatmentIndex, comparison?.treatmentLabel)
    if (validationReference && comparison?.referenceLabel && normalize(validationReference.label) !== normalize(comparison.referenceLabel)) fail(filename, 'rótulo da referência da validação diverge de seu índice estruturado')
    if (validationTreatment && comparison?.treatmentLabel && normalize(validationTreatment.label) !== normalize(comparison.treatmentLabel)) fail(filename, 'rótulo do tratamento da validação diverge de seu índice estruturado')
    let validationParticipants = [validationReference, validationTreatment].filter(Boolean)
    if (!validationParticipants.length) {
      const expectedRole = assayType === 'genotoxicity' ? 'positive_control' : null
      validationParticipants = replicateStats.groups.filter(item => !primaryIds.has(item.id) && (expectedRole ? item.role === expectedRole : BASAL_ROLES.has(item.role)))
    }
    validationParticipants = Array.from(new Map(validationParticipants.map(item => [item.id, item])).values())
    const supplemental = validationParticipants.filter(item => !primaryIds.has(item.id))
    if (supplemental.length > 1) fail(filename, 'comparação de validação ambígua; confirme o tratamento suplementar em um relatório com metadados estruturados')
    const positiveControl = supplemental[0] ? { ...supplemental[0], isReference: false, isSignificant: false } : null
    const validationIndices = new Set([validationReferenceIndex, validationTreatmentIndex].filter(Number.isInteger))
    const validationLabels = new Set([comparison?.referenceLabel, comparison?.treatmentLabel].map(normalize).filter(Boolean))
    const validationTreatmentIds = Array.from(new Set([
      ...validationParticipants.map(item => item.id),
      ...treatments.filter(item => validationIndices.has(item.treatmentIndex) || validationLabels.has(normalize(item.label))).map(item => item.id)
    ]))
    return {
      id: options.id || filename,
      filename,
      agent,
      cellType,
      s9: String(options.s9 || '').trim(),
      title: [agent, cellType, String(options.s9 || '').trim()].filter(Boolean).join(' - '),
      assayType,
      treatments,
      primaryTreatmentIds: Array.from(primaryIds),
      validationTreatmentIds,
      supplementalTreatmentId: positiveControl?.id || null,
      positiveControl,
      referenceMean: reference.mean,
      positiveControlSignificant: comparison?.significant ?? null
    }
  }

  return { normalize, concentrationParts, detectMetadata, parseReport, sampleSd }
})
