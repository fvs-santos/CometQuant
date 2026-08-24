const fs = require('node:fs')
const path = require('node:path')
const { webcrypto } = require('node:crypto')

describe('scientific package manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../science-assets.json'), 'utf8'))

  it('pins a complete, unique and internally consistent asset inventory', () => {
    expect(manifest.version).toBe('pyodide-0.26.2-r1')
    expect(manifest.packages).toEqual(['numpy', 'scipy', 'matplotlib'])
    expect(new Set(manifest.assets.map(asset => asset.path)).size).toBe(manifest.assets.length)
    expect(manifest.assets.reduce((total, asset) => total + asset.bytes, 0)).toBe(manifest.totalBytes)
    expect(manifest.downloadBytes).toBe(35683806)
    expect(manifest.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'pyodide.js' }),
      expect.objectContaining({ path: 'pyodide.asm.wasm' }),
      expect.objectContaining({ path: 'python_stdlib.zip' }),
      expect.objectContaining({ path: 'pyodide-lock.json' })
    ]))
    manifest.assets.forEach(asset => {
      expect(asset.source).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v0\.26\.2\/full\//)
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(asset.bytes).toBeGreaterThan(0)
    })
  })

  it('computes SHA-256 using Web Crypto', async () => {
    Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto })
    vi.resetModules()
    const science = require('../../js/science-package.js')
    const bytes = new TextEncoder().encode('abc')
    await expect(science.sha256Hex(bytes)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('storage diagnostics', () => {
  const manifest = {
    version: 'test-runtime',
    cacheName: 'cometquant-science-test',
    indexPath: './runtime/',
    totalBytes: 104399681,
    downloadBytes: 35683806,
    assets: []
  }

  function loadScience() {
    delete require.cache[require.resolve('../../js/science-package.js')]
    return require('../../js/science-package.js')
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reports estimates without requesting persistent storage', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      userAgent: 'Test WebKit',
      platform: 'Test Device',
      storage: {
        estimate: vi.fn(async () => ({ usage: 10 * 1024 * 1024, quota: 200 * 1024 * 1024 })),
        persisted: vi.fn(async () => false),
        persist
      },
      serviceWorker: { controller: {} }
    })
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('indexedDB', {})
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['cometquant-shell-v17']),
      open: vi.fn(async () => ({
        match: vi.fn(async () => ({ text: async () => 'cometquant-shell-v17' }))
      }))
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })))
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

    const science = loadScience()
    const report = await science.inspectStorage()

    expect(report).toMatchObject({
      secureContext: true,
      indexedDB: true,
      cacheStorage: true,
      standalone: true,
      serviceWorker: { supported: true, controlled: true },
      estimate: {
        supported: true,
        usage: 10 * 1024 * 1024,
        quota: 200 * 1024 * 1024,
        available: 190 * 1024 * 1024,
        error: null
      },
      persistence: { supported: true, requestSupported: true, persisted: false, error: null },
      caches: { shell: ['cometquant-shell-v17'], shellReady: true, science: [], error: null },
      sciencePackage: { version: 'test-runtime', expectedBytes: 104399681, downloadBytes: 35683806, installed: false, error: null }
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('returns partial information when optional browser APIs are unavailable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Limited Browser', platform: '' })
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })))

    const science = loadScience()
    const report = await science.inspectStorage()

    expect(report).toMatchObject({
      secureContext: false,
      indexedDB: false,
      cacheStorage: false,
      serviceWorker: { supported: false, controlled: false },
      estimate: { supported: false, usage: null, quota: null, available: null },
      persistence: { supported: false, persisted: null },
      sciencePackage: { version: 'test-runtime', expectedBytes: 104399681 }
    })
  })

  it('isolates failures from independent storage probes', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError') }),
        persisted: vi.fn(async () => { throw new DOMException('Denied', 'SecurityError') })
      }
    })
    vi.stubGlobal('caches', { keys: vi.fn(async () => { throw new Error('cache-failed') }) })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('manifest-failed') }))

    const science = loadScience()
    const report = await science.inspectStorage()

    expect(report.estimate.error).toBe('NotAllowedError')
    expect(report.persistence.error).toBe('SecurityError')
    expect(report.caches.error).toBe('cache-failed')
    expect(report.sciencePackage.error).toBe('manifest-failed')
  })
})
