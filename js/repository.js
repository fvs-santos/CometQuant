(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantRepository = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const DB_NAME = 'cometquant'
  const DB_VERSION = 1
  const AUTHORITY_KEY = 'cometquant-storage-authority'
  const MIRROR_REVISION_KEY = 'cometquant-idb-mirror-revision'
  const records = new Map()
  const listeners = new Set()
  const tabId = root.crypto?.randomUUID ? root.crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  let database = null
  let channel = null
  let mode = 'uninitialized'
  let storageKey = 'cometquant-experiments'
  let mirrorRevision = 0

  class ConflictError extends Error {
    constructor(id, expected, actual) {
      super(`storage-conflict-${id}-${expected}-${actual}`)
      this.name = 'ConflictError'
      this.id = id
      this.expected = expected
      this.actual = actual
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error || new Error('storage-transaction-aborted'))
      transaction.onerror = () => reject(transaction.error || new Error('storage-transaction-failed'))
    })
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('experiments')) db.createObjectStore('experiments', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('quarantine')) db.createObjectStore('quarantine', { keyPath: 'key', autoIncrement: true })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('storage-upgrade-blocked'))
    })
  }

  function safeLocalGet(key) {
    try { return root.localStorage?.getItem(key) }
    catch (_) { return null }
  }

  function validate(raw) {
    try {
      const result = root.CometQuantCore.validateExperiment(raw, { source: 'local' })
      return result.valid ? { data: result.experiment } : { error: result.errors.join(',') }
    } catch (error) {
      return { error: error.message || 'validation-failed' }
    }
  }

  function prepareLegacyMigration(rawText) {
    const valid = []
    const quarantine = []
    if (rawText === null) return { valid, quarantine }
    let parsed
    try { parsed = JSON.parse(rawText) }
    catch (_) {
      quarantine.push({ sourceIndex: null, rawValue: rawText, reason: 'invalid-root-json' })
      return { valid, quarantine }
    }
    if (!Array.isArray(parsed)) {
      quarantine.push({ sourceIndex: null, rawValue: parsed, reason: 'invalid-root-type' })
      return { valid, quarantine }
    }

    const ids = new Set()
    parsed.forEach((item, sourceIndex) => {
      const result = validate(item)
      if (result.error) {
        quarantine.push({ sourceIndex, rawValue: item, reason: result.error })
      } else if (ids.has(result.data.id)) {
        quarantine.push({ sourceIndex, rawValue: item, reason: 'duplicate-id' })
      } else {
        ids.add(result.data.id)
        valid.push(result.data)
      }
    })
    return { valid, quarantine }
  }

  async function migrateLegacyData() {
    const rawText = safeLocalGet(storageKey)
    const prepared = prepareLegacyMigration(rawText)
    const transaction = database.transaction(['experiments', 'meta', 'quarantine'], 'readwrite')
    const experiments = transaction.objectStore('experiments')
    const meta = transaction.objectStore('meta')
    const quarantine = transaction.objectStore('quarantine')
    const existing = await requestResult(meta.get('authority'))
    if (existing?.value === 'indexeddb') {
      await transactionComplete(transaction)
      return { migrated: false, quarantined: existing.quarantined || 0 }
    }
    prepared.valid.forEach(data => experiments.put({ id: data.id, revision: 1, deleted: false, data }))
    prepared.quarantine.forEach(entry => quarantine.add(entry))
    meta.put({ key: 'legacy-snapshot', value: rawText, capturedAt: new Date().toISOString() })
    meta.put({ key: 'authority', value: 'indexeddb', migratedAt: new Date().toISOString(), quarantined: prepared.quarantine.length })
    await transactionComplete(transaction)
    try { root.localStorage?.setItem(AUTHORITY_KEY, 'indexeddb') } catch (_) {}
    return { migrated: true, quarantined: prepared.quarantine.length }
  }

  async function loadRecords() {
    const transaction = database.transaction('experiments', 'readonly')
    const stored = await requestResult(transaction.objectStore('experiments').getAll())
    records.clear()
    stored.forEach(record => records.set(record.id, record))
  }

  async function upgradeStoredRecords() {
    const transaction = database.transaction('experiments', 'readwrite')
    const store = transaction.objectStore('experiments')
    const stored = await requestResult(store.getAll())
    let upgraded = 0
    stored.forEach(record => {
      if (record.deleted || !record.data || record.data.schemaVersion === root.CometQuantCore.SCHEMA_VERSION) return
      const result = validate(record.data)
      if (result.error || result.data.id !== record.id) return
      store.put({
        ...record,
        revision: (Number.isInteger(record.revision) ? record.revision : 0) + 1,
        data: result.data
      })
      upgraded++
    })
    await transactionComplete(transaction)
    return upgraded
  }

  async function init(options = {}) {
    storageKey = options.storageKey || storageKey
    if (mode !== 'uninitialized') return { mode, migrated: false, quarantined: 0 }
    try {
      if (!root.indexedDB) throw new Error('indexeddb-unavailable')
      database = await openDatabase()
      database.onversionchange = () => {
        database.close()
        listeners.forEach(listener => listener({ type: 'versionchange' }))
      }
      const migration = await migrateLegacyData()
      const upgraded = await upgradeStoredRecords()
      await loadRecords()
      if (upgraded > 0) mirrorToLocalStorage()
      mode = 'indexeddb'
      if (typeof root.BroadcastChannel === 'function') {
        channel = new root.BroadcastChannel('cometquant-storage')
        channel.onmessage = event => handleBroadcast(event.data)
      }
      return { mode, ...migration, upgraded }
    } catch (error) {
      database?.close()
      throw error
    }
  }

  function list() {
    return Array.from(records.values())
      .filter(record => !record.deleted)
      .map(record => clone(record.data))
  }

  function getRecord(id) {
    const record = records.get(id)
    return record && !record.deleted ? clone(record) : null
  }

  async function readRecord(id) {
    const transaction = database.transaction('experiments', 'readonly')
    const record = await requestResult(transaction.objectStore('experiments').get(id))
    return record && !record.deleted ? clone(record) : null
  }

  function getRevision(id) {
    return records.get(id)?.revision || 0
  }

  function validateForWrite(data) {
    const result = validate(data)
    if (result.error) throw new Error(`invalid-experiment-${result.error}`)
    return result.data
  }

  async function put(data, expectedRevision = 0) {
    const validData = validateForWrite(data)
    const transaction = database.transaction('experiments', 'readwrite')
    const store = transaction.objectStore('experiments')
    const existing = await requestResult(store.get(validData.id))
    const actualRevision = existing?.revision || 0
    if (actualRevision !== expectedRevision) {
      throw new ConflictError(validData.id, expectedRevision, actualRevision)
    }
    if (existing?.data) {
      const transition = root.CometQuantCore.validateExperimentTransition(existing.data, validData)
      if (!transition.valid) throw new Error(`invalid-experiment-transition-${transition.errors.join(',')}`)
    }
    const record = { id: validData.id, revision: actualRevision + 1, deleted: false, data: validData }
    store.put(record)
    await transactionComplete(transaction)
    records.set(record.id, record)
    mirrorToLocalStorage()
    channel?.postMessage({ type: 'put', id: record.id, revision: record.revision, tabId })
    return clone(record)
  }

  async function remove(id, expectedRevision) {
    const transaction = database.transaction('experiments', 'readwrite')
    const store = transaction.objectStore('experiments')
    const existing = await requestResult(store.get(id))
    const actualRevision = existing?.revision || 0
    if (actualRevision !== expectedRevision) {
      throw new ConflictError(id, expectedRevision, actualRevision)
    }
    const tombstone = { id, revision: actualRevision + 1, deleted: true, data: null }
    store.put(tombstone)
    await transactionComplete(transaction)
    records.set(id, tombstone)
    mirrorToLocalStorage()
    channel?.postMessage({ type: 'delete', id, revision: tombstone.revision, tabId })
  }

  function mirrorToLocalStorage() {
    try {
      root.localStorage.setItem(storageKey, JSON.stringify(list()))
      root.localStorage.setItem(MIRROR_REVISION_KEY, String(++mirrorRevision))
    } catch (_) {
      // IndexedDB remains authoritative if the compatibility mirror is full.
    }
  }

  async function handleBroadcast(message) {
    if (!message || message.tabId === tabId || mode !== 'indexeddb') return
    const previousRevision = getRevision(message.id)
    const transaction = database.transaction('experiments', 'readonly')
    const latest = await requestResult(transaction.objectStore('experiments').get(message.id))
    if (latest) records.set(message.id, latest)
    else records.delete(message.id)
    listeners.forEach(listener => listener({
      type: message.type,
      id: message.id,
      previousRevision,
      revision: latest?.revision || message.revision,
      data: latest && !latest.deleted ? clone(latest.data) : null
    }))
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function getRecoveryData() {
    const transaction = database.transaction(['meta', 'quarantine'], 'readonly')
    const snapshotRequest = transaction.objectStore('meta').get('legacy-snapshot')
    const quarantineRequest = transaction.objectStore('quarantine').getAll()
    const [snapshot, quarantine] = await Promise.all([
      requestResult(snapshotRequest),
      requestResult(quarantineRequest)
    ])
    return {
      exportedAt: new Date().toISOString(),
      legacySnapshot: snapshot?.value ?? null,
      quarantine: clone(quarantine)
    }
  }

  return { init, list, getRecord, readRecord, getRevision, put, remove, subscribe, getRecoveryData, ConflictError }
})
