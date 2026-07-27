// Vite replaces this token in dist/sw.js so each release waits as a distinct update.
const CACHE_VERSION = '__BUILD_VERSION__'
const SHELL_CACHE = `thulla-shell-${CACHE_VERSION}`
const ASSET_CACHE = `thulla-assets-${CACHE_VERSION}`
const SHELL_URL = '/'
const CORE_ASSETS = [
  '/offline.html',
  '/platform.css',
  '/manifest.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

async function cacheBuildAssets(cache, requests) {
  const entries = await Promise.all(requests.map(async (request) => {
    const response = await fetch(request)
    if (!response.ok || response.type !== 'basic') {
      throw new Error(`Could not fetch application bundle: ${request.url}`)
    }

    // CacheStorage exposes the decoded body, while development/static hosts
    // can retain transfer-only gzip and Origin-varying headers. Replaying that
    // combination for Vite's `crossorigin` module/style tags makes Chromium
    // reject an otherwise complete cached bundle. Store a same-origin replay
    // response with representation headers only.
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    headers.delete('vary')
    headers.delete('access-control-allow-origin')
    const cachedResponse = new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
    return [request, cachedResponse]
  }))

  await Promise.all(entries.map(([request, response]) => cache.put(request, response)))
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)

    // Vite fingerprints the application bundles. Discover the current build's
    // URLs from its HTML so the first controlled offline launch has both the
    // document and every script/stylesheet it needs.
    const response = await fetch(SHELL_URL, { cache: 'no-cache' })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || response.type !== 'basic' || !contentType.includes('text/html')) {
      throw new Error('Could not fetch the same-origin application shell.')
    }
    const html = await response.clone().text()
    const builtAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
      .map((match) => match[1])
    if (!builtAssets.length) {
      throw new Error('Application shell did not reference any built assets.')
    }
    const builtRequests = [...new Set(builtAssets)].map(
      (asset) => new Request(asset, { mode: 'cors', credentials: 'same-origin' }),
    )
    // Cache every dependency before exposing the HTML entry point. A failed
    // dependency request therefore rejects installation without leaving a
    // cached document that could open to a blank screen. Vite marks its bundle
    // tags `crossorigin`, so store those requests in the same CORS mode the
    // HTML parser will use when the app is launched offline.
    await cache.addAll(CORE_ASSETS)
    await cacheBuildAssets(cache, builtRequests)
    await cache.put(SHELL_URL, response)
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('thulla-') && ![SHELL_CACHE, ASSET_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

function isLiveRequest(url) {
  return url.pathname.startsWith('/socket.io')
    || url.pathname.startsWith('/api')
    || url.pathname === '/health'
    || url.pathname === '/ready'
}

function isStaticAsset(request, url) {
  return CORE_ASSETS.includes(url.pathname)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || ['style', 'script', 'font', 'image'].includes(request.destination)
}

async function networkFirstNavigation(request) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(request, { signal: controller.signal })
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && response.type === 'basic' && contentType.includes('text/html')) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(SHELL_URL, response.clone())
    }
    return response
  } catch {
    return (await caches.match(SHELL_URL)) ?? caches.match('/offline.html')
  } finally {
    clearTimeout(timeout)
  }
}

function staleWhileRevalidate(request, event) {
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(ASSET_CACHE)
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)
  // Extend the event synchronously. Calling waitUntil after an awaited cache
  // lookup can make browsers reject parser-initiated script/style requests.
  event.waitUntil(network.then(() => undefined))
  return (async () => {
    // Core files and fingerprinted build assets live in SHELL_CACHE; runtime
    // images/fonts live in ASSET_CACHE. Search both before going to network.
    const cached = await caches.match(request)
    return cached ?? (await network) ?? Response.error()
  })()
}

async function cacheFirstBuildAsset(request) {
  // Vite filenames are content-addressed and the install step has already
  // proved that each one is present. Returning that exact cached response
  // keeps parser-initiated module/style loads independent of the network.
  // A network fallback is only a recovery path for a manually damaged cache.
  return (await caches.match(request)) ?? fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isLiveRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstBuildAsset(request))
    return
  }

  if (isStaticAsset(request, url)) event.respondWith(staleWhileRevalidate(request, event))
})
