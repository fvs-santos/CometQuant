(function () {
  'use strict'

  const MAX_FILES = 50
  const MAX_FILE_BYTES = 10 * 1024 * 1024
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024
  const MAX_PIXELS = 40_000_000
  const DPI = 600
  const state = { files: [], pages: [], reports: [], urls: [], worker: null, workerReject: null, requestId: 0, cancelled: false, zipBlob: null, positivePositionTouched: false }
  const byId = id => document.getElementById(id)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(error => console.warn('CometQuant Plates: service worker indisponível', error))
  }

  function message(text, tone = '') {
    const target = byId('plate-message')
    target.textContent = text
    target.className = `message ${tone}`.trim()
  }

  function clearResults() {
    state.urls.forEach(url => URL.revokeObjectURL(url))
    state.urls = []
    state.zipBlob = null
    byId('downloads').replaceChildren()
    byId('result-section').hidden = true
    byId('download-zip').hidden = true
  }

  function validateFiles(files) {
    if (!files.length) throw new Error('Selecione pelo menos um relatório HTML.')
    if (files.length > MAX_FILES) throw new Error(`Envie no máximo ${MAX_FILES} relatórios por vez.`)
    let total = 0
    files.forEach(file => {
      if (!/\.html?$/i.test(file.name)) throw new Error(`${file.name}: use um arquivo .html ou .htm.`)
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: o arquivo excede 10 MB.`)
      total += file.size
    })
    if (total > MAX_TOTAL_BYTES) throw new Error('O conjunto de relatórios excede 50 MB.')
    return total
  }

  async function loadFiles(fileList) {
    clearResults()
    try {
      const files = Array.from(fileList)
      const total = validateFiles(files)
      state.files = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const html = await file.text()
        const detected = CometQuantPlatesParser.detectMetadata(html)
        state.files.push({ id: `report-${index + 1}`, file, html, agent: detected.agent, cellType: detected.cellType, assayType: detected.assayType || '', s9: '', order: '' })
      }
      updateDefaultPositivePosition()
      renderMetadata()
      const metrics = byId('upload-metrics')
      metrics.replaceChildren(metric('Relatórios', files.length), metric('Volume recebido', `${(total / 1024).toFixed(1)} KB`))
      metrics.hidden = false
      ;['metadata-section', 'composition-section', 'action-section'].forEach(id => { byId(id).hidden = false })
      updateEstimate()
      message('Arquivos carregados. Revise os metadados antes de validar.', 'success')
    } catch (error) {
      state.files = []
      ;['metadata-section', 'composition-section', 'action-section'].forEach(id => { byId(id).hidden = true })
      byId('upload-metrics').hidden = true
      message(error.message, 'error')
    }
  }

  function metric(label, value) {
    const node = document.createElement('div')
    node.className = 'metric'
    const strong = document.createElement('strong')
    strong.textContent = value
    node.append(strong, document.createTextNode(label))
    return node
  }

  function input(value, field, item, type = 'text') {
    const control = document.createElement('input')
    control.type = type
    control.value = value
    if (field === 'order') { control.min = '1'; control.step = '1' }
    control.addEventListener('input', () => { item[field] = control.value; clearResults() })
    return control
  }

  function assaySelect(item) {
    const control = document.createElement('select')
    ;[
      ['', 'Detectar pelo relatório'],
      ['genotoxicity', 'Genotoxicidade'],
      ['antigenotoxicity', 'Antigenotoxicidade']
    ].forEach(([value, label]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      control.append(option)
    })
    control.value = item.assayType
    control.addEventListener('change', () => {
      item.assayType = control.value
      updateDefaultPositivePosition()
      clearResults()
    })
    return control
  }

  function updateDefaultPositivePosition() {
    if (state.positivePositionTouched) return
    const assayTypes = Array.from(new Set(state.files.map(item => item.assayType).filter(Boolean)))
    if (assayTypes.length === 1) byId('positive-position').value = assayTypes[0] === 'antigenotoxicity' ? 'left' : 'right'
    else if (assayTypes.length > 1) byId('positive-position').value = 'auto'
  }

  function renderMetadata() {
    const body = byId('metadata-body')
    body.replaceChildren()
    state.files.forEach((item, index) => {
      const row = document.createElement('tr')
      const values = [String(index + 1), item.file.name]
      values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell) })
      ;[['agent', item.agent], ['cellType', item.cellType], ['s9', item.s9]].forEach(([field, value]) => {
        const cell = document.createElement('td'); cell.append(input(value, field, item, field === 'order' ? 'number' : 'text')); row.append(cell)
      })
      const assayCell = document.createElement('td'); assayCell.append(assaySelect(item)); row.append(assayCell)
      const orderCell = document.createElement('td'); orderCell.append(input(item.order, 'order', item, 'number')); row.append(orderCell)
      body.append(row)
    })
  }

  function outputName(page, count) {
    let value = byId('output-name').value.trim()
    if (!value || /[<>:"/\\|?*]/.test(value) || /[ .]$/.test(value)) throw new Error('Informe um nome de saída válido, sem pastas ou caracteres reservados.')
    if (!/\.tiff?$/i.test(value)) value += '.tiff'
    if (count === 1) return value
    const dot = value.lastIndexOf('.')
    return `${value.slice(0, dot)}_${String(page).padStart(3, '0')}${value.slice(dot)}`
  }

  function config() {
    const number = id => Number(byId(id).value)
    const config = {
      heightCm: number('height-cm'), widthCm: number('width-cm'), rows: number('grid-rows'), cols: number('grid-cols'), dpi: DPI,
      language: byId('plate-language').value, overflow: byId('overflow').value, pairing: byId('pairing').value, missing: byId('missing').value,
      pairOrder: byId('pair-order').value.split(';').map(value => value.trim()).filter(Boolean), referenceLine: byId('reference-line').checked,
      positiveControl: byId('positive-enabled').checked ? byId('positive-position').value : 'none', positiveControlGap: number('positive-gap'),
      positiveControlMarker: byId('positive-marker').checked ? 'dagger' : 'none', panelLabels: byId('panel-labels').value,
      panelTitles: byId('panel-titles').checked ? 'full' : 'none', axisLabels: byId('outer-axes').checked ? 'outer' : 'all'
    }
    if (![config.heightCm, config.widthCm, config.positiveControlGap].every(Number.isFinite) || config.heightCm <= 0 || config.widthCm <= 0 || config.positiveControlGap < 0) throw new Error('Dimensões e distância do tratamento da validação devem ser valores válidos.')
    if (![config.rows, config.cols].every(value => Number.isInteger(value) && value > 0)) throw new Error('Linhas e colunas devem ser inteiros maiores que zero.')
    const pixels = Math.round(config.widthCm / 2.54 * DPI) * Math.round(config.heightCm / 2.54 * DPI)
    if (pixels > MAX_PIXELS) throw new Error(`A imagem teria ${(pixels / 1e6).toFixed(1)} milhões de pixels. Reduza as dimensões para o limite de 40 milhões do navegador.`)
    return config
  }

  function manualOrder() {
    const supplied = state.files.filter(item => String(item.order).trim())
    if (!supplied.length) return []
    if (supplied.length !== state.files.length) throw new Error('Preencha a Ordem de todos os relatórios ou deixe todas em branco.')
    const positions = supplied.map(item => Number(item.order))
    if (positions.some(value => !Number.isInteger(value) || value <= 0) || new Set(positions).size !== positions.length || Math.min(...positions) !== 1 || Math.max(...positions) !== positions.length) throw new Error(`A Ordem deve conter cada número de 1 a ${positions.length} uma única vez.`)
    return supplied.slice().sort((a, b) => Number(a.order) - Number(b.order)).map(item => item.id)
  }

  function prepare() {
    clearResults()
    const options = config()
    options.reportOrder = manualOrder()
    const reports = state.files.map(item => CometQuantPlatesParser.parseReport(item.html, { id: item.id, filename: item.file.name, agent: item.agent, cellType: item.cellType, assayType: item.assayType, s9: item.s9 }))
    if (options.positiveControl !== 'none' && options.positiveControlMarker === 'dagger') reports.forEach(report => { if (report.positiveControl && report.positiveControlSignificant === null) throw new Error(`${report.filename}: resultado da comparação de validação não encontrado em section#control.`) })
    const pages = CometQuantPlatesLayout.buildPages(reports, options)
    outputName(1, pages.length)
    state.reports = reports
    state.pages = pages
    return { options, reports, pages }
  }

  function caption(page, options) {
    if (options.panelLabels === 'none') return ''
    const reports = page.flat().filter(item => !item.empty)
    const descriptions = reports.map((report, index) => {
      const letter = CometQuantPlatesLayout.panelLetter(index, options.panelLabels)
      return options.language === 'pt-BR' ? `${letter}: ${report.agent}, linhagem ${report.cellType}${report.s9 ? `, condição S9 ${report.s9}` : ''}` : `${letter}: ${report.agent}, cell line ${report.cellType}${report.s9 ? `, S9 condition ${report.s9}` : ''}`
    })
    const assayTypes = new Set(reports.map(report => report.assayType))
    const hatch = options.positiveControl !== 'none' && reports.some(report => report.positiveControl)
    const hasUnavailableSd = reports.some(report => CometQuantPlatesLayout.displayTreatments(report, options).some(item => Number.isFinite(item.mean) && !Number.isFinite(item.sd)))
    const variabilityQualifier = hasUnavailableSd ? (options.language === 'en' ? ' when estimable' : ', quando estimável') : ''
    const validationLabel = assayTypes.size === 1 && assayTypes.has('genotoxicity')
      ? (options.language === 'en' ? 'the positive control' : 'o controle positivo')
      : assayTypes.size === 1 && assayTypes.has('antigenotoxicity')
        ? (options.language === 'en' ? 'the basal control used in validation' : 'o controle basal usado na validação')
        : (options.language === 'en' ? 'the validation treatment' : 'o tratamento da validação')
    if (options.language === 'en') return `Results obtained using the comet assay. Data are presented as mean ± standard deviation of the scores${variabilityQualifier}. ${descriptions.join('; ')}.${hatch ? ` Hatched bars represent ${validationLabel}.` : ''}`
    return `Resultados obtidos por meio do ensaio do cometa. Os dados são apresentados como média ± desvio-padrão dos escores${variabilityQualifier}. ${descriptions.join('; ')}.${hatch ? ` As barras hachuradas representam ${validationLabel}.` : ''}`
  }

  function renderSummary(pages, options) {
    const body = byId('summary-body')
    body.replaceChildren()
    CometQuantPlatesLayout.summary(pages, options).forEach(item => {
      const row = document.createElement('tr')
      ;[item.page, item.row, item.col, item.letter, item.filename, item.panel, item.significant].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell) })
      body.append(row)
    })
    byId('result-counts').textContent = `${state.reports.length} relatórios válidos · ${pages.length} página(s)`
    byId('result-section').hidden = false
  }

  function validateLayout() {
    try {
      const prepared = prepare()
      renderSummary(prepared.pages, prepared.options)
      message(`Layout válido: ${prepared.reports.length} relatórios em ${prepared.pages.length} página(s).`, 'success')
      byId('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) { message(error.message, 'error') }
  }

  function setBusy(busy) {
    byId('validate-layout').disabled = busy
    byId('generate-plates').disabled = busy
    byId('cancel-generation').hidden = !busy
    byId('generation-progress').hidden = !busy
  }

  function workerRender(page, options, requestId) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('./js/plates/worker.js')
      state.worker = worker
      state.workerReject = reject
      worker.onmessage = event => {
        if (event.data.requestId !== requestId) return
        if (event.data.type === 'result') { worker.terminate(); state.worker = null; state.workerReject = null; resolve(event.data) }
        if (event.data.type === 'error') { worker.terminate(); state.worker = null; state.workerReject = null; reject(new Error(event.data.message)) }
      }
      worker.onerror = () => { worker.terminate(); state.worker = null; state.workerReject = null; reject(new Error('Falha no Worker de renderização.')) }
      worker.postMessage({ type: 'render', requestId, page, config: options })
    })
  }

  async function fallbackRender(page, options) {
    const canvas = byId('fallback-canvas')
    const dimensions = CometQuantPlatesRenderer.render(canvas, page, options)
    await new Promise(resolve => setTimeout(resolve, 0))
    const previewCanvas = document.createElement('canvas')
    previewCanvas.width = Math.min(1400, dimensions.width)
    previewCanvas.height = Math.round(dimensions.height * previewCanvas.width / dimensions.width)
    previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height)
    const preview = await new Promise((resolve, reject) => previewCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível criar a prévia.')), 'image/png'))
    const tiff = await CometQuantPlatesRenderer.encodeCanvas(canvas, dimensions, options.dpi, 64, () => state.cancelled)
    canvas.width = 1; canvas.height = 1
    return { dimensions, preview, tiff }
  }

  function addOutput(result, name, captionText) {
    const tiffBlob = new Blob([result.tiff], { type: 'image/tiff' })
    const imageUrl = URL.createObjectURL(result.preview)
    const downloadUrl = URL.createObjectURL(tiffBlob)
    state.urls.push(imageUrl, downloadUrl)
    const card = document.createElement('article'); card.className = 'output-card'
    const image = document.createElement('img'); image.src = imageUrl; image.alt = `Prévia reduzida de ${name}`
    const details = document.createElement('div')
    const title = document.createElement('h3'); title.textContent = name
    const dimensions = document.createElement('p'); dimensions.textContent = `${result.dimensions.width} × ${result.dimensions.height} px · grayscale 8-bit · LZW · 600 dpi`
    const link = document.createElement('a'); link.className = 'button secondary'; link.href = downloadUrl; link.download = name; link.textContent = `Baixar ${name}`
    details.append(title, dimensions, link)
    if (captionText) { const area = document.createElement('textarea'); area.value = captionText; area.setAttribute('aria-label', `Legenda sugerida para ${name}`); details.append(area) }
    card.append(image, details); byId('downloads').append(card)
    return { name, blob: tiffBlob }
  }

  async function generate() {
    let prepared
    try { prepared = prepare() } catch (error) { message(error.message, 'error'); return }
    renderSummary(prepared.pages, prepared.options)
    state.cancelled = false
    const generationId = ++state.requestId
    const outputs = []
    setBusy(true)
    try {
      for (let index = 0; index < prepared.pages.length; index += 1) {
        if (state.cancelled) throw new Error('Geração cancelada.')
        byId('generation-progress').value = index / prepared.pages.length * 100
        message(`Renderizando página ${index + 1}/${prepared.pages.length}...`)
        const canUseWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
        let result
        if (canUseWorker) {
          try { result = await workerRender(prepared.pages[index], prepared.options, generationId) } catch (error) {
            if (state.cancelled) throw error
            message(`Worker indisponível; renderizando página ${index + 1} na interface...`)
            result = await fallbackRender(prepared.pages[index], prepared.options)
          }
        } else result = await fallbackRender(prepared.pages[index], prepared.options)
        if (state.cancelled) throw new Error('Geração cancelada.')
        const name = outputName(index + 1, prepared.pages.length)
        outputs.push(addOutput(result, name, caption(prepared.pages[index], prepared.options)))
      }
      if (outputs.length > 1) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip não está disponível para agrupar as páginas.')
        message('Compactando as páginas...')
        const zip = new JSZip()
        outputs.forEach(output => zip.file(output.name, output.blob))
        state.zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
        byId('download-zip').hidden = false
      }
      byId('generation-progress').value = 100
      message(`Prancha gerada e validada: ${outputs.length} página(s).`, 'success')
      byId('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) {
      message(error.message, error.message.includes('cancelada') ? '' : 'error')
    } finally { setBusy(false) }
  }

  function cancel() {
    state.cancelled = true
    if (state.workerReject) { state.workerReject(new Error('Geração cancelada.')); state.workerReject = null }
    if (state.worker) { state.worker.terminate(); state.worker = null }
    message('Cancelando a geração...')
    setBusy(false)
  }

  function updateEstimate() {
    const width = Math.round(Number(byId('width-cm').value) / 2.54 * DPI)
    const height = Math.round(Number(byId('height-cm').value) / 2.54 * DPI)
    byId('size-estimate').textContent = Number.isFinite(width * height) ? `${width} × ${height} px por página · ${(width * height / 1e6).toFixed(1)} MP` : ''
  }

  byId('plate-files').addEventListener('change', event => loadFiles(event.target.files))
  byId('validate-layout').addEventListener('click', validateLayout)
  byId('generate-plates').addEventListener('click', generate)
  byId('cancel-generation').addEventListener('click', cancel)
  byId('download-zip').addEventListener('click', () => {
    if (!state.zipBlob) return
    const url = URL.createObjectURL(state.zipBlob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${byId('output-name').value.replace(/\.tiff?$/i, '') || 'prancha'}_paginas.zip`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  byId('positive-position').addEventListener('change', () => { state.positivePositionTouched = true })
  ;['height-cm', 'width-cm'].forEach(id => byId(id).addEventListener('input', updateEstimate))
  byId('composition-section').addEventListener('input', clearResults)
  window.addEventListener('beforeunload', () => { state.urls.forEach(url => URL.revokeObjectURL(url)); if (state.worker) state.worker.terminate() })
  updateEstimate()
})()
