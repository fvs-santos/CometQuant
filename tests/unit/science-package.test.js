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
