(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantScience = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const MANIFEST_URL = './science-assets.json'
  const MARKER_FILE = 'cometquant-install.json'
  const SCIENCE_CACHE_PREFIX = 'cometquant-science-'
  let manifestPromise = null

  function fetchManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error(`science-manifest-${response.status}`)
        return response.json()
      }).catch(error => {
        manifestPromise = null
        throw error
      })
    }
    return manifestPromise
  }

  function indexUrl(manifest) {
    return new URL(manifest.indexPath, document.baseURI).href
  }

  function assetUrl(manifest, asset) {
    return new URL(asset.path, indexUrl(manifest)).href
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  }

  async function readBytes(response, onChunk) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const bytes = new Uint8Array(await response.arrayBuffer())
      onChunk(bytes.byteLength)
      return bytes
    }

    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
      onChunk(value.byteLength)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    chunks.forEach(chunk => {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    })
    return bytes
  }

  function contentType(path) {
    if (path.endsWith('.js')) return 'text/javascript'
    if (path.endsWith('.json')) return 'application/json'
    if (path.endsWith('.wasm')) return 'application/wasm'
    if (path.endsWith('.zip') || path.endsWith('.whl')) return 'application/octet-stream'
    return 'application/octet-stream'
  }

  async function isInstalled(manifest) {
    if (!('caches' in root)) return false
    const cache = await caches.open(manifest.cacheName)
    const marker = await cache.match(new URL(MARKER_FILE, indexUrl(manifest)).href)
    if (!marker) return false
    try {
      const metadata = await marker.json()
      if (metadata.version !== manifest.version) return false
    } catch (_) {
      return false
    }
    const matches = await Promise.all(manifest.assets.map(asset => cache.match(assetUrl(manifest, asset))))
    return matches.every(Boolean)
  }

  async function requestPersistentStorage() {
    if (!root.navigator.storage) return { persisted: false, estimate: null }
    const estimate = root.navigator.storage.estimate ? await root.navigator.storage.estimate() : null
    const persisted = root.navigator.storage.persist ? await root.navigator.storage.persist() : false
    return { persisted, estimate }
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
  }

  async function removeOldCaches(currentCacheName) {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith(SCIENCE_CACHE_PREFIX) && key !== currentCacheName)
      .map(key => caches.delete(key)))
  }

  async function installUnlocked(manifest, signal, onProgress) {
    await caches.delete(manifest.cacheName)
    let storage = await requestPersistentStorage()
    let available = storage.estimate && Number.isFinite(storage.estimate.quota) && Number.isFinite(storage.estimate.usage)
      ? storage.estimate.quota - storage.estimate.usage
      : null
    if (available !== null && available < manifest.totalBytes * 1.25) {
      await removeOldCaches(manifest.cacheName)
      storage = await requestPersistentStorage()
      available = storage.estimate && Number.isFinite(storage.estimate.quota) && Number.isFinite(storage.estimate.usage)
        ? storage.estimate.quota - storage.estimate.usage
        : null
    }
    if (available !== null && available < manifest.totalBytes * 1.25) throw new Error('science-quota-insufficient')

    const cache = await caches.open(manifest.cacheName)
    let downloaded = 0
    try {
      for (const asset of manifest.assets) {
        throwIfAborted(signal)
        const response = await fetch(asset.source, { signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`science-download-${response.status}`)
        const bytes = await readBytes(response, count => {
          downloaded += count
          onProgress({ downloaded, total: manifest.totalBytes, asset: asset.path })
        })
        throwIfAborted(signal)
        if (bytes.byteLength !== asset.bytes) throw new Error(`science-size-${asset.path}`)
        if (await sha256Hex(bytes) !== asset.sha256) throw new Error(`science-integrity-${asset.path}`)
        throwIfAborted(signal)
        await cache.put(assetUrl(manifest, asset), new Response(bytes, {
          headers: {
            'Content-Type': response.headers.get('Content-Type') || contentType(asset.path),
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        }))
      }
      throwIfAborted(signal)
      await cache.put(new URL(MARKER_FILE, indexUrl(manifest)).href, new Response(JSON.stringify({
        version: manifest.version,
        installedAt: new Date().toISOString(),
        persisted: storage.persisted
      }), { headers: { 'Content-Type': 'application/json' } }))
      await removeOldCaches(manifest.cacheName)
      return storage
    } catch (error) {
      await caches.delete(manifest.cacheName)
      throw error
    }
  }

  async function install(manifest, options = {}) {
    if (!('caches' in root) || !root.isSecureContext) throw new Error('science-storage-unavailable')
    const { signal, onProgress = () => {} } = options
    const perform = async () => {
      throwIfAborted(signal)
      if (await isInstalled(manifest)) return requestPersistentStorage()
      return installUnlocked(manifest, signal, onProgress)
    }
    if (root.navigator.locks?.request) {
      const lockOptions = { mode: 'exclusive' }
      if (signal) lockOptions.signal = signal
      return root.navigator.locks.request('cometquant-science-install', lockOptions, perform)
    }
    return perform()
  }

  async function remove(manifest) {
    return caches.delete(manifest.cacheName)
  }

  return { fetchManifest, indexUrl, isInstalled, install, remove, sha256Hex }
})
