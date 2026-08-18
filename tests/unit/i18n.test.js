const fs = require('node:fs')
const path = require('node:path')

describe('internationalized interface', () => {
  it('defines every static interface key in Portuguese and English', () => {
    const root = path.resolve(__dirname, '../..')
    const i18n = fs.readFileSync(path.join(root, 'js/i18n.js'), 'utf8')
    const [portuguese, english] = i18n.split("  'en': {")
    const sources = [
      fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
      fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'),
      fs.readFileSync(path.join(root, 'js/analysis.js'), 'utf8')
    ]
    const keys = new Set()
    sources.forEach(source => {
      for (const match of source.matchAll(/\bt\('([^']+)'/g)) keys.add(match[1])
      for (const match of source.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) keys.add(match[1])
    })

    for (const key of keys) {
      expect(portuguese, `missing Portuguese key: ${key}`).toContain(`'${key}':`)
      expect(english, `missing English key: ${key}`).toContain(`'${key}':`)
    }
  })
})
