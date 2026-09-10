(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CometQuantPlatesTiff = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  class ByteWriter {
    constructor(size = 4096) { this.buffer = new Uint8Array(size); this.length = 0 }
    byte(value) {
      if (this.length === this.buffer.length) {
        const grown = new Uint8Array(this.buffer.length * 2)
        grown.set(this.buffer)
        this.buffer = grown
      }
      this.buffer[this.length++] = value
    }
    finish() { return this.buffer.slice(0, this.length) }
  }

  // TIFF LZW packs variable-width codes most-significant bit first and resets at 4096 entries.
  function lzwEncode(input) {
    const output = new ByteWriter(Math.max(64, Math.ceil(input.length * 0.7)))
    let bits = 0
    let bitCount = 0
    let width = 9
    let nextCode = 258
    let dictionary = new Map()
    function emit(code) {
      bits = bits * (2 ** width) + code
      bitCount += width
      while (bitCount >= 8) {
        bitCount -= 8
        output.byte(Math.floor(bits / (2 ** bitCount)) & 255)
        bits %= 2 ** bitCount
      }
    }
    function reset() { dictionary = new Map(); width = 9; nextCode = 258 }
    emit(256)
    if (input.length) {
      let prefix = input[0]
      for (let index = 1; index < input.length; index += 1) {
        const value = input[index]
        const key = `${prefix},${value}`
        const known = dictionary.get(key)
        if (known !== undefined) {
          prefix = known
        } else {
          emit(prefix)
          if (nextCode < 4096) {
            dictionary.set(key, nextCode++)
            if (nextCode === (1 << width) && width < 12) width += 1
          } else {
            emit(256)
            reset()
          }
          prefix = value
        }
      }
      emit(prefix)
    }
    emit(257)
    if (bitCount) output.byte((bits * (2 ** (8 - bitCount))) & 255)
    return output.finish()
  }

  function lzwDecode(input, expectedLength) {
    let offset = 0
    let bits = 0
    let bitCount = 0
    let width = 9
    let nextCode = 258
    let dictionary = []
    for (let index = 0; index < 256; index += 1) dictionary[index] = Uint8Array.of(index)
    function code() {
      while (bitCount < width && offset < input.length) { bits = bits * 256 + input[offset++]; bitCount += 8 }
      if (bitCount < width) return null
      bitCount -= width
      const value = Math.floor(bits / (2 ** bitCount))
      bits %= 2 ** bitCount
      return value
    }
    function reset() { dictionary.length = 258; width = 9; nextCode = 258 }
    const output = new Uint8Array(expectedLength)
    let outputOffset = 0
    let previous = null
    while (true) {
      const value = code()
      if (value === null || value === 257) break
      if (value === 256) { reset(); previous = null; continue }
      let entry = dictionary[value]
      if (!entry && value === nextCode && previous) {
        entry = new Uint8Array(previous.length + 1)
        entry.set(previous)
        entry[entry.length - 1] = previous[0]
      }
      if (!entry) throw new Error('Fluxo LZW TIFF inválido.')
      if (outputOffset + entry.length > output.length) throw new Error('Fluxo LZW excede o tamanho esperado.')
      output.set(entry, outputOffset)
      outputOffset += entry.length
      if (previous && nextCode < 4096) {
        const added = new Uint8Array(previous.length + 1)
        added.set(previous)
        added[added.length - 1] = entry[0]
        dictionary[nextCode++] = added
        // The decoder reconstructs each entry one code after the encoder creates it.
        if (nextCode === (1 << width) - 1 && width < 12) width += 1
      }
      previous = entry
    }
    if (outputOffset !== expectedLength) throw new Error(`LZW produziu ${outputOffset} bytes; esperado: ${expectedLength}.`)
    return output
  }

  function encode(options) {
    const width = Number(options.width)
    const height = Number(options.height)
    const dpi = Number(options.dpi || 600)
    const rowsPerStrip = Number(options.rowsPerStrip || 64)
    const rawStrips = options.strips || []
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !Number.isInteger(rowsPerStrip) || rowsPerStrip < 1) throw new Error('Dimensões TIFF inválidas.')
    const stripCount = Math.ceil(height / rowsPerStrip)
    if (rawStrips.length !== stripCount) throw new Error(`Esperados ${stripCount} strips; recebidos ${rawStrips.length}.`)
    rawStrips.forEach((strip, index) => {
      const rows = Math.min(rowsPerStrip, height - index * rowsPerStrip)
      if (!(strip instanceof Uint8Array) || strip.length !== width * rows) throw new Error(`Strip ${index + 1} possui tamanho inválido.`)
    })
    const compressed = rawStrips.map(lzwEncode)
    const tags = 12
    const ifdOffset = 8
    const ifdSize = 2 + tags * 12 + 4
    let extraOffset = ifdOffset + ifdSize
    const offsetsArrayOffset = stripCount > 1 ? extraOffset : 0
    if (stripCount > 1) extraOffset += stripCount * 4
    const countsArrayOffset = stripCount > 1 ? extraOffset : 0
    if (stripCount > 1) extraOffset += stripCount * 4
    const xResolutionOffset = extraOffset
    const yResolutionOffset = extraOffset + 8
    const dataOffset = extraOffset + 16
    const stripOffsets = []
    let cursor = dataOffset
    compressed.forEach(strip => { stripOffsets.push(cursor); cursor += strip.length })
    const buffer = new ArrayBuffer(cursor)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    view.setUint8(0, 0x49); view.setUint8(1, 0x49); view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true)
    view.setUint16(ifdOffset, tags, true)
    let entryOffset = ifdOffset + 2
    function tag(id, type, count, value) {
      view.setUint16(entryOffset, id, true); view.setUint16(entryOffset + 2, type, true); view.setUint32(entryOffset + 4, count, true)
      if (type === 3 && count === 1) view.setUint16(entryOffset + 8, value, true)
      else view.setUint32(entryOffset + 8, value, true)
      entryOffset += 12
    }
    tag(256, 4, 1, width)
    tag(257, 4, 1, height)
    tag(258, 3, 1, 8)
    tag(259, 3, 1, 5)
    tag(262, 3, 1, 1)
    tag(273, 4, stripCount, stripCount === 1 ? stripOffsets[0] : offsetsArrayOffset)
    tag(277, 3, 1, 1)
    tag(278, 4, 1, rowsPerStrip)
    tag(279, 4, stripCount, stripCount === 1 ? compressed[0].length : countsArrayOffset)
    tag(282, 5, 1, xResolutionOffset)
    tag(283, 5, 1, yResolutionOffset)
    tag(296, 3, 1, 2)
    view.setUint32(entryOffset, 0, true)
    if (stripCount > 1) compressed.forEach((strip, index) => { view.setUint32(offsetsArrayOffset + index * 4, stripOffsets[index], true); view.setUint32(countsArrayOffset + index * 4, strip.length, true) })
    view.setUint32(xResolutionOffset, dpi, true); view.setUint32(xResolutionOffset + 4, 1, true)
    view.setUint32(yResolutionOffset, dpi, true); view.setUint32(yResolutionOffset + 4, 1, true)
    compressed.forEach((strip, index) => bytes.set(strip, stripOffsets[index]))
    return buffer
  }

  function inspect(buffer) {
    const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength || buffer.byteLength)
    if (view.getUint16(0, true) !== 0x4949 || view.getUint16(2, true) !== 42) throw new Error('Arquivo não é TIFF little-endian válido.')
    const ifd = view.getUint32(4, true)
    const count = view.getUint16(ifd, true)
    const tags = {}
    for (let index = 0; index < count; index += 1) {
      const offset = ifd + 2 + index * 12
      const id = view.getUint16(offset, true)
      const type = view.getUint16(offset + 2, true)
      const amount = view.getUint32(offset + 4, true)
      const valueOffset = offset + 8
      let value
      if (type === 3 && amount === 1) value = view.getUint16(valueOffset, true)
      else if (amount === 1 && type !== 5) value = view.getUint32(valueOffset, true)
      else if (type === 5 && amount === 1) { const pointer = view.getUint32(valueOffset, true); value = view.getUint32(pointer, true) / view.getUint32(pointer + 4, true) }
      else { const pointer = view.getUint32(valueOffset, true); value = Array.from({ length: amount }, (_, item) => view.getUint32(pointer + item * 4, true)) }
      tags[id] = value
    }
    return tags
  }

  function validate(buffer, expected) {
    const tags = inspect(buffer)
    const required = {
      256: expected.width,
      257: expected.height,
      258: 8,
      259: 5,
      262: 1,
      277: 1,
      282: expected.dpi || 600,
      283: expected.dpi || 600,
      296: 2
    }
    Object.entries(required).forEach(([id, value]) => {
      if (tags[id] !== value) throw new Error(`Tag TIFF ${id} inválida: ${tags[id]}; esperado: ${value}.`)
    })
    const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength)
    const ifd = view.getUint32(4, true)
    const entries = view.getUint16(ifd, true)
    if (view.getUint32(ifd + 2 + entries * 12, true) !== 0) throw new Error('O TIFF deveria conter uma única página.')
    return tags
  }

  return { lzwEncode, lzwDecode, encode, inspect, validate }
})
