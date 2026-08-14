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
const SHORT_PHONE_VIEWPORTS = [
  { name: 'phone-320x480', width: 320, height: 480 },
  { name: 'phone-320x568', width: 320, height: 568 },
  { name: 'phone-360x640', width: 360, height: 640 },
  { name: 'phone-375x512', width: 375, height: 512 },
  { name: 'phone-375x667', width: 375, height: 667 },
  { name: 'phone-390x667', width: 390, height: 667 },
  { name: 'phone-430x932', width: 430, height: 932 },
  { name: 'landscape-667x375', width: 667, height: 375 },
  { name: 'landscape-740x360', width: 740, height: 360 },
]
const LANDING_PLAY_CTA_VIEWPORTS = new Set([
  'phone-320x480',
  'phone-320x568',
  'phone-375x512',
  'landscape-667x375',
  'landscape-740x360',
])
const LANDING_SEO_VIEWPORTS = [
  { name: 'seo-phone-320', width: 320, height: 568 },
  { name: 'seo-phone-375', width: 375, height: 812 },
  { name: 'seo-tablet-768', width: 768, height: 1024 },
  { name: 'seo-desktop-1440', width: 1440, height: 900 },
]
const fixtureShortMatrix = {
  lobby: ['phone-320x480', 'phone-375x512', 'phone-430x932', 'landscape-740x360'],
  playing: SHORT_PHONE_VIEWPORTS.map(({ name }) => name),
  'many-players': SHORT_PHONE_VIEWPORTS.map(({ name }) => name),
  queued: ['phone-320x480', 'landscape-740x360'],
  waiting: ['phone-320x480', 'landscape-740x360'],
  resolving: ['phone-320x480', 'phone-375x512', 'phone-430x932', 'landscape-667x375'],
  reconnect: ['phone-320x480', 'landscape-740x360'],
  finished: ['phone-320x480', 'landscape-740x360'],
  'finished-waiting': ['phone-320x480', 'landscape-740x360'],
}
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
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 15_000)
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
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(cdp, expression)) return
      lastError = null
    } catch (error) {
      // A navigation can briefly replace the document between CDP polls.
      // Treat that transient execution-context gap like a false predicate.
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for: ${expression}${lastError ? ` Last evaluation error: ${lastError.message}` : ''}`)
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

async function waitForResponsiveLayout(cdp) {
  // A viewport change is synchronous for CSS, but the application also reacts
  // through matchMedia listeners and ResizeObserver. Measure only after those
  // callbacks have had enough frames to commit the responsive React state.
  await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  await delay(120)
  await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(resolve))`)
}

