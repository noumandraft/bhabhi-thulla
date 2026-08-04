import { spawn } from 'node:child_process'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { io } from 'socket.io-client'

const SERVER_URL = process.env.QA_SERVER_URL ?? 'http://localhost:3001'
const CLIENT_URL = process.env.QA_CLIENT_URL ?? 'http://localhost:5173'
const OUTPUT_DIR = resolve(process.env.QA_OUTPUT_DIR ?? 'design/qa')
const DEBUG_PORT = Number(process.env.QA_CHROME_PORT ?? 9333)
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
  { name: 'landscape', width: 844, height: 390 },
]
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH and run again.')
}

function emitAck(socket, event, payload) {
  return new Promise((resolveAck, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 8_000)
    socket.emit(event, payload, (response) => {
      clearTimeout(timeout)
      if (response?.ok) resolveAck(response.data)
      else reject(new Error(response?.error ?? `${event} failed`))
    })
  })
}

async function connectedSocket() {
  const socket = io(SERVER_URL, { transports: ['websocket'] })
  await new Promise((resolveConnection, reject) => {
    socket.once('connect', resolveConnection)
    socket.once('connect_error', reject)
  })
  return socket
}

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {
      // Chrome is still starting.
    }
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.events = []
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) {
        this.events.push(message)
        return
      }
      if (!this.pending.has(message.id)) return
      const { resolveMessage, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolveMessage(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolveMessage, reject) => {
      this.pending.set(id, { resolveMessage, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result.value
}

async function waitForExpression(cdp, expression, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(cdp, expression)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await waitForExpression(cdp, `innerWidth === ${width} && innerHeight === ${height}`)
}

const diagnosticsExpression = `(() => {
  const root = document.documentElement
  const visible = (element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight
  }
  const named = (element) => {
    if (element.getAttribute('aria-label')?.trim()) return true
    if (element.getAttribute('aria-labelledby')?.trim()) return true
    if (element.textContent?.trim()) return true
    if (element instanceof HTMLInputElement) {
      return Boolean(element.labels?.length || element.title || element.placeholder)
    }
    return false
  }
  const interactive = [...document.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
  const controls = interactive.map((element) => {
    const labelledTarget = element.matches('input[type="checkbox"], input[type="radio"]') ? element.closest('label') : null
    const box = (labelledTarget ?? element).getBoundingClientRect()
    return {
      label: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 80) || element.id || element.tagName,
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
  })
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  const overflowingElements = [...document.querySelectorAll('body *')]
    .filter(visible)
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1)
    .slice(0, 12)
    .map(({ element, box }) => ({
      selector: element.tagName.toLowerCase()
        + (element.id ? '#' + element.id : '')
        + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().replace(/\s+/g, '.') : ''),
      left: Math.round(box.left),
      right: Math.round(box.right),
      width: Math.round(box.width),
    }))
  const rightSeat = document.querySelector('.game-v2-seat.is-right-player')
  const rightBox = rightSeat?.getBoundingClientRect()
  const resolution = document.querySelector('.game-v2-resolution, [data-game-phase="resolving"]')
  const lastCard = document.querySelector('.game-v2-trick-card.is-last-played')
  const thullaStatus = document.querySelector('.game-v2-status.is-thulla')
  const thullaStatusRect = thullaStatus?.getBoundingClientRect()
  const lastCardRect = lastCard?.getBoundingClientRect()
  const lastCardStyle = lastCard ? getComputedStyle(lastCard) : null
  const tableTalkDrawer = document.querySelector('.table-talk__drawer:not([hidden])')
  const tableTalkDrawerRect = tableTalkDrawer?.getBoundingClientRect()
  const tableTalkComposer = tableTalkDrawer?.querySelector('.table-talk__composer')
  const tableTalkComposerRect = tableTalkComposer?.getBoundingClientRect()
  const tableTalkTextareaRect = tableTalkDrawer?.querySelector('textarea')?.getBoundingClientRect()
  const tableTalkSendRect = tableTalkDrawer?.querySelector('.table-talk__send')?.getBoundingClientRect()
  const platformNotice = document.querySelector('.platform-notice')
  const platformNoticeRect = platformNotice?.getBoundingClientRect()
  const tableTalkTrigger = document.querySelector('.table-talk__trigger')
  const tableTalkTriggerLabel = tableTalkTrigger?.querySelector('.table-talk__trigger-label')
  const currentTrick = document.querySelector('.game-v2-trick')
  const currentTrickRect = currentTrick?.getBoundingClientRect()
  const waitingStrip = document.querySelector('.game-v2-waiting-strip')
  const waitingStripRect = waitingStrip?.getBoundingClientRect()
  const leadPillRect = document.querySelector('.game-v2-lead')?.getBoundingClientRect()
  const matchLogRect = document.querySelector('.game-v2-log-toggle')?.getBoundingClientRect()
  const tableTalkTriggerRect = tableTalkTrigger?.getBoundingClientRect()
  const clock = document.querySelector('.game-v2-clock, .turn-clock')
  const clockStyle = clock ? getComputedStyle(clock) : null
  const parseRgb = (value) => (value?.match(/-?\\d*\\.?\\d+/g) ?? []).slice(0, 3).map(Number)
  const relativeLuminance = (value) => {
    const channels = parseRgb(value).map((channel) => {
      const normalized = channel / 255
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
    })
    return channels.length === 3 ? .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] : null
  }
  const clockForeground = relativeLuminance(clockStyle?.color)
  const clockBackground = relativeLuminance(clockStyle?.backgroundColor)
  const clockContrast = clockForeground === null || clockBackground === null
    ? null
    : (Math.max(clockForeground, clockBackground) + .05) / (Math.min(clockForeground, clockBackground) + .05)
  const fullyInside = (inner, outer) => Boolean(inner && outer
    && inner.left >= outer.left - 1
    && inner.top >= outer.top - 1
    && inner.right <= outer.right + 1
    && inner.bottom <= outer.bottom + 1)
  const lastCardVisible = Boolean(lastCardRect && lastCardStyle
    && lastCardRect.width > 0
    && lastCardRect.height > 0
    && lastCardStyle.display !== 'none'
    && lastCardStyle.visibility !== 'hidden'
    && Number(lastCardStyle.opacity) > 0.1)
  const thullaStatusOverlapsLastCard = Boolean(thullaStatusRect && lastCardRect
    && thullaStatusRect.left < lastCardRect.right
    && thullaStatusRect.right > lastCardRect.left
    && thullaStatusRect.top < lastCardRect.bottom
    && thullaStatusRect.bottom > lastCardRect.top)
  const overlaps = (first, second) => Boolean(first && second
    && first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top)
  return {
    viewport: [innerWidth, innerHeight],
    pageOverflowX: root.scrollWidth > innerWidth + 1,
    pageOverflowY: root.scrollHeight > innerHeight + 1,
    rightSeatVisible: rightBox ? rightBox.right > 0 && rightBox.left < innerWidth && rightBox.bottom > 0 && rightBox.top < innerHeight : null,
    resolutionText: resolution?.textContent?.trim().replace(/\\s+/g, ' ') ?? null,
    visibleTrickCards: document.querySelectorAll('.game-v2-trick-card').length,
    lastCardVisible,
    thullaStatusVisible: Boolean(thullaStatus),
    thullaStatusOverlapsLastCard,
    tableTalkDrawerVisible: Boolean(tableTalkDrawerRect && visible(tableTalkDrawer)),
    tableTalkDrawerFullyVisible: Boolean(tableTalkDrawerRect
      && tableTalkDrawerRect.left >= -1
      && tableTalkDrawerRect.top >= -1
      && tableTalkDrawerRect.right <= innerWidth + 1
      && tableTalkDrawerRect.bottom <= innerHeight + 1),
    tableTalkComposerVisible: Boolean(tableTalkComposer && visible(tableTalkComposer)),
    tableTalkComposerFullyVisible: fullyInside(tableTalkComposerRect, tableTalkDrawerRect),
    tableTalkTextareaFullyVisible: fullyInside(tableTalkTextareaRect, tableTalkDrawerRect),
    tableTalkSendFullyVisible: fullyInside(tableTalkSendRect, tableTalkDrawerRect),
    platformNoticeVisible: Boolean(platformNotice && visible(platformNotice)),
    platformNoticeFullyVisible: Boolean(platformNoticeRect
      && platformNoticeRect.left >= -1 && platformNoticeRect.top >= -1
      && platformNoticeRect.right <= innerWidth + 1 && platformNoticeRect.bottom <= innerHeight + 1),
    tableTalkTriggerVisible: Boolean(tableTalkTrigger && visible(tableTalkTrigger)),
    tableTalkLabelVisible: Boolean(tableTalkTriggerLabel && visible(tableTalkTriggerLabel)),
    tableTalkOverlapsCurrentTrick: Boolean(tableTalkDrawerRect && currentTrickRect
      && tableTalkDrawerRect.left < currentTrickRect.right
      && tableTalkDrawerRect.right > currentTrickRect.left
      && tableTalkDrawerRect.top < currentTrickRect.bottom
      && tableTalkDrawerRect.bottom > currentTrickRect.top),
    clockVisible: Boolean(clock && visible(clock)),
    clockColor: clockStyle?.color ?? null,
    clockBackgroundColor: clockStyle?.backgroundColor ?? null,
    clockContrast,
    waitingPanelVisible: Boolean(document.querySelector('.game-v2-waiting-player')),
    waitingStripVisible: Boolean(waitingStrip),
    waitingStripOverlapsLead: overlaps(waitingStripRect, leadPillRect),
    waitingStripOverlapsMatchLog: overlaps(waitingStripRect, matchLogRect),
    waitingStripOverlapsTableTalk: overlaps(waitingStripRect, tableTalkTriggerRect),
    waitingRemoveControls: document.querySelectorAll('.game-v2-remove-waiting').length,
    waitingReadyControlVisible: Boolean(document.querySelector('.game-v2-waiting-player .game-v2-button') && visible(document.querySelector('.game-v2-waiting-player .game-v2-button'))),
    matchLogText: document.querySelector('.game-v2-activity')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    handVisible: Boolean(document.querySelector('.game-v2-hand') && visible(document.querySelector('.game-v2-hand'))),
    liveReactionVisible: Boolean(document.querySelector('.game-v2-live-reaction')),
    emptyTrickVisible: Boolean(document.querySelector('.game-v2-empty-trick')),
    focusableDisplayCards: document.querySelectorAll('.game-v2-trick button, .game-v2-waste button, .waste-stack button, .current-trick button').length,
    touchViolations: controls.filter((control) => control.width < 44 || control.height < 44),
    unnamedControls: interactive.filter((element) => !named(element)).map((element) => element.outerHTML.slice(0, 160)),
    duplicateIds,
    overflowingElements,
    controls,
  }
})()`

async function capture(cdp, name, width, height) {
  await setViewport(cdp, width, height)
  const diagnostics = await evaluate(cdp, diagnosticsExpression)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const outputPath = join(OUTPUT_DIR, `${name}-${width}x${height}.png`)
  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'))
  return { outputPath, ...diagnostics }
}

function waitForState(socket, latestStates, predicate, timeoutMs = 10_000) {
  const current = latestStates.get(socket)
  if (current && predicate(current)) return Promise.resolve(current)
  return new Promise((resolveState, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:state', onState)
      reject(new Error('Timed out waiting for a matching room state.'))
    }, timeoutMs)
    const onState = (state) => {
      if (!predicate(state)) return
      clearTimeout(timeout)
      socket.off('room:state', onState)
      resolveState(state)
    }
    socket.on('room:state', onState)
  })
}

function browserProblems(cdp) {
  return cdp.events.flatMap((event) => {
    if (event.method === 'Runtime.exceptionThrown') {
      return [event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text]
    }
    if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) {
      return [event.params.args.map((argument) => argument.value ?? argument.description).join(' ')]
    }
    return []
  })
}

