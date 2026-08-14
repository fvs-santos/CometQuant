const { webcrypto } = require('node:crypto')
const backup = require('../../js/backup.js')
const { experiment } = require('../fixtures/experiment.js')

const options = { crypto: webcrypto, iterations: 100000 }
const passphrase = 'correct horse battery staple'

describe('encrypted blinded backups', () => {
  it('round-trips an experiment without exposing plaintext', async () => {
    const source = experiment()
    const encrypted = await backup.encryptExperiment(source, passphrase, options)
    expect(encrypted.format).toBe(backup.FORMAT)
    expect(JSON.stringify(encrypted)).not.toContain(source.agent)
    await expect(backup.decryptExperiment(encrypted, passphrase, { crypto: webcrypto })).resolves.toEqual(source)
  })

  it('uses fresh random salt and IV for each backup', async () => {
    const first = await backup.encryptExperiment(experiment(), passphrase, options)
    const second = await backup.encryptExperiment(experiment(), passphrase, options)
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.cipher.iv).not.toBe(second.cipher.iv)
    expect(first.data).not.toBe(second.data)
  })

  it('rejects wrong passwords, tampering and weak passwords', async () => {
    const encrypted = await backup.encryptExperiment(experiment(), passphrase, options)
    await expect(backup.decryptExperiment(encrypted, 'wrong password value', { crypto: webcrypto })).rejects.toThrow('decryption-failed')
    encrypted.data = `${encrypted.data.slice(0, -4)}AAAA`
    await expect(backup.decryptExperiment(encrypted, passphrase, { crypto: webcrypto })).rejects.toThrow('decryption-failed')
    await expect(backup.encryptExperiment(experiment(), 'too short', options)).rejects.toThrow('weak-passphrase')
    await expect(backup.encryptExperiment(experiment(), 'aaaaaaaaaaaa', options)).rejects.toThrow('weak-passphrase')
  })

  it('rejects unsupported parameters and unavailable Web Crypto', async () => {
    const encrypted = await backup.encryptExperiment(experiment(), passphrase, options)
    encrypted.kdf.iterations = 1
    await expect(backup.decryptExperiment(encrypted, passphrase, { crypto: webcrypto })).rejects.toThrow('invalid-backup')
    await expect(backup.encryptExperiment(experiment(), passphrase, { crypto: {} })).rejects.toThrow('crypto-unavailable')
  })
})
