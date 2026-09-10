(function (root, factory) {
  const api = factory(root.CometQuantPlatesLayout, root.CometQuantPlatesTiff)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantPlatesRenderer = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Layout, Tiff) {
  'use strict'

  const TEXT = {
    'pt-BR': { y: 'Escore', x: 'Tratamentos', control: 'Ctrl', missing: 'não determinado' },
    en: { y: 'Score', x: 'Treatments', control: 'Ctrl', missing: 'not determined' }
  }

  function localizedNumber(value, language) {
    return String(value).replace(/(?<=\d)[.,](?=\d)/g, language === 'pt-BR' ? ',' : '.')
  }

  function treatmentLabel(item, language, assayType) {
    if (item.isReference && assayType !== 'antigenotoxicity') return TEXT[language].control
    if (item.role === 'test' && item.concentration !== null && item.concentrationUnit) {
      const concentration = Number(item.concentration)
      const value = Number.isInteger(concentration) ? concentration.toFixed(1) : String(concentration)
      return `${localizedNumber(value, language)}\n${item.concentrationUnit}`
    }
    return localizedNumber(item.label, language).replace(/\s+([µμ]M)$/i, '\n$1')
  }

  function occupiedAxes(page) {
    const x = new Set()
    const y = new Set()
    for (let col = 0; col < page[0].length; col += 1) {
      const rows = page.map((row, index) => row[col].empty ? -1 : index).filter(index => index >= 0)
      if (rows.length) x.add(`${Math.max(...rows)},${col}`)
    }
    page.forEach((row, rowIndex) => {
      const cols = row.map((item, index) => item.empty ? -1 : index).filter(index => index >= 0)
      if (cols.length) y.add(`${rowIndex},${Math.min(...cols)}`)
    })
    return { x, y }
  }

  function line(ctx, x1, y1, x2, y2, width, dash = []) {
    ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([])
  }

  function fitText(ctx, text, maxWidth, initialSize, weight = '') {
    let size = initialSize
    do { ctx.font = `${weight} ${size}px Arial, sans-serif`.trim(); size -= 1 } while (size > initialSize * 0.65 && ctx.measureText(text).width > maxWidth)
  }

  function drawMissing(ctx, box, font, language, lineWidth) {
    ctx.save()
    ctx.strokeStyle = '#b3b3b3'; ctx.setLineDash([lineWidth * 5, lineWidth * 5]); ctx.lineWidth = lineWidth
    ctx.strokeRect(box.x + lineWidth, box.y + lineWidth, box.width - lineWidth * 2, box.height - lineWidth * 2)
    ctx.setLineDash([]); ctx.fillStyle = '#737373'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${font}px Arial, sans-serif`
    ctx.fillText(TEXT[language].missing, box.x + box.width / 2, box.y + box.height / 2)
    ctx.restore()
  }

  function drawPanel(ctx, report, box, options) {
    const { language, upper, font, lineWidth, config, showX, showY } = options
    const titleSpace = config.panelTitles === 'full' ? font * 2.2 : font * 0.5
    const left = box.x + (showY ? box.width * 0.14 : box.width * 0.09)
    const right = box.x + box.width * 0.965
    const top = box.y + titleSpace + font * 2
    const bottom = box.y + box.height - (showX ? font * 5.5 : font * 3.7)
    const plotWidth = right - left
    const plotHeight = bottom - top
    const y = value => bottom - Math.max(0, Math.min(upper, value)) / upper * plotHeight
    ctx.save(); ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'
    if (config.panelTitles === 'full') {
      fitText(ctx, report.title, box.width * 0.86, font * 1.18, 'bold')
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(report.title, box.x + box.width / 2, box.y + font * 0.2)
    }
    const ticks = []
    for (let value = 0; value <= Math.floor(upper / 25) * 25; value += 25) ticks.push(value)
    ctx.font = `${font}px Arial, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'
    ticks.forEach(value => {
      const ypos = y(value)
      line(ctx, left - lineWidth * 3, ypos, left, ypos, lineWidth)
      if (showY) ctx.fillText(String(value), left - lineWidth * 5, ypos)
    })
    line(ctx, left, top, left, bottom, lineWidth)
    line(ctx, left, bottom, right, bottom, lineWidth)
    if (config.referenceLine && Number.isFinite(report.referenceMean)) { ctx.strokeStyle = '#8c8c8c'; line(ctx, left, y(report.referenceMean), right, y(report.referenceMean), lineWidth, [lineWidth * 3, lineWidth * 3]); ctx.strokeStyle = '#000' }
    const treatments = report.treatments.slice()
    const positive = Layout.displayTreatments(report, config).find(item => !treatments.some(primary => Layout.sameTreatment(primary, item))) || null
    const positivePosition = config.positiveControl === 'auto' ? (report.assayType === 'antigenotoxicity' ? 'left' : 'right') : config.positiveControl
    const slots = treatments.map((item, index) => ({ item, position: index, positive: false }))
    if (positive && positivePosition === 'left') slots.forEach(slot => { slot.position += 1 + config.positiveControlGap })
    if (positive) slots.push({ item: positive, position: positivePosition === 'left' ? 0 : treatments.length + config.positiveControlGap, positive: true })
    const maxPosition = Math.max(0, ...slots.map(slot => slot.position))
    const spacing = plotWidth / Math.max(1, maxPosition + 1)
    const barWidth = Math.min(spacing * 0.66, box.width * 0.11)
    slots.forEach(slot => {
      const xpos = left + spacing * (slot.position + 0.5)
      const hasMean = Number.isFinite(slot.item.mean)
      const barTop = hasMean ? y(slot.item.mean) : bottom
      ctx.fillStyle = slot.item.isReference ? '#e0e0e0' : '#7a7a7a'
      if (hasMean) ctx.fillRect(xpos - barWidth / 2, barTop, barWidth, bottom - barTop)
      ctx.strokeStyle = '#000'; ctx.lineWidth = lineWidth
      if (hasMean) ctx.strokeRect(xpos - barWidth / 2, barTop, barWidth, bottom - barTop)
      if (slot.positive && hasMean) {
        ctx.save(); ctx.beginPath(); ctx.rect(xpos - barWidth / 2, barTop, barWidth, bottom - barTop); ctx.clip(); ctx.strokeStyle = '#252525'
        for (let diagonal = -plotHeight; diagonal < barWidth + plotHeight; diagonal += lineWidth * 6) line(ctx, xpos - barWidth / 2 + diagonal, bottom, xpos - barWidth / 2 + diagonal + plotHeight, barTop, lineWidth)
        ctx.restore()
      }
      const hasSd = hasMean && Number.isFinite(slot.item.sd)
      const low = hasSd ? y(Math.max(0, slot.item.mean - slot.item.sd)) : barTop
      const high = hasSd ? y(slot.item.mean + slot.item.sd) : barTop
      if (hasSd) {
        line(ctx, xpos, low, xpos, high, lineWidth * 1.2); line(ctx, xpos - barWidth * 0.2, low, xpos + barWidth * 0.2, low, lineWidth * 1.2); line(ctx, xpos - barWidth * 0.2, high, xpos + barWidth * 0.2, high, lineWidth * 1.2)
      }
      if (!hasMean) {
        ctx.font = `${font * 0.85}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#737373'
        ctx.fillText(TEXT[language].missing, xpos, bottom - font * 0.4)
      }
      const marker = !hasMean ? '' : slot.positive ? (config.positiveControlMarker === 'dagger' && report.positiveControlSignificant ? '†' : '') : (slot.item.isSignificant ? '*' : '')
      if (marker) { ctx.font = `bold ${font * 1.45}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(marker, xpos, high - font * 0.2) }
      ctx.font = `${font}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#000'
      const labels = (slot.positive ? slot.item.label : treatmentLabel(slot.item, language, report.assayType)).split('\n')
      labels.forEach((label, index) => { fitText(ctx, label, spacing * 0.95, font); ctx.fillText(label, xpos, bottom + font * (0.65 + index * 1.05)) })
    })
    if (showY) {
      ctx.save(); ctx.translate(box.x + font * 1.1, top + plotHeight / 2); ctx.rotate(-Math.PI / 2); ctx.font = `${font * 1.05}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(TEXT[language].y, 0, 0); ctx.restore()
    }
    if (showX) { ctx.font = `${font * 1.05}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(TEXT[language].x, left + plotWidth / 2, box.y + box.height - font * 0.1) }
    ctx.restore()
  }

  function render(canvas, page, config) {
    const dpi = config.dpi || 600
    const width = Math.round(config.widthCm / 2.54 * dpi)
    const height = Math.round(config.heightCm / 2.54 * dpi)
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D indisponível para renderização.')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height)
    const rows = page.length
    const cols = page[0].length
    const margin = { left: config.panelLabels !== 'none' ? width * 0.1 : width * 0.075, right: width * 0.015, top: height * 0.045, bottom: height * 0.075 }
    const gapX = width * 0.034
    const gapY = height * 0.05
    const cellWidth = (width - margin.left - margin.right - gapX * (cols - 1)) / cols
    const cellHeight = (height - margin.top - margin.bottom - gapY * (rows - 1)) / rows
    if (cellWidth < 80 || cellHeight < 80) throw new Error('A grade não deixa espaço suficiente para os painéis.')
    const fontPoints = Math.max(5, Math.min(9, Math.min(config.widthCm / 2.54 / cols, config.heightCm / 2.54 / rows) * 3.3))
    const font = fontPoints * dpi / 72
    const lineWidth = Math.max(1, dpi * 0.65 / 72)
    const upper = Layout.upperLimit(page, config)
    const outer = occupiedAxes(page)
    let labelIndex = 0
    page.forEach((row, rowIndex) => row.forEach((report, colIndex) => {
      const box = { x: margin.left + colIndex * (cellWidth + gapX), y: margin.top + rowIndex * (cellHeight + gapY), width: cellWidth, height: cellHeight }
      if (report.empty) {
        if (config.missing === 'label') drawMissing(ctx, box, font, config.language, lineWidth)
        return
      }
      drawPanel(ctx, report, box, { language: config.language, upper, font, lineWidth, config, showX: config.axisLabels === 'all' || outer.x.has(`${rowIndex},${colIndex}`), showY: config.axisLabels === 'all' || outer.y.has(`${rowIndex},${colIndex}`) })
      if (config.panelLabels !== 'none') {
        ctx.fillStyle = '#000'; ctx.font = `bold ${font * 1.3}px Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText(Layout.panelLetter(labelIndex++, config.panelLabels), box.x - font * 2.2, box.y)
      }
    }))
    return { width, height }
  }

  async function encodeCanvas(canvas, dimensions, dpi = 600, rowsPerStrip = 64, shouldCancel = () => false) {
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    const strips = []
    for (let y = 0; y < dimensions.height; y += rowsPerStrip) {
      if (shouldCancel()) throw new Error('Geração cancelada.')
      const rows = Math.min(rowsPerStrip, dimensions.height - y)
      const rgba = ctx.getImageData(0, y, dimensions.width, rows).data
      const gray = new Uint8Array(dimensions.width * rows)
      for (let source = 0, target = 0; target < gray.length; source += 4, target += 1) gray[target] = Math.round(rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114)
      strips.push(gray)
      if (typeof window !== 'undefined') await new Promise(resolve => setTimeout(resolve, 0))
    }
    const result = Tiff.encode({ width: dimensions.width, height: dimensions.height, dpi, rowsPerStrip, strips })
    Tiff.validate(result, { width: dimensions.width, height: dimensions.height, dpi })
    return result
  }

  return { treatmentLabel, render, encodeCanvas }
})
