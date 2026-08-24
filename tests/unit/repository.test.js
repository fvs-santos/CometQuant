const FDBFactory = require('fake-indexeddb/lib/FDBFactory')
const core = require('../../js/core.js')
const { experiment } = require('../fixtures/experiment.js')

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readStore(name) {
  const database = await requestResult(indexedDB.open('cometquant', 1))
  const values = await requestResult(database.transaction(name, 'readonly').objectStore(name).getAll())
  database.close()
  return values
}

describe('IndexedDB repository', () => {
  let repository

  beforeEach(() => {
    vi.resetModules()
    delete require.cache[require.resolve('../../js/repository.js')]
    global.indexedDB = new FDBFactory()
    global.CometQuantCore = core
    localStorage.clear()
    localStorage.setItem('cometquant-experiments', '[]')
    repository = require('../../js/repository.js')
  })

  it('migrates valid legacy records and quarantines invalid entries atomically', async () => {
    const valid = experiment({ id: 'valid-record' })
    const raw = JSON.stringify([null, valid, { schemaVersion: 999, id: 'future-record' }, valid])
    localStorage.setItem('cometquant-experiments', raw)

    const result = await repository.init()

    expect(result).toMatchObject({ mode: 'indexeddb', migrated: true, quarantined: 3 })
    expect(repository.list()).toEqual([expect.objectContaining({ id: 'valid-record', schemaVersion: 6, slideEditHistory: [] })])
    expect(repository.getRevision('valid-record')).toBe(1)
    expect(await readStore('quarantine')).toHaveLength(3)
    const meta = await readStore('meta')
    expect(meta.find(entry => entry.key === 'legacy-snapshot').value).toBe(raw)
    const recovery = await repository.getRecoveryData()
    expect(recovery.legacySnapshot).toBe(raw)
    expect(recovery.quarantine).toHaveLength(3)
  })

  it('upgrades authoritative IndexedDB records without changing legacy blind codes', async () => {
    await repository.init()
    const legacy = experiment({ schemaVersion: 3, id: 'indexeddb-v3' })
    legacy.replicates[0].assignments[0].blindCode = 'ABCD-01'
    legacy.replicates[0].gels[0].blindCode = 'ABCD-01'
    const database = await requestResult(indexedDB.open('cometquant', 1))
    const transaction = database.transaction('experiments', 'readwrite')
    transaction.objectStore('experiments').put({ id: legacy.id, revision: 7, deleted: false, data: legacy })
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()

    delete require.cache[require.resolve('../../js/repository.js')]
    repository = require('../../js/repository.js')
    const result = await repository.init()

    expect(result.upgraded).toBe(1)
    expect(repository.getRevision(legacy.id)).toBe(8)
    expect(repository.getRecord(legacy.id).data).toMatchObject({
      schemaVersion: 6,
      slideEditHistory: [],
      studyDesign: expect.objectContaining({ version: 1, status: 'unconfigured', assayType: null }),
      replicates: [{ assignments: [{ blindCode: 'ABCD-01' }], gels: [{ blindCode: 'ABCD-01' }] }]
    })
  })

  it('preserves a corrupt root in quarantine instead of overwriting it', async () => {
    localStorage.setItem('cometquant-experiments', '{broken')

    const result = await repository.init()

    expect(result.quarantined).toBe(1)
    expect(repository.list()).toEqual([])
    expect(await readStore('quarantine')).toEqual([
      expect.objectContaining({ rawValue: '{broken', reason: 'invalid-root-json' })
    ])
  })

  it('uses monotonic revisions and rejects stale writes', async () => {
    const data = experiment({ id: 'revision-test' })
    localStorage.setItem('cometquant-experiments', JSON.stringify([data]))
    await repository.init()

    const updated = experiment({ id: 'revision-test', researcher: 'First update' })
    const committed = await repository.put(updated, 1)
    expect(committed.revision).toBe(2)
    expect(repository.getRecord('revision-test').data.researcher).toBe('First update')

    await expect(repository.put(experiment({ id: 'revision-test', researcher: 'Stale' }), 1))
      .rejects.toBeInstanceOf(repository.ConflictError)
    expect(repository.getRecord('revision-test').data.researcher).toBe('First update')
  })

  it('serializes simultaneous first-run migrations', async () => {
    const data = experiment({ id: 'migration-race' })
    localStorage.setItem('cometquant-experiments', JSON.stringify([data]))
    const firstRepository = repository
    delete require.cache[require.resolve('../../js/repository.js')]
    const secondRepository = require('../../js/repository.js')

    const results = await Promise.all([firstRepository.init(), secondRepository.init()])

    expect(results.filter(result => result.migrated)).toHaveLength(1)
    expect(firstRepository.list()).toEqual([expect.objectContaining({ id: 'migration-race' })])
    expect(secondRepository.list()).toEqual([expect.objectContaining({ id: 'migration-race' })])
  })

  it('commits a terminal correction and its audit event atomically', async () => {
    const original = experiment({ id: 'correction-test' })
    localStorage.setItem('cometquant-experiments', JSON.stringify([original]))
    await repository.init()
    const corrected = JSON.parse(JSON.stringify(repository.getRecord(original.id).data))
    const assignment = corrected.replicates[0].assignments[0]
    const gel = corrected.replicates[0].gels[0]
    const before = core.createSlideEditSnapshot(assignment, gel)
    gel.class2 = 90
    gel.class3 = 10
    const after = core.createSlideEditSnapshot(assignment, gel)
    corrected.slideEditHistory.push({
      version: 1, editId: 'edit-1', editedAt: '2026-01-03T00:00:00.000Z', editedBy: 'Reviewer', reason: 'Checked source record.',
      slide: { replicateNumber: 1, blindCode: 'AA1', treatmentIndex: 0, gelNumber: 1 }, before, after
    })

    const committed = await repository.put(corrected, 1)
    expect(committed.revision).toBe(2)
    expect(committed.data.replicates[0].gels[0].class3).toBe(10)
    expect(committed.data.slideEditHistory).toHaveLength(1)

    const silent = JSON.parse(JSON.stringify(committed.data))
    silent.replicates[0].gels[0].class3 = 20
    silent.replicates[0].gels[0].class2 = 80
    await expect(repository.put(silent, 2)).rejects.toThrow(/invalid-experiment/)
    expect(repository.getRecord(original.id).revision).toBe(2)
    expect(repository.getRecord(original.id).data.replicates[0].gels[0].class3).toBe(10)
  })

  it('deletes only the expected revision', async () => {
    const data = experiment({ id: 'delete-test' })
    localStorage.setItem('cometquant-experiments', JSON.stringify([data]))
    await repository.init()
    await repository.put(experiment({ id: 'delete-test', researcher: 'Updated' }), 1)

    await expect(repository.remove('delete-test', 1)).rejects.toBeInstanceOf(repository.ConflictError)
    await repository.remove('delete-test', 2)
    expect(repository.getRecord('delete-test')).toBeNull()
    expect(repository.getRevision('delete-test')).toBe(3)
    expect(await repository.readRecord('delete-test')).toBeNull()
  })
})
