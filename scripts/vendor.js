const fs = require('node:fs')
const path = require('node:path')

const source = require.resolve('jszip/dist/jszip.min.js')
const targetDir = path.resolve(__dirname, '../vendor')
const target = path.join(targetDir, 'jszip.min.js')

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