const diagnosticsExpression = `(() => {
  const root = document.documentElement
  const visible = (element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight
  }
  const rendered = (element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
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
  const gameTableRect = document.querySelector('.game-v2-table')?.getBoundingClientRect()
  const gameHandRect = document.querySelector('.game-v2-hand')?.getBoundingClientRect()
  const lobbyActions = document.querySelector('.lobby-actions')
  const lobbyActionsRect = lobbyActions?.getBoundingClientRect()
  const lobbyCardRect = document.querySelector('.lobby-card--expanded')?.getBoundingClientRect()
  const primaryJoinActionRect = document.querySelector('.join-card button[type="submit"]')?.getBoundingClientRect()
  const landingPlayCta = document.querySelector('.landing-play-cta[data-action="focus-create-room"]')
  const landingPlayCtaRect = landingPlayCta?.getBoundingClientRect()
  const landingPlayTargetId = landingPlayCta?.getAttribute('aria-controls') ?? ''
  const landingPlayTarget = landingPlayTargetId ? document.getElementById(landingPlayTargetId) : null
  const landingCardRects = [...document.querySelectorAll('.hero-card')]
    .filter(rendered)
    .map((element) => element.getBoundingClientRect())
  const landingDecorationRect = landingCardRects.length
    ? {
        left: Math.min(...landingCardRects.map((box) => box.left)),
        top: Math.min(...landingCardRects.map((box) => box.top)),
        right: Math.max(...landingCardRects.map((box) => box.right)),
        bottom: Math.max(...landingCardRects.map((box) => box.bottom)),
      }
    : document.querySelector('.hero-cards')?.getBoundingClientRect()
  const landingBenefitsRect = document.querySelector('.trust-row')?.getBoundingClientRect()
  const gameHeader = document.querySelector('.game-v2-header')
  const gameHeaderRect = gameHeader?.getBoundingClientRect()
  const resolution = document.querySelector('.game-v2-resolution, [data-game-phase="resolving"]')
  const lastCard = document.querySelector('.game-v2-trick-card.is-last-played')
  const thullaStatus = document.querySelector('.game-v2-status.is-thulla')
  const thullaStatusRect = thullaStatus?.getBoundingClientRect()
  const lastCardRect = lastCard?.getBoundingClientRect()
  const lastCardStyle = lastCard ? getComputedStyle(lastCard) : null
  const tableTalkDrawer = document.querySelector('.table-talk__drawer:not([hidden])')
  const tableTalkDrawerRect = tableTalkDrawer?.getBoundingClientRect()
  const tableTalkScrim = document.querySelector('.table-talk__scrim')
  const tableTalkComposer = tableTalkDrawer?.querySelector('.table-talk__composer')
  const tableTalkComposerRect = tableTalkComposer?.getBoundingClientRect()
  const tableTalkTextareaRect = tableTalkDrawer?.querySelector('textarea')?.getBoundingClientRect()
  const tableTalkSendRect = tableTalkDrawer?.querySelector('.table-talk__send')?.getBoundingClientRect()
  const tableTalkChatScroll = tableTalkDrawer?.querySelector('.table-talk__chat-scroll[data-scroll-owner="chat"]')
  const tableTalkChatScrollRect = tableTalkChatScroll?.getBoundingClientRect()
  const tableTalkPlayerControls = tableTalkChatScroll?.querySelector('.table-talk__player-controls')
  const tableTalkPlayerControlsRect = tableTalkPlayerControls?.getBoundingClientRect()
  const tableTalkPlayerControlsSummary = tableTalkPlayerControls?.querySelector('summary')
  const tableTalkPlayerControlsSummaryRect = tableTalkPlayerControlsSummary?.getBoundingClientRect()
  const platformNotice = document.querySelector('.platform-notice')
  const platformNoticeRect = platformNotice?.getBoundingClientRect()
  const tableTalkTrigger = document.querySelector('.table-talk__trigger')
  const tableTalkTriggerLabel = tableTalkTrigger?.querySelector('.table-talk__trigger-label')
  const currentTrick = document.querySelector('.game-v2-trick')
  const currentTrickRect = currentTrick?.getBoundingClientRect()
  const gameStatus = document.querySelector('.game-v2-status')
  const gameStatusRect = gameStatus?.getBoundingClientRect()
  const waitingStrip = document.querySelector('.game-v2-waiting-strip')
  const waitingStripRect = waitingStrip?.getBoundingClientRect()
  const leadPillRect = document.querySelector('.game-v2-lead')?.getBoundingClientRect()
  const matchLogRect = document.querySelector('.game-v2-log-toggle')?.getBoundingClientRect()
  const tableTalkTriggerRect = tableTalkTrigger?.getBoundingClientRect()
  const opponentRail = document.querySelector('.game-v2-opponents')
  const opponentHint = document.querySelector('.game-v2-opponent-scroll-hint')
  const opponentPosition = document.querySelector('.game-v2-opponent-position[role="status"]')
  const opponentPositionRect = opponentPosition?.getBoundingClientRect()
  const readinessAction = document.querySelector('.game-v2-result__controls .game-v2-button')
  const gameHeaderOverflow = document.querySelector('.game-v2-header-overflow')
  const lobbyHeaderOverflow = document.querySelector('.header-overflow')
  const clock = document.querySelector('.game-v2-clock, .turn-clock')
  const clockStyle = clock ? getComputedStyle(clock) : null
  const selectedCard = document.querySelector('.game-v2-hand button.game-card.is-selected[aria-pressed="true"]')
  const selectedCardRect = selectedCard?.getBoundingClientRect()
  const selectedCardScroller = selectedCard?.closest('.game-v2-hand__scroller')
  const gameActionBar = document.querySelector('.game-v2-action-bar')
  const gameActionBarRect = gameActionBar?.getBoundingClientRect()
  const lobbyActionSecondary = document.querySelector('.lobby-actions__secondary[data-action-group="secondary"]')
  const lobbyActionPrimary = document.querySelector('.lobby-actions__primary[data-action-group="primary"]')
  const lobbyActionSecondaryRect = lobbyActionSecondary?.getBoundingClientRect()
  const lobbyActionPrimaryRect = lobbyActionPrimary?.getBoundingClientRect()
  const lobbyContentGridRect = document.querySelector('.lobby-content-grid')?.getBoundingClientRect()
  const lobbyHintRect = document.querySelector('.lobby-hint')?.getBoundingClientRect()
  const qaToast = document.querySelector('.toast[data-qa-toast="true"]')
  const qaToastRect = qaToast?.getBoundingClientRect()
  const gameResultControls = document.querySelector('.game-v2-result__controls')
  const resultActionElements = [...document.querySelectorAll('.game-v2-result [data-result-action]')]
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
    && first.left < second.right - 1 && first.right > second.left + 1
    && first.top < second.bottom - 1 && first.bottom > second.top + 1)
  const fullyInsideViewport = (box) => Boolean(box
    && box.left >= -1 && box.top >= -1
    && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1)
  const perceptible = (element) => Boolean(element && visible(element) && Number(getComputedStyle(element).opacity) > 0.1)
  const describeElement = (element) => element.tagName.toLowerCase()
    + (element.id ? '#' + element.id : '')
    + (typeof element.className === 'string' && element.className
      ? '.' + element.className.trim().replace(/\\s+/g, '.')
      : '')
  const renderedElements = (selector) => [...document.querySelectorAll(selector)].filter(rendered)
  const overlapLabels = (elements, targetRect) => elements
    .filter((element) => overlaps(element.getBoundingClientRect(), targetRect))
    .map(describeElement)
  const pairwiseOverlapLabels = (elements) => elements.flatMap((element, index) => elements
    .slice(index + 1)
    .filter((other) => overlaps(element.getBoundingClientRect(), other.getBoundingClientRect()))
    .map((other) => describeElement(element) + ' <> ' + describeElement(other)))
  const pairwiseGapLabels = (elements, minimumGap) => elements.flatMap((element, index) => elements
    .slice(index + 1)
    .filter((other) => {
      const first = element.getBoundingClientRect()
      const second = other.getBoundingClientRect()
      const horizontalGap = Math.max(first.left - second.right, second.left - first.right, 0)
      const verticalGap = Math.max(first.top - second.bottom, second.top - first.bottom, 0)
      return Math.hypot(horizontalGap, verticalGap) < minimumGap
    })
    .map((other) => describeElement(element) + ' <> ' + describeElement(other)))
  const clippingAncestorLabels = (element) => {
    if (!element) return []
    const elementRect = element.getBoundingClientRect()
    const failures = []
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const ancestorRect = ancestor.getBoundingClientRect()
      const clipsX = ['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowX)
      const clipsY = ['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowY)
      const clippedX = clipsX && (elementRect.left < ancestorRect.left - 1 || elementRect.right > ancestorRect.right + 1)
      const clippedY = clipsY && (elementRect.top < ancestorRect.top - 1 || elementRect.bottom > ancestorRect.bottom + 1)
      if (clippedX || clippedY) failures.push(describeElement(ancestor))
    }
    return failures
  }
  const opponentSeats = renderedElements('.game-v2-opponents .game-v2-seat')
  const opponentBadges = renderedElements('.game-v2-opponents .game-v2-seat__right, .game-v2-opponents .game-v2-seat__turn')
  const opponentSeatContracts = [...document.querySelectorAll('.game-v2-opponents [data-opponent-seat][data-player-id]')]
  const directionRect = document.querySelector('.game-v2-direction')?.getBoundingClientRect()
  const opponentHintRect = opponentHint?.getBoundingClientRect()
  const explanationElements = renderedElements('.game-v2-explanation-toggle, .game-v2-explanation > p')
  const socialControls = renderedElements('.game-v2-log-toggle, .table-talk--game .table-talk__trigger, .game-v2-social-actions > *')
  const fixedControls = renderedElements('.game-v2-log-toggle, .table-talk--game .table-talk__trigger, .game-v2-lead, .game-v2-waiting-strip > summary')
  const lobbyActionControls = renderedElements('.lobby-actions button')
  const tableTalkUnexpectedVerticalScrollers = tableTalkChatScroll
    ? [...tableTalkChatScroll.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1
      })
      .map(describeElement)
    : []
  const fixedControlsClipped = fixedControls
    .filter((element) => !fullyInsideViewport(element.getBoundingClientRect()))
    .map(describeElement)
  const gamePrimaryAction = document.querySelector('.game-v2-action-bar button:not(:disabled), .game-v2-waiting-player button:not(:disabled), .game-v2-result__controls > .game-v2-button:not(:disabled), .game-v2-reconnect-banner button:not(:disabled), .game-v2-explanation-toggle')
  const gamePrimaryActionRect = gamePrimaryAction?.getBoundingClientRect()
  const lobbyPrimaryAction = document.querySelector('.lobby-actions__primary .lobby-actions__deal')
  const lobbyPrimaryActionRect = lobbyPrimaryAction?.getBoundingClientRect()
  const landingPrimaryActionReachable = Boolean(primaryJoinActionRect
    && primaryJoinActionRect.left >= -1
    && primaryJoinActionRect.right <= innerWidth + 1
    && primaryJoinActionRect.top + scrollY >= -1
    && primaryJoinActionRect.bottom + scrollY <= root.scrollHeight + 1)
  const lobbyPrimaryActionReachable = Boolean(lobbyPrimaryActionRect
    && lobbyPrimaryActionRect.left >= -1
    && lobbyPrimaryActionRect.right <= innerWidth + 1
    && lobbyPrimaryActionRect.top + scrollY >= -1
    && lobbyPrimaryActionRect.bottom + scrollY <= root.scrollHeight + 1)
  const gameSurfaceVisible = Boolean(gameTableRect && visible(document.querySelector('.game-v2-table')))
  const gamePhaseSurface = document.querySelector('.game-v2-hand, .game-v2-waiting-player, .game-v2-result__card')
  const gamePhaseSurfaceRect = gamePhaseSurface?.getBoundingClientRect()
  const gamePhaseSurfaceVisible = Boolean(gamePhaseSurface && visible(gamePhaseSurface))
  const gameResult = document.querySelector('.game-v2-result__card')
  const gameResultRect = gameResult?.getBoundingClientRect()
  const gamePrimarySurfacesFullyVisible = gameResultRect
    ? fullyInsideViewport(gameResultRect)
    : Boolean(fullyInsideViewport(gameHeaderRect)
      && fullyInsideViewport(gameTableRect)
      && fullyInsideViewport(gamePhaseSurfaceRect))
  const shortViewportOperable = document.querySelector('.landing-shell')
    ? landingPrimaryActionReachable
    : document.querySelector('.lobby-shell')
      ? lobbyPrimaryActionReachable
      : document.querySelector('.game-v2-shell')
        ? Boolean(gamePrimarySurfacesFullyVisible
          && (gameResult || (gameHeader && visible(gameHeader) && gameSurfaceVisible && gamePhaseSurfaceVisible))
          && (!gamePrimaryActionRect || fullyInsideViewport(gamePrimaryActionRect))
          && fixedControlsClipped.length === 0)
        : true
  return {
    viewport: [innerWidth, innerHeight],
    pageOverflowX: root.scrollWidth > innerWidth + 1,
    pageOverflowY: root.scrollHeight > innerHeight + 1,
    rightSeatVisible: rightBox ? rightBox.right > 0 && rightBox.left < innerWidth && rightBox.bottom > 0 && rightBox.top < innerHeight : null,
    lobbyActionsVisible: Boolean(lobbyActions && visible(lobbyActions)),
    lobbyActionsFullyVisible: Boolean(lobbyActionsRect
      && lobbyActionsRect.left >= -1 && lobbyActionsRect.top >= -1
      && lobbyActionsRect.right <= innerWidth + 1 && lobbyActionsRect.bottom <= innerHeight + 1),
    lobbyCardFullyVisibleHorizontally: Boolean(lobbyCardRect && lobbyCardRect.left >= -1 && lobbyCardRect.right <= innerWidth + 1),
    landingPrimaryActionReachable,
    landingPlayCtaRendered: Boolean(landingPlayCta && rendered(landingPlayCta)),
    landingPlayCtaVisible: Boolean(landingPlayCta && visible(landingPlayCta)),
    landingPlayCtaFullyVisible: fullyInsideViewport(landingPlayCtaRect),
    landingPlayCtaFocusable: Boolean(landingPlayCta instanceof HTMLButtonElement && !landingPlayCta.disabled && landingPlayCta.tabIndex >= 0),
    landingPlayCtaControlsJoinCard: Boolean(landingPlayTargetId === 'play-bhabhi-thulla' && landingPlayTarget?.classList.contains('join-card')),
    lobbyPrimaryActionReachable,
    lobbyActionGroupsPresent: Boolean(lobbyActionSecondary && lobbyActionPrimary),
    lobbyActionGroupsFullyContained: Boolean(
      lobbyActions?.contains(lobbyActionSecondary)
      && lobbyActions?.contains(lobbyActionPrimary)
      && fullyInside(lobbyActionSecondaryRect, lobbyActionsRect)
      && (fullyInside(lobbyActionPrimaryRect, lobbyActionsRect)
        || (getComputedStyle(lobbyActionPrimary).position === 'fixed' && fullyInsideViewport(lobbyActionPrimaryRect))),
    ),
    lobbySecondaryActionFullyContained: fullyInside(lobbyActionSecondaryRect, lobbyActionsRect),
    lobbyPrimaryActionFullyVisible: fullyInsideViewport(lobbyActionPrimaryRect),
    lobbyActionGroupsOverlap: overlaps(lobbyActionSecondaryRect, lobbyActionPrimaryRect),
    lobbyActionControlsOverlap: pairwiseOverlapLabels(lobbyActionControls),
    lobbyActionsOverlapContentGrid: overlaps(lobbyActionsRect, lobbyContentGridRect),
    lobbyActionsOverlapHint: overlaps(lobbyActionsRect, lobbyHintRect),
    lobbyPrimaryActionOverlapsContentGrid: overlaps(lobbyActionPrimaryRect, lobbyContentGridRect),
    lobbyPrimaryActionOverlapsHint: overlaps(lobbyActionPrimaryRect, lobbyHintRect),
    lobbySecondaryActionOverlapsContentGrid: overlaps(lobbyActionSecondaryRect, lobbyContentGridRect),
    lobbySecondaryActionOverlapsHint: overlaps(lobbyActionSecondaryRect, lobbyHintRect),
    shortViewportOperable,
    landingDecorationOverlapsBenefits: overlaps(landingDecorationRect, landingBenefitsRect),
    resolutionText: resolution?.textContent?.trim().replace(/\\s+/g, ' ') ?? null,
    visibleTrickCards: document.querySelectorAll('.game-v2-trick-card').length,
    lastCardVisible,
    thullaStatusVisible: Boolean(thullaStatus),
    thullaStatusOverlapsLastCard,
    tableTalkDrawerVisible: Boolean(tableTalkDrawerRect && visible(tableTalkDrawer)),
    tableTalkScrimVisible: Boolean(tableTalkScrim && visible(tableTalkScrim)),
    tableTalkAriaModal: tableTalkDrawer?.getAttribute('aria-modal') ?? null,
    tableTalkDrawerFullyVisible: Boolean(tableTalkDrawerRect
      && tableTalkDrawerRect.left >= -1
      && tableTalkDrawerRect.top >= -1
      && tableTalkDrawerRect.right <= innerWidth + 1
      && tableTalkDrawerRect.bottom <= innerHeight + 1),
    tableTalkComposerVisible: Boolean(tableTalkComposer && visible(tableTalkComposer)),
    tableTalkComposerFullyVisible: fullyInside(tableTalkComposerRect, tableTalkDrawerRect),
    tableTalkTextareaFullyVisible: fullyInside(tableTalkTextareaRect, tableTalkDrawerRect),
    tableTalkSendFullyVisible: fullyInside(tableTalkSendRect, tableTalkDrawerRect),
    tableTalkChatScrollPresent: Boolean(tableTalkChatScroll),
    tableTalkChatScrollFocusable: Boolean(tableTalkChatScroll && tableTalkChatScroll.tabIndex === 0),
    tableTalkChatScrollConfigured: Boolean(tableTalkChatScroll && ['auto', 'scroll'].includes(getComputedStyle(tableTalkChatScroll).overflowY)),
    tableTalkUnexpectedVerticalScrollers,
    tableTalkPlayerControlsPresent: Boolean(tableTalkPlayerControls),
    tableTalkPlayerControlsFullyVisible: Boolean(tableTalkPlayerControlsRect
      && fullyInside(tableTalkPlayerControlsRect, tableTalkChatScrollRect)
      && fullyInside(tableTalkPlayerControlsRect, tableTalkDrawerRect)
      && fullyInsideViewport(tableTalkPlayerControlsRect)),
    tableTalkPlayerControlsSummaryFullyVisible: Boolean(tableTalkPlayerControlsSummaryRect
      && fullyInside(tableTalkPlayerControlsSummaryRect, tableTalkChatScrollRect)
      && fullyInside(tableTalkPlayerControlsSummaryRect, tableTalkDrawerRect)
      && fullyInsideViewport(tableTalkPlayerControlsSummaryRect)),
    tableTalkComposerIsChatScrollSibling: Boolean(tableTalkChatScroll
      && tableTalkComposer
      && tableTalkChatScroll.parentElement === tableTalkComposer.parentElement),
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
    tableTalkOverlapsRightSeat: overlaps(tableTalkDrawerRect, rightBox),
    tableTalkOverlapsGameTable: overlaps(tableTalkDrawerRect, gameTableRect),
    tableTalkOverlapsHand: overlaps(tableTalkDrawerRect, gameHandRect),
    opponentSeatsOverlapDirection: overlapLabels(opponentSeats, directionRect),
    opponentSeatsOverlapHint: overlapLabels(opponentSeats, opponentHintRect),
    opponentHintOverlapsDirection: overlaps(opponentHintRect, directionRect),
    opponentBadgesOverlapDirection: overlapLabels(opponentBadges, directionRect),
    opponentBadgesOverlapHint: overlapLabels(opponentBadges, opponentHintRect),
    opponentBadgesOverlapTrick: overlapLabels(opponentBadges, currentTrickRect),
    opponentPositionPresent: Boolean(opponentPosition),
    opponentPositionPerceptible: perceptible(opponentPosition),
    opponentPositionFullyVisible: fullyInsideViewport(opponentPositionRect),
    opponentPositionOverlapsSeats: overlapLabels(opponentSeats, opponentPositionRect),
    opponentPositionOverlapsDirection: overlaps(opponentPositionRect, directionRect),
    opponentPositionOverlapsTrick: overlaps(opponentPositionRect, currentTrickRect),
    opponentRailRole: opponentRail?.getAttribute('role') ?? null,
    opponentRailTabIndex: opponentRail?.tabIndex ?? null,
    opponentRailKeyShortcuts: opponentRail?.getAttribute('aria-keyshortcuts') ?? null,
    opponentRailPosition: opponentRail?.getAttribute('data-overflow-position') ?? null,
    opponentSeatContractCount: opponentSeatContracts.length,
    opponentSeatIdsUnique: new Set(opponentSeatContracts.map((seat) => seat.getAttribute('data-player-id'))).size === opponentSeatContracts.length,
    trickOverlapsStatus: overlaps(currentTrickRect, gameStatusRect),
    explanationOverlapsMatchLog: overlapLabels(explanationElements, matchLogRect),
    explanationOverlapsTableTalk: overlapLabels(explanationElements, tableTalkTriggerRect),
    socialControlsOverlap: pairwiseOverlapLabels(socialControls),
    socialControlsOverlapStatus: overlapLabels(socialControls, gameStatusRect),
    socialControlsOverlapHand: overlapLabels(socialControls, gameHandRect),
    compactUtilityGapViolations: innerWidth <= 720 && innerHeight >= innerWidth
      ? pairwiseGapLabels(fixedControls, 8)
      : [],
    fixedControlsOverlapHand: overlapLabels(fixedControls, gameHandRect),
    fixedControlsClipped,
    gamePrimaryActionVisible: Boolean(gamePrimaryAction && visible(gamePrimaryAction)),
    gamePrimaryActionFullyVisible: gamePrimaryActionRect ? fullyInsideViewport(gamePrimaryActionRect) : null,
    gamePrimarySurfacesFullyVisible,
    selectedCardPresent: Boolean(selectedCard),
    selectedCardVisible: Boolean(selectedCard && visible(selectedCard)),
    selectedCardFullyInsideViewport: fullyInsideViewport(selectedCardRect),
    selectedCardFullyInsideScroller: Boolean(selectedCardRect && selectedCardScroller
      && fullyInside(selectedCardRect, selectedCardScroller.getBoundingClientRect())),
    selectedCardClippingAncestors: clippingAncestorLabels(selectedCard),
    selectedCardOverlapsActionBar: overlaps(selectedCardRect, gameActionBarRect),
    qaToastVisible: Boolean(qaToast && perceptible(qaToast)),
    qaToastFullyVisible: fullyInsideViewport(qaToastRect),
    qaToastOverlapsGameActionBar: overlaps(qaToastRect, gameActionBarRect),
    qaToastOverlapsGamePrimaryAction: overlaps(qaToastRect, gamePrimaryActionRect),
    qaToastOverlapsLobbyActions: overlaps(qaToastRect, lobbyActionsRect),
    qaToastOverlapsLobbyPrimaryAction: overlaps(qaToastRect, lobbyActionPrimaryRect),
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
    readinessActionText: readinessAction?.textContent?.trim().replace(/\\s+/g, ' ') ?? '',
    resultActionNames: resultActionElements.map((element) => element.getAttribute('data-result-action')),
    resultReadyAriaPressed: document.querySelector('[data-result-action="ready"]')?.getAttribute('aria-pressed') ?? null,
    resultActionsOutsideControls: resultActionElements
      .filter((element) => !gameResultControls?.contains(element))
      .map(describeElement),
    resultBlockerPresent: Boolean(document.querySelector('.game-v2-result__blocker[role="status"]')),
    matchLogText: document.querySelector('.game-v2-activity')?.textContent?.trim().replace(/\\s+/g, ' ') ?? '',
    handVisible: Boolean(document.querySelector('.game-v2-hand') && visible(document.querySelector('.game-v2-hand'))),
    liveReactionVisible: Boolean(document.querySelector('.game-v2-live-reaction')),
    emptyTrickVisible: Boolean(document.querySelector('.game-v2-empty-trick')),
    handTurnChipVisible: Boolean(document.querySelector('.game-v2-your-turn') && visible(document.querySelector('.game-v2-your-turn'))),
    accessibleTimerCount: document.querySelectorAll('[role="timer"]').length,
    opponentRailOverflow: Boolean(opponentRail && opponentRail.scrollWidth > opponentRail.clientWidth + 1),
    opponentHintVisible: Boolean(opponentHint && visible(opponentHint)),
    gameHeaderOverflowVisible: Boolean(gameHeaderOverflow && visible(gameHeaderOverflow)),
    lobbyHeaderOverflowVisible: Boolean(lobbyHeaderOverflow && visible(lobbyHeaderOverflow)),
    platformNoticeOverlapsPrimaryAction: overlaps(platformNoticeRect, primaryJoinActionRect),
    focusableDisplayCards: document.querySelectorAll('.game-v2-trick button, .game-v2-waste button, .waste-stack button, .current-trick button').length,
    touchViolations: controls.filter((control) => control.width < 44 || control.height < 44),
    unnamedControls: interactive.filter((element) => !named(element)).map((element) => element.outerHTML.slice(0, 160)),
    duplicateIds,
    overflowingElements,
    controls,
  }
})()`

