const tiff = require('../../js/plates/tiff.js')

function packLiteralCodes(literalCount) {
  const bytes = []
  let accumulator = 0
  let bitCount = 0
  let width = 9
  let nextCode = 258
  let previous = false
  const widths = new Set([width])
  function write(code) {
    accumulator = accumulator * (2 ** width) + code
    bitCount += width
    while (bitCount >= 8) {
      bitCount -= 8
      bytes.push(Math.floor(accumulator / (2 ** bitCount)) & 255)
      accumulator %= 2 ** bitCount
    }
  }
  function clear() { write(256); width = 9; nextCode = 258; previous = false }
  clear()
  for (let index = 0; index < literalCount; index += 1) {
    write(index & 255)
    if (previous && nextCode < 4096) {
      nextCode += 1
      if (nextCode === (1 << width) - 1 && width < 12) { width += 1; widths.add(width) }
    }
    previous = true
    if (nextCode === 4096 && index + 1 < literalCount) clear()
  }
  write(257)
  if (bitCount) bytes.push((accumulator * (2 ** (8 - bitCount))) & 255)
  return { encoded: Uint8Array.from(bytes), raw: Uint8Array.from({ length: literalCount }, (_, index) => index & 255), widths }
}

function referenceDecode(input) {
  let byteOffset = 0
  let accumulator = 0
  let bitCount = 0
  let width = 9
  let nextCode = 258
  let previous = null
  let clearCount = 0
  const widths = new Set([width])
  let dictionary = Array.from({ length: 256 }, (_, value) => [value])
  const output = []
  function read() {
    while (bitCount < width && byteOffset < input.length) { accumulator = accumulator * 256 + input[byteOffset++]; bitCount += 8 }
    if (bitCount < width) throw new Error('truncated reference stream')
    bitCount -= width
    const value = Math.floor(accumulator / (2 ** bitCount))
    accumulator %= 2 ** bitCount
    return value
  }
  while (true) {
    const code = read()
    if (code === 257) break
    if (code === 256) {
      dictionary = Array.from({ length: 256 }, (_, value) => [value])
      width = 9; nextCode = 258; previous = null; clearCount += 1
      continue
    }
    let entry = dictionary[code]
    if (!entry && code === nextCode && previous) entry = previous.concat(previous[0])
    if (!entry) throw new Error(`invalid reference code ${code}`)
    output.push(...entry)
    if (previous && nextCode < 4096) {
      dictionary[nextCode++] = previous.concat(entry[0])
      if (nextCode === (1 << width) - 1 && width < 12) { width += 1; widths.add(width) }
    }
    previous = entry
  }
  return { raw: Uint8Array.from(output), widths, clearCount }
}

function valuesAt(view, value, count) {
  return count === 1 ? [value] : Array.from({ length: count }, (_, index) => view.getUint32(value + index * 4, true))
}

function entries(buffer) {
  const view = new DataView(buffer)
  const ifd = view.getUint32(4, true)
  const count = view.getUint16(ifd, true)
  const result = new Map()
  for (let index = 0; index < count; index += 1) {
    const offset = ifd + 2 + index * 12
    result.set(view.getUint16(offset, true), {
      type: view.getUint16(offset + 2, true), count: view.getUint32(offset + 4, true),
      value: view.getUint32(offset + 8, true), shortValue: view.getUint16(offset + 8, true)
    })
  }
  return { view, result }
}

describe('grayscale TIFF encoder', () => {
  it('matches a canonical fixed-width TIFF LZW vector', () => {
    const source = Uint8Array.from(Buffer.from('TOBEORNOTTOBEORTOBEORNOT', 'ascii'))
    const expected = '801509e422293ca44e2795205048342e0b0784c040'

    expect(Buffer.from(tiff.lzwEncode(source)).toString('hex')).toBe(expected)
    expect(tiff.lzwDecode(Uint8Array.from(Buffer.from(expected, 'hex')), source.length)).toEqual(source)
  })

  it('encodes 9, 10, 11 and 12-bit codes plus reset for an independent decoder', () => {
    const source = new Uint8Array(30000)
    let value = 0x12345678
    for (let index = 0; index < source.length; index += 1) { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; source[index] = value >>> 24 }
    const compressed = tiff.lzwEncode(source)
    const decoded = referenceDecode(compressed)

    expect(decoded.raw).toEqual(source)
    expect(Array.from(decoded.widths)).toEqual([9, 10, 11, 12])
    expect(decoded.clearCount).toBeGreaterThan(1)
  })

  it('decodes an independently packed stream across every width and reset', () => {
    const vector = packLiteralCodes(5000)

    expect(Array.from(vector.widths)).toEqual([9, 10, 11, 12])
    expect(tiff.lzwDecode(vector.encoded, vector.raw.length)).toEqual(vector.raw)
  })

  it('writes one-page 8-bit BlackIsZero LZW strips with 600 dpi tags', () => {
    const width = 37
    const height = 130
    const rowsPerStrip = 64
    const strips = Array.from({ length: Math.ceil(height / rowsPerStrip) }, (_, stripIndex) => {
      const rows = Math.min(rowsPerStrip, height - stripIndex * rowsPerStrip)
      return Uint8Array.from({ length: width * rows }, (_, index) => (index * 17 + stripIndex * 31) & 255)
    })
    const buffer = tiff.encode({ width, height, dpi: 600, rowsPerStrip, strips })
    const tags = tiff.inspect(buffer)

    expect(tags).toMatchObject({ 256: width, 257: height, 258: 8, 259: 5, 262: 1, 277: 1, 278: rowsPerStrip, 282: 600, 283: 600, 296: 2 })
    expect(() => tiff.validate(buffer, { width, height, dpi: 600 })).not.toThrow()
    const { view, result } = entries(buffer)
    const offsets = valuesAt(view, result.get(273).value, result.get(273).count)
    const counts = valuesAt(view, result.get(279).value, result.get(279).count)
    offsets.forEach((offset, index) => {
      const encoded = new Uint8Array(buffer, offset, counts[index])
      expect(tiff.lzwDecode(encoded, strips[index].length)).toEqual(strips[index])
    })
    expect(view.getUint32(view.getUint32(4, true) + 2 + result.size * 12, true)).toBe(0)
  })
})
