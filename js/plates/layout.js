(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantPlatesLayout = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function naturalCompare(left, right) {
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
  }

  function empty(rowValue = null, colValue = null) {
    return { empty: true, rowValue, colValue }
  }

  function chunks(values, size) {
    const result = []
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
    return result
  }

  function field(report, name) {
    const value = name === 'agentCell' ? `${report.agent}\u0000${report.cellType}` : report[name]
    if (value === null || value === undefined || !String(value).trim()) throw new Error(`${report.filename}: campo ${name} ausente para o pareamento`)
    return value
  }

  function orderedValues(values, preferred) {
    const unique = Array.from(new Set(values))
    if (new Set(preferred).size !== preferred.length) throw new Error('A ordem de categorias contém valores duplicados.')
    preferred.forEach(value => { if (!unique.includes(value)) throw new Error(`Categoria prioritária não encontrada: ${value}`) })
    return preferred.concat(unique.filter(value => !preferred.includes(value)).sort(naturalCompare))
  }

  function buildPages(reports, config) {
    const rows = Number(config.rows)
    const cols = Number(config.cols)
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) throw new Error('Linhas e colunas devem ser inteiros maiores que zero.')
    let pairing = config.pairing || 'none'
    let ordered
    const order = config.reportOrder || []
    if (order.length) {
      if (order.length !== reports.length || new Set(order).size !== order.length) throw new Error('A ordem manual deve listar todos os relatórios uma única vez.')
      const byId = new Map(reports.map(report => [report.id, report]))
      ordered = order.map(id => {
        if (!byId.has(id)) throw new Error(`Relatório da ordem manual não encontrado: ${id}`)
        return byId.get(id)
      })
      pairing = 'none'
    } else if (pairing === 'none') {
      ordered = reports.slice().sort((a, b) => naturalCompare(a.agent, b.agent) || naturalCompare(a.cellType, b.cellType) || naturalCompare(a.filename, b.filename))
    }
    if (pairing === 'none') {
      const capacity = rows * cols
      if (reports.length > capacity && config.overflow === 'error') throw new Error(`A grade comporta ${capacity} relatórios, mas ${reports.length} foram encontrados.`)
      const groups = config.overflow === 'paginate' ? chunks(ordered, capacity) : [ordered.slice(0, capacity)]
      return groups.map(group => {
        const flat = group.concat(Array.from({ length: capacity - group.length }, () => empty()))
        return chunks(flat, cols)
      })
    }
    const fields = { linhagem: ['agent', 'cellType'], composto: ['cellType', 'agent'], s9: ['agentCell', 's9'] }[pairing]
    if (!fields) throw new Error(`Pareamento desconhecido: ${pairing}`)
    const [rowField, colField] = fields
    const rowValues = Array.from(new Set(reports.map(report => field(report, rowField)))).sort(naturalCompare)
    const colValues = orderedValues(reports.map(report => String(field(report, colField))), config.pairOrder || [])
    if (colValues.length > cols) throw new Error(`O pareamento requer ${colValues.length} colunas, mas a grade possui ${cols}.`)
    if (rowValues.length > rows && config.overflow === 'error') throw new Error(`O pareamento requer ${rowValues.length} linhas, mas a grade possui ${rows}.`)
    const positions = new Map()
    reports.forEach(report => {
      const key = `${field(report, rowField)}\u0001${field(report, colField)}`
      if (positions.has(key)) throw new Error(`Relatórios duplicados para a mesma célula: ${positions.get(key).filename} e ${report.filename}.`)
      positions.set(key, report)
    })
    const pages = (config.overflow === 'paginate' ? chunks(rowValues, rows) : [rowValues.slice(0, rows)]).map(group => {
      const page = group.map(rowValue => colValues.map(colValue => positions.get(`${rowValue}\u0001${colValue}`) || empty(rowValue, colValue)).concat(Array.from({ length: cols - colValues.length }, () => empty())))
      while (page.length < rows) page.push(Array.from({ length: cols }, () => empty()))
      return page
    })
    if (config.missing === 'error') {
      const absent = pages.flat(2).filter(item => item.empty).length
      if (absent) throw new Error(`A matriz possui ${absent} célula(s) sem relatório.`)
    }
    return pages
  }

  function panelLetter(index, letterCase) {
    let value = index + 1
    let label = ''
    while (value) {
      value -= 1
      label = String.fromCharCode(65 + value % 26) + label
      value = Math.floor(value / 26)
    }
    return letterCase === 'lower' ? label.toLowerCase() : label
  }

  function treatmentIdentity(item) {
    if (!item) return ''
    if (item.id) return String(item.id)
    if (Number.isInteger(item.treatmentIndex)) return `treatment:${item.treatmentIndex}`
    return `label:${String(item.label || '').trim().toLowerCase()}`
  }

  function sameTreatment(left, right) {
    return Boolean(left && right && treatmentIdentity(left) === treatmentIdentity(right))
  }

  function displayTreatments(report, config = {}) {
    const treatments = (report.treatments || []).slice()
    const supplemental = config.positiveControl !== 'none' ? report.positiveControl : null
    if (supplemental && !treatments.some(item => sameTreatment(item, supplemental))) treatments.push(supplemental)
    return treatments
  }

  function upperLimit(page, config = {}) {
    let highest = 100
    page.flat().filter(item => !item.empty).forEach(report => {
      displayTreatments(report, config).forEach(item => {
        if (!Number.isFinite(item.mean)) return
        const sd = Number.isFinite(item.sd) ? item.sd : 0
        const supplemental = sameTreatment(item, report.positiveControl)
        const marker = supplemental ? config.positiveControlMarker === 'dagger' && report.positiveControlSignificant : item.isSignificant
        highest = Math.max(highest, item.mean + sd + (marker ? 5 : 0))
      })
    })
    let upper = Math.ceil(highest / 5) * 5
    if (upper > 100 && Math.abs(upper - highest) < 1e-9) upper += 5
    return upper
  }

  function summary(pages, config = {}) {
    const noReport = config.language === 'en' ? 'No report' : 'Sem relatório'
    return pages.flatMap((page, pageIndex) => {
      let labelIndex = 0
      return page.flatMap((row, rowIndex) => row.map((report, colIndex) => {
        if (report.empty) return { page: pageIndex + 1, row: rowIndex + 1, col: colIndex + 1, letter: '', filename: '', panel: noReport, significant: '' }
        const letter = config.panelLabels && config.panelLabels !== 'none' ? panelLetter(labelIndex, config.panelLabels) : ''
        labelIndex += 1
        return { page: pageIndex + 1, row: rowIndex + 1, col: colIndex + 1, letter, filename: report.filename, panel: report.title, significant: report.treatments.filter(item => item.isSignificant).map(item => item.label).join(', ') }
      }))
    })
  }

  return { naturalCompare, buildPages, panelLetter, treatmentIdentity, sameTreatment, displayTreatments, upperLimit, summary }
})