const landingSeoDiagnosticsExpression = `(() => {
  const root = document.documentElement
  const main = document.querySelector('main.landing-shell')
  const article = document.querySelector('main.landing-shell > article.landing-seo')
  const footer = document.querySelector('body footer.landing-footer')
  const hero = document.querySelector('.landing-grid')
  const rendered = (element) => {
    if (!element) return false
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
      && box.width > 0 && box.height > 0
  }
  const describeElement = (element) => element.tagName.toLowerCase()
    + (element.id ? '#' + element.id : '')
    + (typeof element.className === 'string' && element.className
      ? '.' + element.className.trim().replace(/\\s+/g, '.')
      : '')
  const articleRect = article?.getBoundingClientRect()
  const heroRect = hero?.getBoundingClientRect()
  const footerRect = footer?.getBoundingClientRect()
  const articleText = article?.textContent?.trim().replace(/\\s+/g, ' ') ?? ''
  const headings = [...(main?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [])]
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 100) ?? '',
    }))
  const headingLevelSkips = headings.flatMap((heading, index) => {
    if (index === 0 || heading.level <= headings[index - 1].level + 1) return []
    return [headings[index - 1].level + '->' + heading.level + ': ' + heading.text]
  })
  const faqDetails = [...(article?.querySelectorAll('.landing-seo__faq details') ?? [])]
  const completeFaqCount = faqDetails.filter((details) => {
    const question = details.querySelector('summary')?.textContent?.trim()
    const answer = details.querySelector('p')?.textContent?.trim()
    return Boolean(question && answer)
  }).length
  const requiredTerms = ['Bhabhi Thulla', 'Getaway', 'Ace of Spades', 'anticlockwise', 'THULLA']
  const requiredTermsMissing = requiredTerms.filter((term) => !articleText.toLocaleLowerCase('en').includes(term.toLocaleLowerCase('en')))
  const contentElements = article ? [article, ...article.querySelectorAll('*')] : []
  const overflowingContent = contentElements
    .filter(rendered)
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1)
    .slice(0, 12)
    .map(({ element, box }) => ({
      selector: describeElement(element),
      left: Math.round(box.left),
      right: Math.round(box.right),
      width: Math.round(box.width),
    }))
  const sectionContainmentFailures = [...(article?.querySelectorAll(':scope > section') ?? [])]
    .filter(rendered)
    .filter((section) => {
      const box = section.getBoundingClientRect()
      return !articleRect || box.left < articleRect.left - 1 || box.right > articleRect.right + 1
    })
    .map(describeElement)
  const articleTop = articleRect ? articleRect.top + scrollY : null
  const articleBottom = articleRect ? articleRect.bottom + scrollY : null
  const heroBottom = heroRect ? heroRect.bottom + scrollY : null
  const footerTop = footerRect ? footerRect.top + scrollY : null
  return {
    viewport: [innerWidth, innerHeight],
    pageOverflowX: root.scrollWidth > innerWidth + 1,
    mainCount: document.querySelectorAll('main').length,
    footerCount: document.querySelectorAll('footer').length,
    articleCount: document.querySelectorAll('article.landing-seo').length,
    mainContainsArticle: Boolean(main && article && main.contains(article)),
    articleRendered: rendered(article),
    articleVisibleAfterScroll: Boolean(articleRect
      && articleRect.left < innerWidth && articleRect.right > 0
      && articleRect.top < innerHeight && articleRect.bottom > 0),
    articleHiddenFromUsers: Boolean(article?.closest('[hidden], [aria-hidden="true"]')),
    articleWithinViewportHorizontally: Boolean(articleRect && articleRect.left >= -1 && articleRect.right <= innerWidth + 1),
    articleBelowHero: Boolean(articleTop !== null && heroBottom !== null && articleTop >= heroBottom - 1),
    footerAfterArticle: Boolean(footerTop !== null && articleBottom !== null && footerTop >= articleBottom - 1),
    sectionCount: article?.querySelectorAll(':scope > section').length ?? 0,
    sectionContainmentFailures,
    overflowingContent,
    articleWordCount: articleText ? articleText.split(/\\s+/).length : 0,
    requiredTermsMissing,
    h1Count: main?.querySelectorAll('h1').length ?? 0,
    headingLevels: headings.map(({ level }) => level),
    headingLevelSkips,
    firstHeadingLevel: headings[0]?.level ?? null,
    faqCount: faqDetails.length,
    completeFaqCount,
    documentLanguage: root.lang,
    documentDirection: root.dir || getComputedStyle(root).direction,
    seoLanguage: article?.getAttribute('lang') ?? '',
    seoDirection: article?.getAttribute('dir') ?? '',
    seoComputedDirection: article ? getComputedStyle(article).direction : '',
  }
})()`

