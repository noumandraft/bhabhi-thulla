import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

function check(condition, message) {
  if (!condition) errors.push(message)
}

async function text(path) {
  return readFile(resolve(root, path), 'utf8')
}

async function exists(path) {
  try {
    const details = await stat(resolve(root, path))
    return details.isFile() && details.size > 0
  } catch {
    return false
  }
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function attributeContent(source, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`<meta\\s+[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i')
  return source.match(pattern)?.[1]
}

function jsonLdBlocks(source) {
  return [...source.matchAll(/<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]))
}

const html = await text('index.html')
const packageJson = JSON.parse(await text('package.json'))
const manifest = JSON.parse(await text('public/manifest.webmanifest'))
const serviceWorker = await text('public/sw.js')
const main = await text('src/main.tsx')
const canonicalUrl = 'https://thulla.joypad.fun/'
const expectedTitle = 'Play Bhabhi Thulla Online | Pakistani Getaway Card Game'
const expectedDescription = 'Play Bhabhi Thulla online with friends using Pakistani rules. Create a private multiplayer room, learn the Getaway card game, and play free without signup.'
const expectedGoogleVerification = '9cP7p25n5EnvgnfWRGZXAMF-2lT_SLyVtKvlvPr-hhs'
const coreAssetBlock = serviceWorker.match(/const CORE_ASSETS = \[([\s\S]*?)\]\r?\n/)?.[1] ?? ''
const coreAssetUrls = [...coreAssetBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])

function validateSeoPage(source, label) {
  const documentTitle = source.match(/<title>([^<]+)<\/title>/i)?.[1]
  const canonical = source.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1]
  check(documentTitle === expectedTitle, `${label}: document title must use the approved SEO positioning.`)
  check(attributeContent(source, 'name', 'description') === expectedDescription, `${label}: meta description must use the approved SEO copy.`)
  check(attributeContent(source, 'name', 'google-site-verification') === expectedGoogleVerification, `${label}: Google Search Console verification tag is missing or incorrect.`)
  check(canonical === canonicalUrl, `${label}: canonical URL must stay at the production application root.`)
  check(attributeContent(source, 'property', 'og:title') === expectedTitle, `${label}: Open Graph title must match the document title.`)
  check(attributeContent(source, 'property', 'og:description') === expectedDescription, `${label}: Open Graph description must match the meta description.`)
  check(attributeContent(source, 'property', 'og:url') === canonicalUrl, `${label}: Open Graph URL must match the canonical URL.`)
  check(attributeContent(source, 'name', 'twitter:title') === expectedTitle, `${label}: Twitter title must match the document title.`)
  check(attributeContent(source, 'name', 'twitter:description') === expectedDescription, `${label}: Twitter description must match the meta description.`)

  let structuredData = []
  try {
    structuredData = jsonLdBlocks(source)
  } catch (error) {
    errors.push(`${label}: structured data is not valid JSON: ${error.message}`)
  }
  const gameSchema = structuredData.find((entry) => {
    const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']]
    return types.includes('VideoGame') && types.includes('WebApplication')
  })
  check(Boolean(gameSchema), `${label}: structured data must describe the product as both a VideoGame and WebApplication.`)
  if (!gameSchema) return

  check(gameSchema['@context'] === 'https://schema.org', `${label}: game structured data must use the Schema.org context.`)
  check(gameSchema['@id'] === `${canonicalUrl}#game`, `${label}: game structured-data ID must be anchored to the canonical URL.`)
  check(gameSchema.url === canonicalUrl, `${label}: game structured-data URL must match the canonical URL.`)
  check(gameSchema.name === 'Bhabhi Thulla', `${label}: game structured data must include the product name.`)
  check(gameSchema.description === expectedDescription, `${label}: game structured-data description must match the page description.`)
  check(gameSchema.applicationCategory === 'GameApplication', `${label}: game structured data must use the GameApplication category.`)
  check(gameSchema.operatingSystem === 'Any', `${label}: the web game must declare operating-system independence.`)
  check(gameSchema.isAccessibleForFree === true, `${label}: the game must be marked as free to access.`)
  check(gameSchema.offers?.['@type'] === 'Offer' && gameSchema.offers?.price === 0, `${label}: the free game must include a numeric zero-price Offer.`)
  check(Array.isArray(gameSchema.playMode) && gameSchema.playMode.includes('https://schema.org/MultiPlayer'), `${label}: game structured data must identify multiplayer play.`)
  check(!('aggregateRating' in gameSchema) && !('review' in gameSchema), `${label}: structured data must not contain unverified ratings or reviews.`)
}

for (const expected of [
  'rel="canonical"',
  'rel="manifest"',
  'rel="apple-touch-icon"',
  'property="og:title"',
  'property="og:image"',
  'name="twitter:card"',
  'name="theme-color"',
  'viewport-fit=cover',
]) check(html.includes(expected), `index.html is missing ${expected}`)

validateSeoPage(html, 'index.html')

check(manifest.id === '/', 'Manifest id must stay at the application root.')
check(manifest.scope === '/', 'Manifest scope must stay at the application root.')
check(manifest.display === 'standalone', 'Manifest must use standalone display mode.')
check(manifest.start_url?.startsWith('/'), 'Manifest start_url must be same-origin.')
check(manifest.icons?.some((icon) => icon.sizes === '192x192'), 'Manifest needs a 192x192 icon.')
check(manifest.icons?.some((icon) => icon.sizes === '512x512'), 'Manifest needs a 512x512 icon.')
check(manifest.icons?.some((icon) => icon.purpose?.includes('maskable')), 'Manifest needs a maskable icon.')

for (const icon of manifest.icons ?? []) {
  check(!/^https?:/i.test(icon.src), `Manifest icon must be same-origin: ${icon.src}`)
  check(await exists(`public${icon.src}`), `Manifest icon does not exist: ${icon.src}`)
}

check(coreAssetUrls.length > 0, 'Service worker must define a non-empty core asset list.')
for (const assetUrl of coreAssetUrls) {
  check(assetUrl !== '/', 'Application HTML must be cached only after every dependency succeeds.')
  check(!['/socket.io', '/api', '/health', '/ready'].some((path) => assetUrl.startsWith(path)), `Live endpoint must not be precached: ${assetUrl}`)
  check(await exists(`public${assetUrl}`), `Core offline asset does not exist: ${assetUrl}`)
}

const expectedPngs = {
  'public/icons/icon-192.png': [192, 192],
  'public/icons/icon-512.png': [512, 512],
  'public/icons/icon-maskable-512.png': [512, 512],
  'public/icons/apple-touch-icon.png': [180, 180],
  'public/social-preview.png': [1200, 630],
}
for (const [path, [width, height]] of Object.entries(expectedPngs)) {
  try {
    const dimensions = pngDimensions(await readFile(resolve(root, path)))
    check(dimensions?.width === width && dimensions?.height === height, `${path} must be ${width}x${height}.`)
  } catch {
    errors.push(`${path} is missing.`)
  }
}

for (const livePath of ['/socket.io', '/api', '/health', '/ready']) {
  check(serviceWorker.includes(livePath), `Service worker must explicitly exclude ${livePath}.`)
}
check(serviceWorker.includes("request.method !== 'GET'"), 'Service worker must ignore non-GET requests.')
check(serviceWorker.includes('url.origin !== self.location.origin'), 'Service worker must ignore cross-origin requests.')
check(serviceWorker.includes("html.matchAll(/(?:src|href)="), 'Service worker must discover and precache fingerprinted application bundles.')
check(serviceWorker.includes("new Request(asset, { mode: 'cors', credentials: 'same-origin' })"), 'Precached Vite bundles must match their crossorigin parser requests.')
check(serviceWorker.includes("if (!builtAssets.length)"), 'Service-worker installation must fail closed when built bundles cannot be discovered.')
check(serviceWorker.includes("throw new Error('Application shell did not reference any built assets.')"), 'Missing built bundles must reject service-worker installation.')
check((serviceWorker.match(/contentType\.includes\('text\/html'\)/g) ?? []).length === 2, 'Install and navigation updates must cache only verified HTML shell responses.')
check(serviceWorker.includes('await cache.addAll(CORE_ASSETS)') && serviceWorker.includes('await cacheBuildAssets(cache, builtRequests)'), 'Service worker must cache core files and every bundle before exposing its HTML entry point.')
check(
  serviceWorker.indexOf('await cache.addAll(CORE_ASSETS)') < serviceWorker.indexOf('await cache.put(SHELL_URL, response)')
    && serviceWorker.indexOf('await cacheBuildAssets(cache, builtRequests)') < serviceWorker.indexOf('await cache.put(SHELL_URL, response)'),
  'Service worker must cache all dependencies before caching the application HTML.',
)
check(serviceWorker.includes("headers.delete('content-encoding')") && serviceWorker.includes("headers.delete('vary')"), 'Cached crossorigin bundles must remove transfer-only and Origin-varying response headers.')
check(serviceWorker.includes('await caches.match(request)'), 'Static requests must search both shell and runtime caches.')
check(serviceWorker.includes('event.waitUntil(network.then'), 'Background cache refreshes must extend the fetch-event lifetime.')
check(serviceWorker.includes('function staleWhileRevalidate(request, event)'), 'Static cache strategy must call waitUntil from the synchronous fetch-event stack.')
check(!serviceWorker.includes('async function staleWhileRevalidate'), 'Static cache strategy must not defer waitUntil behind an awaited lookup.')
check(serviceWorker.includes('cacheFirstBuildAsset(request)'), 'Fingerprint-named build assets must use an offline-safe cache-first path.')
check(serviceWorker.includes('CORE_ASSETS.includes(url.pathname)'), 'Core metadata such as the web manifest must remain available offline.')
const installHandler = serviceWorker.slice(
  serviceWorker.indexOf("self.addEventListener('install'"),
  serviceWorker.indexOf("self.addEventListener('activate'"),
)
check(!installHandler.includes('skipWaiting'), 'Service worker must not activate a new build automatically during a game.')
check((serviceWorker.match(/skipWaiting\(\)/g) ?? []).length === 1, 'Service worker may call skipWaiting only from the explicit update message handler.')
check((main.match(/SKIP_WAITING/g) ?? []).length === 1, 'Client may request service-worker activation only from the update action.')
check(main.includes('updateReloadRequested = true'), 'Client must reload only after the player requests an update.')
check(html.includes('id="platform-notices"'), 'The offline/update announcement region is missing.')

const liveGuard = serviceWorker.indexOf('if (url.origin !== self.location.origin || isLiveRequest(url)) return')
const navigationHandler = serviceWorker.indexOf("if (request.mode === 'navigate')")
check(liveGuard >= 0 && liveGuard < navigationHandler, 'Live and cross-origin requests must bypass every service-worker cache strategy.')

if (await exists('dist/index.html')) {
  const builtHtml = await text('dist/index.html')
  const builtServiceWorker = await text('dist/sw.js')
  validateSeoPage(builtHtml, 'dist/index.html')
  check((builtHtml.match(/<main(?:\s|>)/gi) ?? []).length === 1, 'Built HTML must prerender exactly one main landmark.')
  check((builtHtml.match(/<h1(?:\s|>)/gi) ?? []).length === 1, 'Built HTML must prerender exactly one H1.')
  check((builtHtml.match(/<article(?:\s|>)/gi) ?? []).length === 1, 'Built HTML must prerender exactly one guide article.')
  check(!builtHtml.includes('<div id="root"></div>'), 'Built HTML must not leave the React root empty.')
  check(builtHtml.includes('Bhabhi Thulla card game rules'), 'Built HTML must include the crawlable Pakistani rules heading.')
  check(builtHtml.includes('What is Bhabhi Thulla called in English?'), 'Built HTML must include the crawlable English-name answer.')
  check(builtHtml.includes('type="module"'), 'SEO prerendering must preserve the client module script.')
  const builtAssetUrls = [...builtHtml.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
    .map((match) => match[1])
  check(builtAssetUrls.length >= 2, 'Built HTML must reference at least its JavaScript and stylesheet bundles.')
  for (const assetUrl of new Set(builtAssetUrls)) {
    check(await exists(`dist${assetUrl}`), `Built application-shell asset is missing: ${assetUrl}`)
  }
  for (const assetUrl of coreAssetUrls) {
    check(await exists(`dist${assetUrl}`), `Built core offline asset is missing: ${assetUrl}`)
  }
  check(!builtServiceWorker.includes('__BUILD_VERSION__'), 'Built service worker still contains the unstamped cache-version token.')
  const escapedVersion = String(packageJson.version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cacheVersionPattern = new RegExp(`const CACHE_VERSION = '${escapedVersion}-[^']+-[a-f0-9]{10}'`)
  check(cacheVersionPattern.test(builtServiceWorker), 'Built service worker does not have a commit- and content-specific cache version.')
  check(builtServiceWorker.includes('await cacheBuildAssets(cache, builtRequests)'), 'Built service worker does not precache every discovered application bundle.')
}

const thirdPartyAnalyticsPatterns = [/google-analytics/i, /googletagmanager/i, /segment\.com/i, /mixpanel/i, /posthog/i]
for (const pattern of thirdPartyAnalyticsPatterns) {
  check(!pattern.test(html), `Unexpected third-party analytics reference: ${pattern}`)
}

if (errors.length) {
  console.error(`Platform QA failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('Platform QA passed: SEO metadata, game structured data, PWA assets, update safety, cache exclusions, and image dimensions are valid.')
}
