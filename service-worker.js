// Nome do "cache" — funciona como um rótulo
// Quando atualizar o app, mude o número da versão aqui
const SHELL_CACHE_PREFIX = 'cometquant-shell-'
const SCIENCE_CACHE_PREFIX = 'cometquant-science-'
const CACHE_NAME = `${SHELL_CACHE_PREFIX}v21`
const SHELL_READY_MARKER = './cometquant-shell-ready'

// Lista de todos os arquivos que o Service Worker vai guardar
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/legacy-xlsx.js',
  './js/backup.js',
  './js/core.js',
  './js/repository.js',
  './js/export.js',
  './js/i18n.js',
  './js/science-package.js',
  './js/analysis.js',
  './js/analysis-worker.js',
  './science-assets.json',
  './python/cometquant_analysis.py',
  './vendor/jszip.min.js',
  './icons/class_0.png',
  './icons/class_1.png',
  './icons/class_2.png',
  './icons/class_3.png',
  './icons/class_4.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
]

// EVENTO 1: "install"
// Executado uma única vez, quando o app é aberto pela primeira vez
// Aqui o Service Worker salva todos os arquivos na memória do celular
self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('CometQuant: arquivos salvos para uso offline')
        return cache.addAll(FILES_TO_CACHE)
          .then(() => cache.put(SHELL_READY_MARKER, new Response(CACHE_NAME, {
            headers: { 'Content-Type': 'text/plain' }
          })))
      })
  )
})

// EVENTO 2: "activate"
// Executado quando uma nova versão do app é instalada
// Limpa caches antigos para liberar espaço no celular
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key.startsWith(SHELL_CACHE_PREFIX) && key !== CACHE_NAME) {
          console.log('CometQuant: removendo cache antigo', key)
          return caches.delete(key)
        }
      }))
    }).then(() => self.clients.claim())
  )
})

// EVENTO 3: "fetch"
// Executado toda vez que o app tenta buscar qualquer arquivo
// A lógica é: tenta buscar da internet; se não tiver, usa o cache
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se encontrou no cache, retorna o arquivo salvo
        if (response) {
          return response
        }
        // Se não encontrou, busca na internet normalmente
        return fetch(event.request)
      })
  )
})
