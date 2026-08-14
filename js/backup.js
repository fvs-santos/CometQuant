(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantBackup = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const FORMAT = 'cometquant-encrypted-backup'
  const VERSION = 1
  const DEFAULT_ITERATIONS = 600000
  const MIN_ITERATIONS = 100000
  const MAX_ITERATIONS = 1000000
  const MIN_PASSPHRASE_LENGTH = 12
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  function bytesToBase64(bytes) {
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(binary)
  }

  function base64ToBytes(value, maxBytes = 10 * 1024 * 1024) {
    if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('invalid-backup')
    let binary
    try {
      binary = atob(value)
    } catch {
      throw new Error('invalid-backup')
    }
    if (binary.length > maxBytes) throw new Error('invalid-backup')
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }

  function getCrypto(options) {
    const cryptoApi = options?.crypto || globalThis.crypto
    if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') throw new Error('crypto-unavailable')
    return cryptoApi
  }

  function isStrongPassphrase(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH || new Set(passphrase).size < 6) return false
    const normalized = passphrase.toLocaleLowerCase().replace(/\s+/g, '')
    if (['passwordpassword', '123456789012', 'qwertyqwerty', 'aaaaaaaaaaaa'].includes(normalized)) return false
    if (passphrase.length >= 20) return true
    const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter(pattern => pattern.test(passphrase)).length
    return characterClasses >= 3
  }

  function validatePassphrase(passphrase) {
    if (!isStrongPassphrase(passphrase)) throw new Error('weak-passphrase')
  }

  async function deriveKey(cryptoApi, passphrase, salt, iterations, usages) {
    const material = await cryptoApi.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
    return cryptoApi.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    )
  }

  function isEncryptedBackup(value) {
    return Boolean(value && value.format === FORMAT && value.version === VERSION)
  }

  async function encryptExperiment(experiment, passphrase, options = {}) {
    validatePassphrase(passphrase)
    const cryptoApi = getCrypto(options)
    const iterations = options.iterations || DEFAULT_ITERATIONS
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('invalid-iterations')
    const salt = cryptoApi.getRandomValues(new Uint8Array(16))
    const iv = cryptoApi.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(cryptoApi, passphrase, salt, iterations, ['encrypt'])
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(`${FORMAT}:${VERSION}`) },
      key,
      encoder.encode(JSON.stringify(experiment))
    )
    return {
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
      data: bytesToBase64(new Uint8Array(ciphertext))
    }
  }

  async function decryptExperiment(envelope, passphrase, options = {}) {
    validatePassphrase(passphrase)
    if (!isEncryptedBackup(envelope) || envelope.kdf?.name !== 'PBKDF2' || envelope.kdf?.hash !== 'SHA-256' || envelope.cipher?.name !== 'AES-GCM') throw new Error('invalid-backup')
    const iterations = Number(envelope.kdf.iterations)
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('invalid-backup')
    const salt = base64ToBytes(envelope.kdf.salt, 16)
    const iv = base64ToBytes(envelope.cipher.iv, 12)
    if (salt.length !== 16 || iv.length !== 12) throw new Error('invalid-backup')
    const ciphertext = base64ToBytes(envelope.data)
    const cryptoApi = getCrypto(options)
    try {
      const key = await deriveKey(cryptoApi, passphrase, salt, iterations, ['decrypt'])
      const plaintext = await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(`${FORMAT}:${VERSION}`) },
        key,
        ciphertext
      )
      return JSON.parse(decoder.decode(plaintext))
    } catch {
      throw new Error('decryption-failed')
    }
  }

  return {
    FORMAT,
    VERSION,
    DEFAULT_ITERATIONS,
    MIN_PASSPHRASE_LENGTH,
    isStrongPassphrase,
    isEncryptedBackup,
    encryptExperiment,
    decryptExperiment
  }
})