const sockets = []
const participants = []
const latestStates = new Map()
const failures = []
let chrome
let cdp
const profile = resolve(join(tmpdir(), `bhabhi-thulla-ui-qa-${Date.now()}`))

function assert(condition, message) {
  if (!condition) failures.push(message)
}

try {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const chromePath = await firstExisting(chromeCandidates)
  chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-breakpad',
    '--disable-crash-reporter',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })

  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome did not expose a page target.')
  cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `location.origin === ${JSON.stringify(CLIENT_URL)}`)
  await evaluate(cdp, `localStorage.setItem('thulla:preferences:v1', JSON.stringify({ tutorialComplete: true }))`)
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `Boolean(document.querySelector('.landing-shell'))`)
  await waitForExpression(cdp, `document.querySelector('.connection-label')?.dataset.connected === 'true'`)

  const landing = await capture(cdp, 'landing-mobile', 375, 812)
  const landingCta = await evaluate(cdp, `(() => {
    const panel = document.querySelector('.join-card')?.getBoundingClientRect()
    const cta = document.querySelector('.join-card button[type="submit"]')?.getBoundingClientRect()
    return panel && cta ? {
      panelTop: Math.round(panel.top),
      ctaTop: Math.round(cta.top),
      ctaBottom: Math.round(cta.bottom),
      ctaWithinFirstViewport: cta.top < innerHeight,
    } : null
  })()`)
  assert(Boolean(landingCta), 'The mobile landing page did not expose its primary create-room action.')
  assert(landingCta?.ctaWithinFirstViewport, `The mobile create-room CTA starts below the first viewport (${landingCta?.ctaTop}px).`)
  assert(!landing.pageOverflowX, 'The 375px landing page has horizontal overflow.')
  assert(landing.touchViolations.length === 0, `The mobile landing page has touch targets under 44px: ${JSON.stringify(landing.touchViolations)}`)
  assert(landing.unnamedControls.length === 0, 'The mobile landing page has unnamed interactive controls.')

  await evaluate(cdp, `(() => {
    const region = document.getElementById('platform-notices')
    if (!region) return false
    region.innerHTML = '<div class="platform-notice platform-notice--update" role="status"><div class="platform-notice__copy"><strong>Game update ready</strong><span>Update when it is safe to reconnect.</span></div><div class="platform-notice__actions"><button type="button">Update & reconnect</button><button type="button" class="platform-notice__later">Later</button></div></div>'
    return true
  })()`)
  const platformNotice = await capture(cdp, 'platform-notice-mobile', 390, 844)
  assert(platformNotice.platformNoticeVisible, 'The mobile platform notice is not visible.')
  assert(platformNotice.platformNoticeFullyVisible, 'The mobile platform notice is clipped by the viewport.')
  assert(platformNotice.touchViolations.length === 0, `The platform notice has touch targets under 44px: ${JSON.stringify(platformNotice.touchViolations)}`)
  assert(platformNotice.unnamedControls.length === 0, 'The platform notice has unnamed controls.')
  await evaluate(cdp, `document.getElementById('platform-notices')?.replaceChildren()`)

  const fixtureDefinitions = [
    { mode: 'lobby', selector: '.lobby-shell' },
    { mode: 'playing', selector: '.game-v2-shell' },
    { mode: 'queued', selector: '.game-v2-waiting-strip' },
    { mode: 'waiting', selector: '.game-v2-waiting-player' },
    { mode: 'resolving', selector: '.game-v2-resolution' },
    { mode: 'reconnect', selector: '.game-v2-reconnect-banner' },
    { mode: 'finished', selector: '.game-v2-result' },
    { mode: 'finished-waiting', selector: '.game-v2-result__waiting' },
  ]
  const fixtureResults = {}
  for (const fixture of fixtureDefinitions) {
    const fixtureUrl = `${CLIENT_URL}/?qa=${fixture.mode}`
    const captureFreshFixture = async (name, width, height) => {
      await cdp.send('Page.navigate', { url: fixtureUrl })
      await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(fixture.selector)}))`)
      return capture(cdp, name, width, height)
    }
    const portrait = await captureFreshFixture(`fixture-${fixture.mode}-mobile`, 390, 844)
    const landscape = await captureFreshFixture(`fixture-${fixture.mode}-landscape`, 844, 390)
    const desktop = fixture.mode === 'resolving' ? await captureFreshFixture(`fixture-${fixture.mode}-desktop`, 1366, 768) : null
    const shortDesktop = ['playing', 'waiting', 'finished', 'finished-waiting'].includes(fixture.mode)
      ? await captureFreshFixture(`fixture-${fixture.mode}-short-desktop`, 1366, 600)
      : null
    let chatOpen = null
    if (fixture.mode === 'playing') {
      await evaluate(cdp, `document.querySelector('.table-talk__trigger')?.click()`)
      await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__drawer:not([hidden])'))`)
      chatOpen = {
        portrait: await capture(cdp, 'fixture-playing-chat-open-mobile', 390, 844),
        landscape: await capture(cdp, 'fixture-playing-chat-open-landscape', 844, 390),
        desktop: await capture(cdp, 'fixture-playing-chat-open-desktop', 1366, 768),
        shortDesktop: await capture(cdp, 'fixture-playing-chat-open-short-desktop', 1366, 600),
      }
    }
    fixtureResults[fixture.mode] = { portrait, landscape, desktop, shortDesktop, chatOpen }
    for (const result of [portrait, landscape, desktop, shortDesktop].filter(Boolean)) {
      assert(!result.pageOverflowX, `${fixture.mode} fixture has horizontal overflow at ${result.viewport.join('x')}.`)
      assert(result.touchViolations.length === 0, `${fixture.mode} fixture has touch targets under 44px at ${result.viewport.join('x')}: ${JSON.stringify(result.touchViolations)}`)
      assert(result.unnamedControls.length === 0, `${fixture.mode} fixture has unnamed controls at ${result.viewport.join('x')}.`)
      assert(result.duplicateIds.length === 0, `${fixture.mode} fixture has duplicate IDs at ${result.viewport.join('x')}.`)
    }
    if (chatOpen) {
      for (const result of Object.values(chatOpen)) {
        assert(result.tableTalkDrawerVisible, `Table Talk did not open at ${result.viewport.join('x')}.`)
        assert(result.tableTalkDrawerFullyVisible, `Table Talk was clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkComposerVisible, `Table Talk composer was not visible at ${result.viewport.join('x')}.`)
        assert(result.tableTalkComposerFullyVisible, `Table Talk composer was partially clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkTextareaFullyVisible, `Table Talk textarea was clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkSendFullyVisible, `Table Talk send button was clipped at ${result.viewport.join('x')}.`)
        assert(!result.pageOverflowX, `Open Table Talk caused horizontal overflow at ${result.viewport.join('x')}.`)
        assert(result.touchViolations.length === 0, `Open Table Talk has touch targets under 44px at ${result.viewport.join('x')}: ${JSON.stringify(result.touchViolations)}`)
        assert(result.unnamedControls.length === 0, `Open Table Talk has unnamed controls at ${result.viewport.join('x')}.`)
      }
      assert(!chatOpen.landscape.tableTalkOverlapsCurrentTrick, 'Landscape Table Talk covers the current trick.')
    }
  }
  assert(fixtureResults.resolving.portrait.lastCardVisible, 'The resolving fixture does not identify the THULLA card.')
  assert(fixtureResults.resolving.portrait.thullaStatusVisible, 'The portrait resolving fixture does not show the THULLA announcement.')
  assert(!fixtureResults.resolving.portrait.thullaStatusOverlapsLastCard, 'The portrait THULLA announcement covers the final card.')
  assert(fixtureResults.resolving.landscape.thullaStatusVisible, 'The landscape resolving fixture does not show the THULLA announcement.')
  assert(!fixtureResults.resolving.landscape.thullaStatusOverlapsLastCard, 'The landscape THULLA announcement covers the final card.')
  assert(fixtureResults.resolving.desktop.lastCardVisible, 'The desktop resolving fixture does not visibly render the THULLA card.')
  assert(fixtureResults.resolving.desktop.thullaStatusVisible, 'The desktop resolving fixture does not show the THULLA announcement.')
  assert(!fixtureResults.resolving.desktop.thullaStatusOverlapsLastCard, 'The desktop THULLA announcement covers the final card.')
  assert(!fixtureResults.resolving.portrait.tableTalkTriggerVisible, 'Table Talk remains available over the portrait THULLA reveal.')
  assert(!fixtureResults.resolving.landscape.tableTalkTriggerVisible, 'Table Talk remains available over the landscape THULLA reveal.')
  assert(!fixtureResults.finished.portrait.tableTalkTriggerVisible, 'Table Talk remains interactive outside the finished-round modal.')
  assert(!fixtureResults.resolving.portrait.clockVisible, 'The resolving fixture displays a running timer.')
  assert(!fixtureResults.reconnect.portrait.clockVisible, 'The reconnect fixture displays a running timer.')
  assert((fixtureResults.playing.portrait.clockContrast ?? 0) >= 4.5, `The portrait turn clock contrast is below 4.5:1 (${fixtureResults.playing.portrait.clockContrast?.toFixed(2)}).`)
  assert((fixtureResults.playing.shortDesktop.clockContrast ?? 0) >= 4.5, `The short-desktop turn clock contrast is below 4.5:1 (${fixtureResults.playing.shortDesktop.clockContrast?.toFixed(2)}).`)
  assert(fixtureResults.waiting.portrait.waitingPanelVisible, 'A late-joining player does not see the next-round waiting panel.')
  assert(!fixtureResults.waiting.portrait.handVisible, 'A late-joining player still sees an interactive hand area.')
  assert(fixtureResults.waiting.portrait.waitingReadyControlVisible, 'A late-joining player cannot confirm readiness for the next round.')
  assert(fixtureResults.queued.portrait.waitingStripVisible, 'Active players cannot see who is waiting for the next round.')
  assert(fixtureResults.queued.portrait.waitingRemoveControls > 0, 'The host cannot remove a queued player before the next deal.')
  assert(!fixtureResults.queued.portrait.waitingStripOverlapsLead, 'The portrait waiting queue covers the follow-suit pill.')
  assert(!fixtureResults.queued.portrait.waitingStripOverlapsMatchLog, 'The portrait waiting queue covers Match Log.')
  assert(!fixtureResults.queued.portrait.waitingStripOverlapsTableTalk, 'The portrait waiting queue covers Table Talk.')
  assert(!fixtureResults.queued.landscape.waitingStripOverlapsLead, 'The landscape waiting queue covers the follow-suit pill.')
  assert(!fixtureResults.queued.landscape.waitingStripOverlapsMatchLog, 'The landscape waiting queue covers Match Log.')
  assert(!fixtureResults.queued.landscape.waitingStripOverlapsTableTalk, 'The landscape waiting queue covers Table Talk.')
  assert(fixtureResults.queued.portrait.matchLogText.includes('waiting to join the next round'), `The late-join Match Log copy is incorrect: ${fixtureResults.queued.portrait.matchLogText}`)
  assert(!fixtureResults.queued.portrait.matchLogText.includes('reconnected'), 'A newly queued friend is mislabeled as reconnected.')
  assert(fixtureResults.playing.portrait.tableTalkLabelVisible, 'The mobile Table Talk trigger hides its text label.')
  assert(fixtureResults['finished-waiting'].portrait.waitingRemoveControls >= 5, 'The finished screen does not expose host controls for every waiting player.')
  assert(!fixtureResults.finished.portrait.handVisible, 'The finished-round result leaves the old hand visible.')
  assert(!fixtureResults.finished.landscape.handVisible, 'The landscape finished-round result leaves the old hand visible.')

  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `Boolean(document.querySelector('.landing-shell'))`)

  const host = await connectedSocket()
  sockets.push(host)
  host.on('room:state', (state) => latestStates.set(host, state))
  const hostCredentials = await emitAck(host, 'room:create', { name: 'Nouman' })
  participants.push({ socket: host, credentials: hostCredentials })
  for (const name of ['Ayesha', 'Bilal', 'Hira', 'Hamza', 'Sana', 'Danish', 'Mehwish']) {
    const socket = await connectedSocket()
    sockets.push(socket)
    socket.on('room:state', (state) => latestStates.set(socket, state))
    const credentials = await emitAck(socket, 'room:join', { code: hostCredentials.code, name })
    participants.push({ socket, credentials })
  }

  for (const participant of participants) {
    await emitAck(participant.socket, 'room:ready', { ready: true })
  }

  const playingState = waitForState(host, latestStates, (state) => state.status === 'playing')
  await emitAck(host, 'game:start', {})
  let room = await playingState

  while (room.game?.phase !== 'resolving' && room.game?.trick.length < room.players.length - 1) {
    const turnId = room.game?.currentTurnId
    const participant = participants.find(({ credentials }) => credentials.playerId === turnId)
    if (!participant || !turnId) throw new Error('Could not identify a player while preparing the opening trick.')
    const playerState = await waitForState(participant.socket, latestStates, (state) => state.game?.currentTurnId === turnId)
    const cardId = playerState.game?.legalCardIds[0]
    if (!cardId) throw new Error('The current player had no legal opening card.')
    const previousLength = room.game.trick.length
    const nextState = waitForState(host, latestStates, (state) => state.game?.phase === 'resolving' || state.game?.trick.length > previousLength)
    await emitAck(participant.socket, 'game:play', { cardId })
    room = await nextState
  }

  if (room.game?.phase === 'resolving') throw new Error('The trick resolved before the browser player could play the final card.')
  const finalPlayerId = room.game?.currentTurnId
  const finalParticipant = participants.find(({ credentials }) => credentials.playerId === finalPlayerId)
  if (!finalParticipant) throw new Error('Could not identify the final player in the opening trick.')
  finalParticipant.socket.disconnect()

  const storedCredentials = JSON.stringify(finalParticipant.credentials)
  await evaluate(cdp, `localStorage.setItem(${JSON.stringify(`thulla:seat:${finalParticipant.credentials.code}`)}, ${JSON.stringify(storedCredentials)})`)
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}/?room=${finalParticipant.credentials.code}` })
  try {
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-shell'))`)
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-card--selectable:not(:disabled)'))`)
  } catch (error) {
    const pageState = await evaluate(cdp, `({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 800) ?? '' })`)
    throw new Error(`${error.message} Page state: ${JSON.stringify(pageState)}`)
  }

  await evaluate(cdp, `document.querySelector('.game-card--selectable:not(:disabled)')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-card.is-selected, .game-card[aria-pressed="true"]'))`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__trigger'))`)
  await evaluate(cdp, `document.querySelector('.table-talk__trigger')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__drawer:not([hidden])'))`)
  const resolvingStatePromise = waitForState(host, latestStates, (state) => state.game?.phase === 'resolving')
  await evaluate(cdp, `[...document.querySelectorAll('.game-v2-button--primary:not(:disabled)')].find((button) => !button.closest('.table-talk'))?.click()`)
  const resolvingState = await resolvingStatePromise
  const resolutionObservedAt = Date.now()

  assert(resolvingState.game?.currentTurnId === null, 'A current turn remained active during trick resolution.')
  assert(resolvingState.game?.turnEndsAt === null, 'The turn timer continued during trick resolution.')
  assert(Boolean(resolvingState.game?.resolvedTrick), 'The server omitted the completed trick during resolution.')
  assert((resolvingState.game?.resolutionEndsAt ?? 0) - resolutionObservedAt >= 2_000, 'The completed trick was not retained long enough for players to read it.')

  await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-resolution') && document.querySelector('.game-v2-trick-card.is-last-played')) && !document.querySelector('.table-talk__trigger') && !document.querySelector('.table-talk__drawer:not([hidden])')`)
  await emitAck(host, 'room:react', { reaction: 'thulla' })
  await delay(200)
  const resolvingOverlayState = await evaluate(cdp, `({ tableTalk: Boolean(document.querySelector('.table-talk__drawer:not([hidden])')), reaction: Boolean(document.querySelector('.game-v2-live-reaction')) })`)
  assert(!resolvingOverlayState.tableTalk, 'Table Talk stayed open over a real completed-trick reveal.')
  assert(!resolvingOverlayState.reaction, 'A live reaction covered a real completed-trick reveal.')
  // The real server retains a resolved trick for only three seconds. Capture one
  // integrated viewport here; the deterministic fixtures above cover every
  // responsive viewport without racing that intentional server deadline.
  const integrationViewport = VIEWPORTS[0]
  const resolutionResults = [await capture(cdp, `resolution-${integrationViewport.name}`, integrationViewport.width, integrationViewport.height)]
  for (const result of resolutionResults) {
    assert(result.visibleTrickCards === room.players.length, `${result.viewport.join('x')} did not show all completed trick cards.`)
    assert(result.lastCardVisible, `${result.viewport.join('x')} did not identify the final card.`)
    assert(!result.clockVisible, `${result.viewport.join('x')} showed a running turn clock during resolution.`)
    assert(!result.pageOverflowX, `${result.viewport.join('x')} gameplay has horizontal page overflow.`)
    assert(result.focusableDisplayCards === 0, `${result.viewport.join('x')} exposes display-only table cards as buttons.`)
    assert(result.unnamedControls.length === 0, `${result.viewport.join('x')} has unnamed controls.`)
    assert(result.duplicateIds.length === 0, `${result.viewport.join('x')} has duplicate element IDs.`)
    if (result.viewport[0] <= 844) {
      assert(result.touchViolations.length === 0, `${result.viewport.join('x')} has touch targets under 44px: ${JSON.stringify(result.touchViolations)}`)
    }
  }

  const nextTurnState = await waitForState(
    host,
    latestStates,
    (state) => state.game?.phase === 'turn' && !state.game.resolvedTrick,
    6_000,
  )
  const clearedAt = Date.now()
  await setViewport(cdp, 1440, 900)
  await waitForExpression(cdp, `!document.querySelector('.game-v2-resolution') && Boolean(document.querySelector('.game-v2-empty-trick'))`)
  const cleared = await capture(cdp, 'next-trick-desktop', 1440, 900)
  assert(cleared.visibleTrickCards === 0, 'Completed cards remained after the three-second resolution phase.')
  assert(cleared.emptyTrickVisible, 'The empty lead state did not appear after completed cards cleared.')
  assert(cleared.clockVisible, 'The next turn timer did not begin after completed cards cleared.')
  assert(Boolean(nextTurnState.game?.currentTurnId), 'The server did not assign the next turn after resolution.')
  assert((nextTurnState.game?.turnEndsAt ?? 0) > clearedAt, 'The next turn deadline was not started after resolution.')
  const deadlineDrift = Math.abs((resolvingState.game?.resolutionEndsAt ?? clearedAt) - clearedAt)
  assert(deadlineDrift <= 1_200, `Resolution cleared ${deadlineDrift}ms away from its server deadline.`)

  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const reducedMotion = await evaluate(cdp, `(() => {
    const animated = [...document.querySelectorAll('.game-v2-clock, .game-v2-event, .game-v2-trick-card')]
      .filter((element) => getComputedStyle(element).animationName !== 'none')
      .map((element) => ({ className: element.className, animation: getComputedStyle(element).animationName }))
    return { enabled: matchMedia('(prefers-reduced-motion: reduce)').matches, animated }
  })()`)
  assert(reducedMotion.enabled, 'Reduced-motion emulation did not activate.')
  assert(reducedMotion.animated.length === 0, `Reduced motion left animations active: ${JSON.stringify(reducedMotion.animated)}`)

  const consoleProblems = browserProblems(cdp)
  assert(consoleProblems.length === 0, `Browser console errors were recorded: ${consoleProblems.join(' | ')}`)

  const report = {
    room: finalParticipant.credentials.code,
    playerId: finalParticipant.credentials.playerId,
    landing: { ...landing, cta: landingCta, platformNotice },
    fixtures: fixtureResults,
    resolution: {
      observedAt: resolutionObservedAt,
      serverDeadline: resolvingState.game?.resolutionEndsAt,
      clearedAt,
      deadlineDrift,
      serverPaused: resolvingState.game?.currentTurnId === null && resolvingState.game?.turnEndsAt === null,
      overlaysHidden: !resolvingOverlayState.tableTalk && !resolvingOverlayState.reaction,
      results: resolutionResults,
    },
    nextTrick: cleared,
    reducedMotion,
    consoleProblems,
    failures,
  }
  const reportPath = join(OUTPUT_DIR, 'visual-qa-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  for (const socket of sockets) socket.disconnect()
  if (cdp) {
    await Promise.race([
      cdp.send('Browser.close').catch(() => undefined),
      delay(1_000),
    ])
    cdp.close()
  }
  if (chrome && !chrome.killed) {
    chrome.kill()
    await Promise.race([
      new Promise((resolveExit) => chrome.once('exit', resolveExit)),
      delay(2_000),
    ])
  }
  const safeTempRoot = `${resolve(tmpdir()).toLowerCase()}${sep}`
  if (profile.toLowerCase().startsWith(safeTempRoot)) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rm(profile, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 7) console.warn(`Could not remove temporary Chrome profile: ${error.message}`)
        else await delay(250)
      }
    }
  }
}