async function inspectLandingSeo(cdp, width, height) {
  await setViewport(cdp, width, height)
  await evaluate(cdp, 'scrollTo(0, 0)')
  await waitForResponsiveLayout(cdp)
  await evaluate(cdp, `document.querySelector('.landing-seo')?.scrollIntoView({ block: 'start' })`)
  await waitForResponsiveLayout(cdp)
  return evaluate(cdp, landingSeoDiagnosticsExpression)
}

async function capture(cdp, name, width, height, prepare) {
  await setViewport(cdp, width, height)
  await waitForResponsiveLayout(cdp)
  if (prepare) {
    await prepare()
    await waitForResponsiveLayout(cdp)
  }
  const diagnostics = await evaluate(cdp, diagnosticsExpression)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const outputPath = join(OUTPUT_DIR, `${name}-${width}x${height}.png`)
  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'))
  return { outputPath, ...diagnostics }
}

async function injectQaToast(cdp) {
  const injected = await evaluate(cdp, `(() => {
    document.querySelector('.toast[data-qa-toast="true"]')?.remove()
    const toast = document.createElement('div')
    toast.className = 'toast toast--info'
    toast.dataset.qaToast = 'true'
    toast.dataset.tone = 'info'
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    toast.textContent = 'Layout feedback'
    document.body.append(toast)
    return true
  })()`)
  if (!injected) throw new Error('Could not inject the deterministic QA toast.')
}

async function removeQaToast(cdp) {
  await evaluate(cdp, `document.querySelector('.toast[data-qa-toast="true"]')?.remove()`)
}

async function selectVisibleQaCard(cdp) {
  const selected = await evaluate(cdp, `(() => {
    const scroller = document.querySelector('.game-v2-hand__scroller')
    if (!scroller) return false
    const scrollerRect = scroller.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.game-v2-hand button.game-card--selectable:not(:disabled)')]
      .filter((card) => {
        const rect = card.getBoundingClientRect()
        return rect.left >= scrollerRect.left - 1 && rect.right <= scrollerRect.right + 1
          && rect.top >= scrollerRect.top - 1 && rect.bottom <= scrollerRect.bottom + 1
      })
      .sort((first, second) => {
        const center = scrollerRect.left + scrollerRect.width / 2
        const firstRect = first.getBoundingClientRect()
        const secondRect = second.getBoundingClientRect()
        return Math.abs(firstRect.left + firstRect.width / 2 - center) - Math.abs(secondRect.left + secondRect.width / 2 - center)
      })
    cards[0]?.click()
    return Boolean(cards[0])
  })()`)
  if (!selected) throw new Error('Could not select a fully visible card for clipping QA.')
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-hand button.game-card.is-selected[aria-pressed="true"]'))`)
}

async function revealTableTalkPlayerControls(cdp) {
  const revealed = await evaluate(cdp, `(() => {
    const owner = document.querySelector('.table-talk__chat-scroll[data-scroll-owner="chat"]')
    const summary = owner?.querySelector('.table-talk__player-controls summary')
    if (!owner || !summary) return false
    summary.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    return true
  })()`)
  if (!revealed) throw new Error('Table Talk did not expose its player-controls scroll target.')
}

