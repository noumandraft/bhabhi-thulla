import { spawn } from 'node:child_process'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { io } from 'socket.io-client'

const SERVER_URL = process.env.QA_SERVER_URL ?? 'http://localhost:3001'
const CLIENT_URL = process.env.QA_CLIENT_URL ?? 'http://localhost:5173'
const OUTPUT_DIR = resolve(process.env.QA_OUTPUT_DIR ?? 'design/qa')
const DEBUG_PORT = Number(process.env.QA_CHROME_PORT ?? 9333)
const SCENARIO = process.env.QA_SCENARIO === 'resolved' ? 'resolved' : 'active'
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

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
      if (response.ok) resolveAck(response.data)
      else reject(new Error(response.error ?? `${event} failed`))
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

async function waitForJson(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

async function waitForExpression(cdp, expression, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(cdp, expression)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function capture(cdp, name, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 620 })
  await new Promise((resolveWait) => setTimeout(resolveWait, 180))
  const diagnostics = await evaluate(cdp, `(() => {
    const root = document.documentElement
    const rightSeat = document.querySelector('.game-v2-seat.is-right-player')
    const resolution = document.querySelector('.game-v2-resolution')
    const lastCard = document.querySelector('.game-v2-trick-card.is-last-played')
    const controls = [...document.querySelectorAll('.game-v2-header button, .game-v2-actions button')]
      .map((element) => {
        const box = element.getBoundingClientRect()
        return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: Math.round(box.width), height: Math.round(box.height) }
      })
    const rightBox = rightSeat?.getBoundingClientRect()
    return {
      viewport: [innerWidth, innerHeight],
      pageOverflowX: root.scrollWidth > innerWidth,
      pageOverflowY: root.scrollHeight > innerHeight,
      rightSeatVisible: rightBox ? rightBox.right > 0 && rightBox.left < innerWidth && rightBox.bottom > 0 && rightBox.top < innerHeight : false,
      resolutionText: resolution?.textContent.trim() ?? null,
      visibleTrickCards: document.querySelectorAll('.game-v2-trick-card').length,
      lastCardVisible: Boolean(lastCard),
      controls,
    }
  })()`)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const outputPath = join(OUTPUT_DIR, `${name}-${width}x${height}.png`)
  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'))
  return { outputPath, ...diagnostics }
}

const sockets = []
const participants = []
const latestStates = new Map()
let chrome
const profile = resolve(join(tmpdir(), `bhabhi-thulla-ui-qa-${Date.now()}`))

try {
  await mkdir(OUTPUT_DIR, { recursive: true })
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
  function waitForState(socket, predicate) {
    const current = latestStates.get(socket)
    if (current && predicate(current)) return Promise.resolve(current)
    return new Promise((resolveState) => {
      const onState = (state) => {
        if (!predicate(state)) return
        socket.off('room:state', onState)
        resolveState(state)
      }
      socket.on('room:state', onState)
    })
  }
  const playingState = waitForState(host, (state) => state.status === 'playing')
  await emitAck(host, 'game:start', {})
  let room = await playingState
  if (SCENARIO === 'resolved') {
    while (!room.game.resolvedTrick) {
      const turnId = room.game.currentTurnId
      const turnParticipant = participants.find(({ credentials }) => credentials.playerId === turnId)
      if (!turnParticipant) throw new Error('Could not identify the next player in the opening trick.')
      const turnState = await waitForState(turnParticipant.socket, (state) => state.game?.currentTurnId === turnId)
      const cardId = turnState.game.legalCardIds[0]
      if (!cardId) throw new Error('The opening player had no legal card.')
      const nextState = waitForState(host, (state) => state.game?.resolvedTrick || state.game?.currentTurnId !== turnId)
      await emitAck(turnParticipant.socket, 'game:play', { cardId })
      room = await nextState
    }
  }
  const activeParticipant = participants.find(({ credentials }) => credentials.playerId === room.game.currentTurnId)
  if (!activeParticipant) throw new Error('Could not identify the opening player.')
  const credentials = activeParticipant.credentials
  activeParticipant.socket.disconnect()

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

  const targetsUrl = `http://127.0.0.1:${DEBUG_PORT}/json/list`
  const targets = await waitForJson(targetsUrl)
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome did not expose a page target.')
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: CLIENT_URL })
  await waitForExpression(cdp, `location.origin === ${JSON.stringify(CLIENT_URL)}`)
  const storedCredentials = JSON.stringify(credentials)
  await evaluate(cdp, `localStorage.setItem(${JSON.stringify(`thulla:seat:${credentials.code}`)}, ${JSON.stringify(storedCredentials)})`)
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}/?room=${credentials.code}` })
  try {
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-shell'))`)
  } catch (error) {
    const pageState = await evaluate(cdp, `({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 500) ?? '' })`)
    throw new Error(`${error.message} Page state: ${JSON.stringify(pageState)}`)
  }
  if (SCENARIO === 'active') {
    await evaluate(cdp, `document.querySelector('.game-card--selectable:not(:disabled)')?.click()`)
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-card.is-selected'))`)
  } else {
    await waitForExpression(cdp, `Boolean(document.querySelector('.game-v2-resolution') && document.querySelector('.game-v2-trick-card.is-last-played'))`)
  }

  const results = []
  results.push(await capture(cdp, `${SCENARIO}-desktop`, 1440, 900))
  results.push(await capture(cdp, `${SCENARIO}-mobile`, 375, 812))
  results.push(await capture(cdp, `${SCENARIO}-landscape`, 844, 390))
  const consoleErrors = await evaluate(cdp, `document.querySelector('.entry-banner')?.textContent ?? null`)
  await cdp.send('Browser.close').catch(() => undefined)
  cdp.close()

  const report = { scenario: SCENARIO, room: credentials.code, playerId: credentials.playerId, consoleErrors, results }
  const reportPath = join(OUTPUT_DIR, `${SCENARIO}-visual-qa-report.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const socket of sockets) socket.disconnect()
  if (chrome && !chrome.killed) {
    chrome.kill()
    await Promise.race([
      new Promise((resolveExit) => chrome.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
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
        else await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
    }
  }
}
