// Nome do "cache" — funciona como um rótulo
// Quando atualizar o app, mude o número da versão aqui
const CACHE_NAME = 'cometquant-v1'

// Lista de todos os arquivos que o Service Worker vai guardar
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js'
]

// EVENTO 1: "install"
// Executado uma única vez, quando o app é aberto pela primeira vez
// Aqui o Service Worker salva todos os arquivos na memória do celular
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('CometQuant: arquivos salvos para uso offline')
        return cache.addAll(FILES_TO_CACHE)
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
        if (key !== CACHE_NAME) {
          console.log('CometQuant: removendo cache antigo', key)
          return caches.delete(key)
        }
      }))
    })
  )
})

// EVENTO 3: "fetch"
// Executado toda vez que o app tenta buscar qualquer arquivo
// A lógica é: tenta buscar da internet; se não tiver, usa o cache
self.addEventListener('fetch', event => {
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