async function inspectLandingPlayCtaInteraction(cdp) {
  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector('.landing-play-cta[data-action="focus-create-room"][aria-controls="play-bhabhi-thulla"]')
    button?.click()
    return Boolean(button)
  })()`)
  if (!clicked) return { clicked: false, targetVisible: false, nameInputFocused: false }
  await waitForExpression(cdp, `document.activeElement?.id === 'player-name'`)
  await waitForResponsiveLayout(cdp)
  return evaluate(cdp, `(() => {
    const target = document.getElementById('play-bhabhi-thulla')
    const rect = target?.getBoundingClientRect()
    return {
      clicked: true,
      targetVisible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
      nameInputFocused: document.activeElement?.id === 'player-name',
    }
  })()`)
}

async function inspectOpponentKeyboardNavigation(cdp, width, height, language = 'en') {
  await setViewport(cdp, width, height)
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `Boolean(document.body)`)
  await evaluate(cdp, `localStorage.setItem('thulla:language', ${JSON.stringify(language)})`)
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}/?qa=many-players` })
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-opponents.is-keyboard-scrollable[data-overflow-position]'))`)
  await waitForResponsiveLayout(cdp)
  return evaluate(cdp, `(async () => {
    const rail = document.querySelector('.game-v2-opponents.is-keyboard-scrollable[data-overflow-position]')
    const indicator = document.querySelector('.game-v2-opponent-position[role="status"]')
    const seats = [...(rail?.querySelectorAll('[data-opponent-seat][data-player-id]') ?? [])]
    if (!rail || !indicator || seats.length < 2) return { available: false }
    const press = async (key) => {
      rail.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 850))
      return Number(rail.dataset.overflowPosition)
    }
    const edgeOffsets = () => {
      const railBounds = rail.getBoundingClientRect()
      const sortedSeats = [...seats].sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left)
      return {
        first: Math.abs(sortedSeats[0].getBoundingClientRect().left - railBounds.left),
        last: Math.abs(sortedSeats[sortedSeats.length - 1].getBoundingClientRect().right - railBounds.right),
      }
    }
    rail.focus({ preventScroll: true })
    const homePosition = await press('Home')
    const homeScroll = rail.scrollLeft
    const homeEdgeOffset = edgeOffsets().first
    const arrowPosition = await press('ArrowRight')
    const arrowScroll = rail.scrollLeft
    const endPosition = await press('End')
    const endScroll = rail.scrollLeft
    const endEdgeOffset = edgeOffsets().last
    const maxScroll = rail.scrollWidth - rail.clientWidth
    return {
      available: true,
      focused: document.activeElement === rail,
      role: rail.getAttribute('role'),
      tabIndex: rail.tabIndex,
      keyShortcuts: rail.getAttribute('aria-keyshortcuts'),
      seatCount: seats.length,
      uniqueSeatIds: new Set(seats.map((seat) => seat.dataset.playerId)).size === seats.length,
      indicatorDescribedBy: rail.getAttribute('aria-describedby') === indicator.id,
      indicatorPerceptible: Number(getComputedStyle(indicator).opacity) > 0.1,
      homePosition,
      arrowPosition,
      endPosition,
      homeScroll,
      arrowScroll,
      endScroll,
      maxScroll,
      homeEdgeOffset,
      endEdgeOffset,
      documentDirection: document.documentElement.dir,
      documentLanguage: document.documentElement.lang,
    }
  })()`)
}

async function inspectResultActionReachability(cdp, width, height) {
  await setViewport(cdp, width, height)
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}/?qa=finished` })
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-result__card [data-result-action="ready"]'))`)
  await waitForResponsiveLayout(cdp)
  return evaluate(cdp, `(async () => {
    const card = document.querySelector('.game-v2-result__card')
    const controls = card?.querySelector('.game-v2-result__controls')
    const actionElements = [...(controls?.querySelectorAll('[data-result-action]') ?? [])]
    const inside = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - 1 && inner.top >= outer.top - 1
      && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1)
    const actions = []
    for (const element of actionElements) {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const rect = element.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      const controlsRect = controls.getBoundingClientRect()
      actions.push({
        action: element.getAttribute('data-result-action'),
        fullyVisible: inside(rect, cardRect) && inside(rect, controlsRect)
          && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        focusable: !element.disabled && element.tabIndex >= 0,
        ariaPressed: element.getAttribute('aria-pressed'),
      })
    }
    return {
      actions,
      blockerPresent: Boolean(card?.querySelector('.game-v2-result__blocker[role="status"]')),
      duplicateActions: [...new Set(actions.map(({ action }) => action).filter((action, index, all) => all.indexOf(action) !== index))],
    }
  })()`)
}

