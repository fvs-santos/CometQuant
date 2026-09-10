'use strict'

importScripts('./layout.js', './tiff.js', './renderer.js')

let cancelledRequest = null

self.addEventListener('message', async event => {
  const message = event.data
  if (message.type === 'cancel') { cancelledRequest = message.requestId; return }
  if (message.type !== 'render') return
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas indisponível.')
    const canvas = new OffscreenCanvas(1, 1)
    const dimensions = CometQuantPlatesRenderer.render(canvas, message.page, message.config)
    self.postMessage({ type: 'status', requestId: message.requestId, phase: 'encoding' })
    const tiff = await CometQuantPlatesRenderer.encodeCanvas(canvas, dimensions, message.config.dpi, 64, () => cancelledRequest === message.requestId)
    const previewWidth = Math.min(1400, dimensions.width)
    const previewHeight = Math.max(1, Math.round(dimensions.height * previewWidth / dimensions.width))
    const previewCanvas = new OffscreenCanvas(previewWidth, previewHeight)
    previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewWidth, previewHeight)
    const preview = await previewCanvas.convertToBlob({ type: 'image/png' })
    canvas.width = 1; canvas.height = 1
    self.postMessage({ type: 'result', requestId: message.requestId, dimensions, tiff, preview }, [tiff])
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
  }
})
