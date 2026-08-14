let pyodideRuntime = null
let initialization = null

function postStatus(phase) {
  self.postMessage({ type: 'status', phase })
}

async function initialize(message) {
  if (initialization) return initialization
  initialization = (async () => {
    postStatus('runtime')
    importScripts(`${message.indexUrl}pyodide.js`)
    pyodideRuntime = await loadPyodide({ indexURL: message.indexUrl })
    postStatus('packages')
    await pyodideRuntime.loadPackage(message.packages)
    postStatus('engine')
    const response = await fetch(message.engineUrl)
    if (!response.ok) throw new Error(`analysis-engine-${response.status}`)
    await pyodideRuntime.runPythonAsync(await response.text())
    const versions = JSON.parse(await pyodideRuntime.runPythonAsync(`
import json, sys, numpy, scipy, matplotlib
json.dumps({
    "python": sys.version.split()[0],
    "numpy": numpy.__version__,
    "scipy": scipy.__version__,
    "matplotlib": matplotlib.__version__
})
`))
    versions.pyodide = pyodideRuntime.version
    self.postMessage({ type: 'ready', versions })
  })()
  return initialization
}

self.addEventListener('message', async event => {
  const message = event.data
  try {
    if (message.type === 'init') {
      await initialize(message)
      return
    }
    if (message.type === 'analyze') {
      if (!pyodideRuntime) throw new Error('analysis-runtime-not-ready')
      pyodideRuntime.globals.set('experiment_json', message.experimentJson)
      pyodideRuntime.globals.set('lang', message.lang)
      const resultJson = await pyodideRuntime.runPythonAsync('run_all_analyses(experiment_json, lang)')
      self.postMessage({ type: 'result', requestId: message.requestId, context: message.context, resultJson })
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId || null,
      phase: message.type,
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