function waitForState(socket, latestStates, predicate, timeoutMs = 15_000) {
  const current = latestStates.get(socket)
  if (current && predicate(current)) return Promise.resolve(current)
  return new Promise((resolveState, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:state', onState)
      const latest = latestStates.get(socket)
      reject(new Error(`Timed out waiting for a matching room state. Latest state: ${JSON.stringify({ status: latest?.status, phase: latest?.game?.phase, turn: latest?.game?.currentTurnId, trick: latest?.game?.trick?.length })}`))
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

function assertCollisionFree(result, context) {
  assert(!result.landingDecorationOverlapsBenefits, `${context} places the decorative cards over the benefit row.`)
  assert(result.opponentSeatsOverlapDirection.length === 0, `${context} places opponent seats over the direction cue: ${JSON.stringify(result.opponentSeatsOverlapDirection)}`)
  assert(result.opponentSeatsOverlapHint.length === 0, `${context} places opponent seats over the swipe cue: ${JSON.stringify(result.opponentSeatsOverlapHint)}`)
  assert(!result.opponentHintOverlapsDirection, `${context} overlaps the opponent swipe cue and play direction.`)
  assert(result.opponentBadgesOverlapDirection.length === 0, `${context} places RIGHT/TURN badges over the direction cue: ${JSON.stringify(result.opponentBadgesOverlapDirection)}`)
  assert(result.opponentBadgesOverlapHint.length === 0, `${context} places RIGHT/TURN badges over the swipe cue: ${JSON.stringify(result.opponentBadgesOverlapHint)}`)
  assert(result.opponentBadgesOverlapTrick.length === 0, `${context} places RIGHT/TURN badges over the current trick: ${JSON.stringify(result.opponentBadgesOverlapTrick)}`)
  assert(result.opponentPositionOverlapsSeats.length === 0, `${context} places the opponent-position indicator over a seat: ${JSON.stringify(result.opponentPositionOverlapsSeats)}`)
  assert(!result.opponentPositionOverlapsDirection, `${context} overlaps the opponent-position indicator and direction cue.`)
  assert(!result.opponentPositionOverlapsTrick, `${context} overlaps the opponent-position indicator and current trick.`)
  assert(!result.trickOverlapsStatus, `${context} overlaps the current trick and status panel.`)
  assert(result.explanationOverlapsMatchLog.length === 0, `${context} places the explanation control over Match Log: ${JSON.stringify(result.explanationOverlapsMatchLog)}`)
  assert(result.explanationOverlapsTableTalk.length === 0, `${context} places the explanation control over Table Talk: ${JSON.stringify(result.explanationOverlapsTableTalk)}`)
  assert(result.socialControlsOverlap.length === 0, `${context} overlaps social controls: ${JSON.stringify(result.socialControlsOverlap)}`)
  assert(result.socialControlsOverlapStatus.length === 0, `${context} places social controls over the status panel: ${JSON.stringify(result.socialControlsOverlapStatus)}`)
  assert(result.socialControlsOverlapHand.length === 0, `${context} places social controls over the hand: ${JSON.stringify(result.socialControlsOverlapHand)}`)
  assert(result.compactUtilityGapViolations.length === 0, `${context} leaves less than 8px between compact utility controls: ${JSON.stringify(result.compactUtilityGapViolations)}`)
  assert(result.fixedControlsOverlapHand.length === 0, `${context} places fixed table controls over the hand: ${JSON.stringify(result.fixedControlsOverlapHand)}`)
  assert(result.fixedControlsClipped.length === 0, `${context} clips fixed table controls: ${JSON.stringify(result.fixedControlsClipped)}`)
}

function assertShortViewport(result, context) {
  assert(!result.pageOverflowX, `${context} has horizontal page overflow.`)
  assert(result.shortViewportOperable, `${context} does not keep its primary game surfaces and actions operable.`)
  assert(result.touchViolations.length === 0, `${context} has touch targets under 44px: ${JSON.stringify(result.touchViolations)}`)
  assert(result.unnamedControls.length === 0, `${context} has unnamed controls.`)
  assert(result.duplicateIds.length === 0, `${context} has duplicate IDs.`)
  assertCollisionFree(result, context)
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

  const landingShortScreens = {}
  for (const viewport of SHORT_PHONE_VIEWPORTS) {
    await cdp.send('Page.navigate', { url: CLIENT_URL })
    await waitForExpression(cdp, `Boolean(document.querySelector('.landing-shell .join-card'))`)
    await waitForExpression(cdp, `document.querySelector('.connection-label')?.dataset.connected === 'true'`)
    const result = await capture(cdp, 'landing-short-screen', viewport.width, viewport.height)
    landingShortScreens[viewport.name] = result
    const context = `Landing at ${viewport.width}x${viewport.height}`
    assertShortViewport(result, context)
    assert(result.landingPrimaryActionReachable, `${context} cannot reach the create-room action by scrolling.`)
    if (LANDING_PLAY_CTA_VIEWPORTS.has(viewport.name)) {
      assert(result.landingPlayCtaRendered && result.landingPlayCtaVisible, `${context} does not show the short-screen Play shortcut.`)
      assert(result.landingPlayCtaFullyVisible, `${context} clips the short-screen Play shortcut.`)
      assert(result.landingPlayCtaFocusable, `${context} does not expose the Play shortcut as a focusable button.`)
      assert(result.landingPlayCtaControlsJoinCard, `${context} does not connect the Play shortcut to the create-room panel.`)
      const interaction = await inspectLandingPlayCtaInteraction(cdp)
      result.landingPlayCtaInteraction = interaction
      assert(interaction.clicked && interaction.targetVisible, `${context} Play shortcut does not reveal the create-room panel.`)
      assert(interaction.nameInputFocused, `${context} Play shortcut does not focus the player-name field.`)
    }
  }

  const landingSeoViewports = {}
  for (const viewport of LANDING_SEO_VIEWPORTS) {
    await cdp.send('Page.navigate', { url: CLIENT_URL })
    await waitForExpression(cdp, `Boolean(document.querySelector('main.landing-shell > article.landing-seo'))`)
    const result = await inspectLandingSeo(cdp, viewport.width, viewport.height)
    landingSeoViewports[viewport.name] = result
    const context = `Landing SEO content at ${viewport.width}x${viewport.height}`
    assert(!result.pageOverflowX, `${context} causes horizontal page overflow.`)
    assert(result.articleRendered && result.articleVisibleAfterScroll, `${context} is not visibly rendered when scrolled into view.`)
    assert(result.articleWithinViewportHorizontally, `${context} extends outside the viewport.`)
    assert(result.overflowingContent.length === 0, `${context} has overflowing descendants: ${JSON.stringify(result.overflowingContent)}`)
    assert(result.sectionContainmentFailures.length === 0, `${context} has sections outside the SEO article: ${JSON.stringify(result.sectionContainmentFailures)}`)
    assert(result.articleBelowHero, `${context} is not positioned below the playable landing hero.`)
    assert(result.footerAfterArticle, `${context} places the footer before or over the SEO article.`)
  }

  const landingSeoSemantics = landingSeoViewports['seo-phone-375']
  assert(landingSeoSemantics.mainCount === 1, `The landing page exposes ${landingSeoSemantics.mainCount} main landmarks instead of one.`)
  assert(landingSeoSemantics.footerCount === 1, `The landing page exposes ${landingSeoSemantics.footerCount} footer landmarks instead of one.`)
  assert(landingSeoSemantics.articleCount === 1, `The landing page exposes ${landingSeoSemantics.articleCount} SEO guide articles instead of one.`)
  assert(landingSeoSemantics.mainContainsArticle, 'The SEO guide is not contained by the landing-page main landmark.')
  assert(!landingSeoSemantics.articleHiddenFromUsers, 'The SEO guide is hidden or aria-hidden instead of being crawlable page content.')
  assert(landingSeoSemantics.articleWordCount >= 800, `The SEO guide contains only ${landingSeoSemantics.articleWordCount} rendered words.`)
  assert(landingSeoSemantics.requiredTermsMissing.length === 0, `The SEO guide is missing core game terms: ${landingSeoSemantics.requiredTermsMissing.join(', ')}`)
  assert(landingSeoSemantics.sectionCount >= 7, `The SEO guide exposes only ${landingSeoSemantics.sectionCount} top-level content sections.`)
  assert(landingSeoSemantics.h1Count === 1, `The landing main contains ${landingSeoSemantics.h1Count} h1 elements instead of one.`)
  assert(landingSeoSemantics.firstHeadingLevel === 1, `The landing heading outline begins at h${landingSeoSemantics.firstHeadingLevel}.`)
  assert(landingSeoSemantics.headingLevelSkips.length === 0, `The landing heading hierarchy skips levels: ${landingSeoSemantics.headingLevelSkips.join(' | ')}`)
  assert(landingSeoSemantics.faqCount === 10, `The landing guide contains ${landingSeoSemantics.faqCount} FAQs instead of ten.`)
  assert(landingSeoSemantics.completeFaqCount === 10, `Only ${landingSeoSemantics.completeFaqCount} FAQs contain both a question and answer.`)
  assert(landingSeoSemantics.seoLanguage.toLowerCase() === 'en-pk', `The English SEO guide has an incorrect lang value: ${landingSeoSemantics.seoLanguage}`)
  assert(landingSeoSemantics.seoDirection === 'ltr' && landingSeoSemantics.seoComputedDirection === 'ltr', 'The English SEO guide is not explicitly rendered left-to-right.')

  await evaluate(cdp, `localStorage.setItem('thulla:language', 'ur')`)
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `document.documentElement.lang === 'ur-PK' && document.documentElement.dir === 'rtl' && Boolean(document.querySelector('.landing-seo'))`)
  const landingSeoUrduIsolation = await inspectLandingSeo(cdp, 375, 812)
  assert(landingSeoUrduIsolation.documentLanguage === 'ur-PK' && landingSeoUrduIsolation.documentDirection === 'rtl', 'The Urdu landing interface did not switch the document to ur-PK/RTL.')
  assert(landingSeoUrduIsolation.seoLanguage.toLowerCase() === 'en-pk', `The English guide lost its language override under Urdu mode: ${landingSeoUrduIsolation.seoLanguage}`)
  assert(landingSeoUrduIsolation.seoDirection === 'ltr' && landingSeoUrduIsolation.seoComputedDirection === 'ltr', 'The English guide inherited RTL direction under Urdu mode.')
  assert(!landingSeoUrduIsolation.pageOverflowX, 'The Urdu interface plus English SEO guide causes horizontal overflow at 375px.')
  await evaluate(cdp, `localStorage.setItem('thulla:language', 'en')`)
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr' && Boolean(document.querySelector('.landing-shell'))`)
  await waitForExpression(cdp, `document.querySelector('.connection-label')?.dataset.connected === 'true'`)

  await evaluate(cdp, `(() => {
    const region = document.getElementById('platform-notices')
    if (!region) return false
    region.innerHTML = '<div class="platform-notice platform-notice--update" role="status"><div class="platform-notice__copy"><strong>Game update ready</strong><span>Update when it is safe to reconnect.</span></div><div class="platform-notice__actions"><button type="button">Update & reconnect</button><button type="button" class="platform-notice__later">Later</button></div></div>'
    return true
  })()`)
  const platformNotice = await capture(cdp, 'platform-notice-mobile', 390, 844)
  assert(platformNotice.platformNoticeVisible, 'The mobile platform notice is not visible.')
  assert(platformNotice.platformNoticeFullyVisible, 'The mobile platform notice is clipped by the viewport.')
  assert(!platformNotice.platformNoticeOverlapsPrimaryAction, 'The mobile platform notice covers the primary create-room action.')
  assert(platformNotice.touchViolations.length === 0, `The platform notice has touch targets under 44px: ${JSON.stringify(platformNotice.touchViolations)}`)
  assert(platformNotice.unnamedControls.length === 0, 'The platform notice has unnamed controls.')
  await evaluate(cdp, `document.getElementById('platform-notices')?.replaceChildren()`)

  const fixtureDefinitions = [
    { mode: 'lobby', selector: '.lobby-shell' },
    { mode: 'playing', selector: '.game-v2-shell' },
    { mode: 'many-players', selector: '.game-v2-opponents' },
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
    const fixturePrepare = fixture.mode === 'playing'
      ? async () => { await selectVisibleQaCard(cdp); await injectQaToast(cdp) }
      : fixture.mode === 'lobby'
        ? async () => injectQaToast(cdp)
        : null
    const captureFreshFixture = async (name, width, height, extraPrepare) => {
      await cdp.send('Page.navigate', { url: fixtureUrl })
      await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(fixture.selector)}))`)
      const prepare = fixturePrepare || extraPrepare
        ? async () => {
            if (fixturePrepare) await fixturePrepare()
            if (extraPrepare) await extraPrepare()
          }
        : undefined
      return capture(cdp, name, width, height, prepare)
    }
    const portrait = await captureFreshFixture(`fixture-${fixture.mode}-mobile`, 390, 844)
    const landscape = await captureFreshFixture(`fixture-${fixture.mode}-landscape`, 844, 390)
    const narrow = ['lobby', 'playing', 'many-players'].includes(fixture.mode)
      ? await captureFreshFixture(`fixture-${fixture.mode}-narrow`, 320, 740)
      : null
    const desktop = fixture.mode === 'resolving' ? await captureFreshFixture(`fixture-${fixture.mode}-desktop`, 1366, 768) : null
    const shortDesktop = ['playing', 'waiting', 'finished', 'finished-waiting'].includes(fixture.mode)
      ? await captureFreshFixture(`fixture-${fixture.mode}-short-desktop`, 1366, 600)
      : null
    const shortScreens = {}
    const shortViewportNames = fixtureShortMatrix[fixture.mode] ?? []
    for (const viewportName of shortViewportNames) {
      const viewport = SHORT_PHONE_VIEWPORTS.find(({ name }) => name === viewportName)
      if (!viewport) throw new Error(`Unknown short-screen viewport: ${viewportName}`)
      shortScreens[viewport.name] = await captureFreshFixture(
        `fixture-${fixture.mode}-short-screen`,
        viewport.width,
        viewport.height,
        fixture.mode === 'resolving' ? async () => {
          await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-explanation-toggle'))`)
          await evaluate(cdp, `document.querySelector('.game-v2-explanation-toggle')?.click()`)
          await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-explanation > p'))`)
        } : null,
      )
    }
    let chatOpen = null
    if (fixture.mode === 'playing') {
      await removeQaToast(cdp)
      await evaluate(cdp, `document.querySelector('.table-talk__trigger')?.click()`)
      await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__drawer:not([hidden])'))`)
      chatOpen = {
        portrait: await capture(cdp, 'fixture-playing-chat-open-mobile', 390, 844),
        shortPortrait: await capture(cdp, 'fixture-playing-chat-open-short-phone', 320, 480, async () => revealTableTalkPlayerControls(cdp)),
        phoneLandscape: await capture(cdp, 'fixture-playing-chat-open-phone-landscape', 667, 375),
        landscape: await capture(cdp, 'fixture-playing-chat-open-landscape', 844, 390, async () => revealTableTalkPlayerControls(cdp)),
        desktop: await capture(cdp, 'fixture-playing-chat-open-desktop', 1366, 768),
        shortDesktop: await capture(cdp, 'fixture-playing-chat-open-short-desktop', 1366, 600),
      }
    }
    fixtureResults[fixture.mode] = { portrait, landscape, narrow, desktop, shortDesktop, shortScreens, chatOpen }
    for (const result of [portrait, landscape, narrow, desktop, shortDesktop].filter(Boolean)) {
      assert(!result.pageOverflowX, `${fixture.mode} fixture has horizontal overflow at ${result.viewport.join('x')}.`)
      assert(result.touchViolations.length === 0, `${fixture.mode} fixture has touch targets under 44px at ${result.viewport.join('x')}: ${JSON.stringify(result.touchViolations)}`)
      assert(result.unnamedControls.length === 0, `${fixture.mode} fixture has unnamed controls at ${result.viewport.join('x')}.`)
      assert(result.duplicateIds.length === 0, `${fixture.mode} fixture has duplicate IDs at ${result.viewport.join('x')}.`)
      assertCollisionFree(result, `${fixture.mode} fixture at ${result.viewport.join('x')}`)
    }
    for (const result of Object.values(shortScreens)) {
      assertShortViewport(result, `${fixture.mode} fixture at ${result.viewport.join('x')}`)
    }
    if (chatOpen) {
      for (const result of Object.values(chatOpen)) {
        assert(result.tableTalkDrawerVisible, `Table Talk did not open at ${result.viewport.join('x')}.`)
        assert(result.tableTalkDrawerFullyVisible, `Table Talk was clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkComposerVisible, `Table Talk composer was not visible at ${result.viewport.join('x')}.`)
        assert(result.tableTalkComposerFullyVisible, `Table Talk composer was partially clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkTextareaFullyVisible, `Table Talk textarea was clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkSendFullyVisible, `Table Talk send button was clipped at ${result.viewport.join('x')}.`)
        assert(result.tableTalkChatScrollPresent && result.tableTalkChatScrollConfigured, `Table Talk lacks its dedicated chat scroller at ${result.viewport.join('x')}.`)
        assert(result.tableTalkChatScrollFocusable, `Table Talk chat content is not keyboard-focusable at ${result.viewport.join('x')}.`)
        assert(result.tableTalkComposerIsChatScrollSibling, `Table Talk composer is nested inside the chat scroller at ${result.viewport.join('x')}.`)
        assert(result.tableTalkUnexpectedVerticalScrollers.length === 0, `Table Talk has nested vertical scrollers at ${result.viewport.join('x')}: ${JSON.stringify(result.tableTalkUnexpectedVerticalScrollers)}`)
        assert(!result.pageOverflowX, `Open Table Talk caused horizontal overflow at ${result.viewport.join('x')}.`)
        assert(result.touchViolations.length === 0, `Open Table Talk has touch targets under 44px at ${result.viewport.join('x')}: ${JSON.stringify(result.touchViolations)}`)
        assert(result.unnamedControls.length === 0, `Open Table Talk has unnamed controls at ${result.viewport.join('x')}.`)
      }
      assert(!chatOpen.landscape.tableTalkOverlapsCurrentTrick, 'Landscape Table Talk covers the current trick.')
      assert(chatOpen.portrait.tableTalkScrimVisible, 'Mobile Table Talk does not show a modal scrim.')
      assert(chatOpen.portrait.tableTalkAriaModal === 'true', 'Mobile Table Talk is not exposed as a modal dialog.')
      assert(chatOpen.shortPortrait.tableTalkScrimVisible && chatOpen.shortPortrait.tableTalkAriaModal === 'true', 'Short-phone Table Talk is not a complete modal sheet.')
      assert(chatOpen.phoneLandscape.tableTalkScrimVisible && chatOpen.phoneLandscape.tableTalkAriaModal === 'true', 'Phone-landscape Table Talk is not a complete modal sheet.')
      assert(chatOpen.desktop.tableTalkAriaModal !== 'true', 'Desktop Table Talk is incorrectly exposed as modal.')
      assert(!chatOpen.desktop.tableTalkOverlapsRightSeat, 'Desktop Table Talk covers the right-hand opponent.')
      assert(!chatOpen.desktop.tableTalkOverlapsGameTable, 'Desktop Table Talk overlays the game table instead of docking beside it.')
      assert(!chatOpen.desktop.tableTalkOverlapsHand, 'Desktop Table Talk overlays the hand instead of docking beside it.')
      for (const [name, result] of [['320x480', chatOpen.shortPortrait], ['844x390', chatOpen.landscape]]) {
        assert(result.tableTalkPlayerControlsPresent, `Table Talk player controls are missing at ${name}.`)
        assert(result.tableTalkPlayerControlsFullyVisible && result.tableTalkPlayerControlsSummaryFullyVisible, `Table Talk player controls cannot be fully revealed at ${name}.`)
        assert(result.tableTalkComposerFullyVisible, `Revealing Table Talk player controls clips the composer at ${name}.`)
      }
    }
  }

  const lobbyPolishResults = [
    fixtureResults.lobby.portrait,
    fixtureResults.lobby.landscape,
    fixtureResults.lobby.narrow,
    ...Object.values(fixtureResults.lobby.shortScreens),
  ].filter(Boolean)
  for (const result of lobbyPolishResults) {
    const context = `Lobby polish at ${result.viewport.join('x')}`
    assert(result.lobbyActionGroupsPresent && result.lobbyActionGroupsFullyContained, `${context} is missing the primary/secondary action-group contract.`)
    assert(result.lobbySecondaryActionFullyContained, `${context} places secondary actions outside the lobby action flow.`)
    assert(result.lobbyPrimaryActionFullyVisible, `${context} does not show the primary action in the initial viewport.`)
    assert(!result.lobbyActionGroupsOverlap, `${context} overlaps primary and secondary action groups.`)
    assert(result.lobbyActionControlsOverlap.length === 0, `${context} overlaps action controls: ${JSON.stringify(result.lobbyActionControlsOverlap)}`)
    assert(!result.lobbyActionsOverlapContentGrid && !result.lobbyActionsOverlapHint, `${context} places the action container over lobby content.`)
    assert(!result.lobbyPrimaryActionOverlapsContentGrid && !result.lobbyPrimaryActionOverlapsHint, `${context} places the sticky primary action over lobby content.`)
    assert(!result.lobbySecondaryActionOverlapsContentGrid && !result.lobbySecondaryActionOverlapsHint, `${context} places secondary actions over lobby content.`)
    assert(result.qaToastVisible && result.qaToastFullyVisible, `${context} does not fully show the deterministic toast.`)
    assert(!result.qaToastOverlapsLobbyActions && !result.qaToastOverlapsLobbyPrimaryAction, `${context} places the toast over lobby actions.`)
  }

  const selectedCardResults = [
    fixtureResults.playing.portrait,
    fixtureResults.playing.landscape,
    fixtureResults.playing.narrow,
    fixtureResults.playing.shortDesktop,
    ...Object.values(fixtureResults.playing.shortScreens),
  ].filter(Boolean)
  for (const result of selectedCardResults) {
    const context = `Selected-card polish at ${result.viewport.join('x')}`
    assert(result.selectedCardPresent && result.selectedCardVisible, `${context} did not exercise a selected card.`)
    assert(result.selectedCardFullyInsideViewport && result.selectedCardFullyInsideScroller, `${context} clips the selected card.`)
    assert(result.selectedCardClippingAncestors.length === 0, `${context} clips the selected card through: ${JSON.stringify(result.selectedCardClippingAncestors)}`)
    assert(!result.selectedCardOverlapsActionBar, `${context} places the selected card over the action bar.`)
    assert(result.qaToastVisible && result.qaToastFullyVisible, `${context} does not fully show the deterministic toast.`)
    assert(!result.qaToastOverlapsGameActionBar && !result.qaToastOverlapsGamePrimaryAction, `${context} places the toast over gameplay actions.`)
  }

  const opponentKeyboard = {
    shortPortrait: await inspectOpponentKeyboardNavigation(cdp, 320, 480),
    rtlShortPortrait: await inspectOpponentKeyboardNavigation(cdp, 320, 480, 'ur'),
    landscape: await inspectOpponentKeyboardNavigation(cdp, 844, 390),
  }
  for (const [name, result] of Object.entries(opponentKeyboard)) {
    const shortcuts = new Set((result.keyShortcuts ?? '').split(/\s+/).filter(Boolean))
    assert(result.available && result.focused, `Crowded opponent rail is not keyboard-focusable in ${name}.`)
    assert(result.role === 'region' && result.tabIndex === 0, `Crowded opponent rail lacks region/tabindex semantics in ${name}.`)
    assert(['ArrowLeft', 'ArrowRight', 'Home', 'End'].every((key) => shortcuts.has(key)), `Crowded opponent rail lacks declared key shortcuts in ${name}: ${result.keyShortcuts}`)
    assert(result.uniqueSeatIds && result.seatCount === 7, `Crowded opponent rail has invalid seat identities in ${name}.`)
    assert(result.indicatorDescribedBy && result.indicatorPerceptible, `Crowded opponent rail does not expose its visible position status in ${name}.`)
    assert(result.homePosition === 1 && result.arrowPosition === 2 && result.endPosition === result.seatCount, `Crowded opponent rail keyboard navigation failed in ${name}: ${JSON.stringify(result)}`)
    assert(result.homeEdgeOffset <= 3 && result.endEdgeOffset <= 3, `Crowded opponent rail did not reach both physical edges in ${name}: ${JSON.stringify(result)}`)
    if (name === 'rtlShortPortrait') assert(result.documentDirection === 'rtl' && result.documentLanguage === 'ur-PK', `RTL opponent QA did not load the Urdu document contract: ${JSON.stringify(result)}`)
  }

  const resultActionReachability = {
    shortPortrait: await inspectResultActionReachability(cdp, 320, 480),
    landscape: await inspectResultActionReachability(cdp, 844, 390),
  }
  const requiredResultActions = ['ready', 'invite', 'leave', 'add-bot']
  for (const [name, result] of Object.entries(resultActionReachability)) {
    const byAction = new Map(result.actions.map((action) => [action.action, action]))
    assert(result.blockerPresent, `Finished dialog omits its explicit blocker status in ${name}.`)
    assert(result.duplicateActions.length === 0, `Finished dialog duplicates result actions in ${name}: ${result.duplicateActions.join(', ')}`)
    for (const actionName of requiredResultActions) {
      const action = byAction.get(actionName)
      assert(Boolean(action), `Finished dialog omits ${actionName} in ${name}.`)
      assert(Boolean(action?.fullyVisible && action?.focusable), `Finished dialog cannot reach ${actionName} in ${name}.`)
    }
    assert(['true', 'false'].includes(byAction.get('ready')?.ariaPressed), `Finished dialog ready action is not an aria-pressed toggle in ${name}.`)
  }

  assert(fixtureResults.lobby.landscape.lobbyActionsVisible, 'Landscape lobby actions are below the visible viewport.')
  assert(fixtureResults.lobby.landscape.lobbyActionsFullyVisible, 'Landscape lobby actions are clipped.')
  assert(!fixtureResults.lobby.landscape.pageOverflowY, 'The compact landscape lobby still scrolls the whole page.')
  assert(fixtureResults.lobby.narrow.lobbyCardFullyVisibleHorizontally, 'The 320px lobby card is horizontally clipped.')
  assert(fixtureResults.lobby.portrait.lobbyHeaderOverflowVisible, 'The mobile lobby does not expose its compact header menu.')
  assert(fixtureResults.playing.portrait.gameHeaderOverflowVisible, 'The mobile game does not expose its compact header menu.')
  assert(fixtureResults.playing.portrait.accessibleTimerCount === 1, 'The active turn is not exposed through one accessible timer.')
  assert(!fixtureResults.playing.portrait.handTurnChipVisible, 'The mobile hand repeats the table-level Your turn message.')
  assert(fixtureResults['many-players'].portrait.opponentRailOverflow, 'The crowded-player fixture does not exercise opponent overflow.')
  assert(fixtureResults['many-players'].portrait.opponentHintVisible, 'A crowded opponent rail has no visible swipe cue.')
  assert(fixtureResults['many-players'].narrow.opponentHintVisible, 'The 320px crowded opponent rail has no visible swipe cue.')
  assert(fixtureResults['many-players'].portrait.opponentPositionPresent && fixtureResults['many-players'].portrait.opponentPositionFullyVisible, 'The crowded opponent rail has no contained position indicator.')
  assert(fixtureResults['many-players'].portrait.opponentRailRole === 'region' && fixtureResults['many-players'].portrait.opponentRailTabIndex === 0, 'The crowded opponent rail lacks focusable-region semantics.')
  assert(fixtureResults['many-players'].portrait.opponentSeatContractCount === 7 && fixtureResults['many-players'].portrait.opponentSeatIdsUnique, 'The crowded opponent seats lack stable unique player contracts.')
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
  assert(['ready', 'invite', 'leave', 'add-bot'].every((action) => fixtureResults.finished.portrait.resultActionNames.includes(action)), `The finished screen is missing required result actions: ${JSON.stringify(fixtureResults.finished.portrait.resultActionNames)}`)
  assert(['true', 'false'].includes(fixtureResults.finished.portrait.resultReadyAriaPressed), 'The finished-screen readiness action is not exposed as a toggle.')
  assert(fixtureResults.finished.portrait.resultActionsOutsideControls.length === 0, `Finished actions escape the result control region: ${JSON.stringify(fixtureResults.finished.portrait.resultActionsOutsideControls)}`)
  assert(fixtureResults.finished.portrait.resultBlockerPresent, 'The finished screen does not expose the next-round blocker as status text.')
  assert(/cancel readiness/i.test(fixtureResults.finished.portrait.readinessActionText), `The finished-round ready action is ambiguous: ${fixtureResults.finished.portrait.readinessActionText}`)
  assert(!fixtureResults.finished.portrait.handVisible, 'The finished-round result leaves the old hand visible.')
  assert(!fixtureResults.finished.landscape.handVisible, 'The landscape finished-round result leaves the old hand visible.')

  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `Boolean(document.querySelector('.landing-shell'))`)

  const host = await connectedSocket()
  sockets.push(host)
  host.on('room:state', (state) => latestStates.set(host, state))
  const hostCredentials = await emitAck(host, 'room:create', { name: 'Nouman' })
  participants.push({ socket: host, credentials: hostCredentials })
  // Three seats are enough to exercise a real completed trick here. The
  // deterministic many-players fixture above owns the separate 8-seat layout
  // coverage without making this live Socket.IO path unnecessarily fragile.
  for (const name of ['Ayesha', 'Bilal']) {
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

  while (room.game?.phase !== 'resolving' && room.game?.trick.length < participants.length - 1) {
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
  await setViewport(cdp, 1440, 900)
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}/?room=${finalParticipant.credentials.code}` })
  try {
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-shell'))`)
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-card--selectable:not(:disabled)'))`)
  } catch (error) {
    const pageState = await evaluate(cdp, `({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 800) ?? '' })`)
    throw new Error(`${error.message} Page state: ${JSON.stringify(pageState)}`)
  }

  await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__trigger'))`)
  await evaluate(cdp, `document.querySelector('.table-talk__trigger')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.table-talk__drawer:not([hidden])'))`)
  await waitForResponsiveLayout(cdp)
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-card--selectable:not(:disabled)'))`)
  // Observe before clicking: a legal card can advance immediately and make a
  // listener registered after selection miss the intentionally brief reveal.
  const resolvingStatePromise = waitForState(host, latestStates, (state) => state.game?.phase === 'resolving', 10_000)
  await evaluate(cdp, `document.querySelector('.game-card--selectable:not(:disabled)')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.game-card.is-selected, .game-card[aria-pressed="true"]'))`)
  await waitForExpression(cdp, `[...document.querySelectorAll('.game-v2-button--primary:not(:disabled)')].some((button) => !button.closest('.table-talk'))`)
  const playClicked = await evaluate(cdp, `(() => { const button = [...document.querySelectorAll('.game-v2-button--primary:not(:disabled)')].find((candidate) => !candidate.closest('.table-talk')); button?.click(); return Boolean(button) })()`)
  assert(playClicked, 'The restored browser player did not expose a playable-card action.')
  let resolvingState
  try {
    resolvingState = await resolvingStatePromise
  } catch (error) {
    const browserPlayState = await evaluate(cdp, `({
      connected: document.querySelector('.game-v2-connection')?.getAttribute('data-connected'),
      selectedCard: document.querySelector('.game-card.is-selected, .game-card[aria-pressed="true"]')?.getAttribute('aria-label'),
      primaryAction: [...document.querySelectorAll('.game-v2-button--primary')].find((button) => !button.closest('.table-talk'))?.textContent?.trim(),
      primaryDisabled: [...document.querySelectorAll('.game-v2-button--primary')].find((button) => !button.closest('.table-talk'))?.disabled,
      toast: document.querySelector('.toast')?.textContent?.trim(),
      status: document.querySelector('.game-v2-status')?.textContent?.trim(),
      chatOpen: Boolean(document.querySelector('.table-talk__drawer:not([hidden])')),
    })`)
    throw new Error(`${error.message} Browser play state: ${JSON.stringify(browserPlayState)}`)
  }
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
    10_000,
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
    landing: {
      ...landing,
      cta: landingCta,
      shortScreens: landingShortScreens,
      seo: { viewports: landingSeoViewports, semantics: landingSeoSemantics, urduIsolation: landingSeoUrduIsolation },
      platformNotice,
    },
    fixtures: fixtureResults,
    polish: {
      opponentKeyboard,
      resultActionReachability,
    },
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
