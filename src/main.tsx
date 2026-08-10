import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { translate, type Language, type TranslationKey } from './i18n'
import './styles.css'

declare const __APP_VERSION__: string
declare const __BUILD_COMMIT__: string

const noticeRegion = document.getElementById('platform-notices')
let updateReloadRequested = false
let updateNoticeTimer: number | null = null
let updateActivationTimer: number | null = null
const UPDATE_SNOOZE_KEY = 'thulla:update-snoozed-until'
const UPDATE_SNOOZE_MS = 30 * 60 * 1_000
const UPDATE_ACTIVATION_TIMEOUT_MS = 12_000

// Each notice owns its announcement so multiple simultaneous notices do not
// cause the entire platform region (including action labels) to be repeated.
noticeRegion?.removeAttribute('aria-live')
noticeRegion?.removeAttribute('aria-atomic')

function platformText(key: TranslationKey): string {
  const saved = localStorage.getItem('thulla:language')
  const language: Language = saved === 'roman' || saved === 'ur' ? saved : 'en'
  return translate(language, key)
}

function setOfflineNotice(offline: boolean) {
  if (!noticeRegion) return
  const existing = document.getElementById('offline-notice')
  if (!offline) {
    existing?.remove()
    return
  }
  if (existing) return

  const notice = document.createElement('div')
  notice.id = 'offline-notice'
  notice.className = 'platform-notice platform-notice--offline'
  notice.setAttribute('role', 'status')
  notice.setAttribute('aria-live', 'polite')
  notice.setAttribute('aria-atomic', 'true')
  notice.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M3 3l18 18M8.5 8.6A7 7 0 0 1 19 11m-4.3 4.1A4 4 0 0 0 8.8 14M5 11a10 10 0 0 1 1.5-2.4M12 19h.01" />
    </svg>
    <span><strong>${platformText('offlineTitle')}</strong> ${platformText('offlineBody')}</span>
  `
  noticeRegion.append(notice)
}

function showUpdateNotice(registration: ServiceWorkerRegistration) {
  if (!noticeRegion || document.getElementById('update-notice')) return
  const snoozedUntil = Number(sessionStorage.getItem(UPDATE_SNOOZE_KEY) ?? 0)
  if (Number.isFinite(snoozedUntil) && snoozedUntil > Date.now()) {
    if (updateNoticeTimer !== null) window.clearTimeout(updateNoticeTimer)
    updateNoticeTimer = window.setTimeout(() => {
      updateNoticeTimer = null
      if (registration.waiting) showUpdateNotice(registration)
    }, snoozedUntil - Date.now() + 100)
    return
  }

  const notice = document.createElement('div')
  notice.id = 'update-notice'
  notice.className = 'platform-notice platform-notice--update'
  notice.setAttribute('role', 'region')
  notice.setAttribute('aria-labelledby', 'update-notice-title')
  notice.innerHTML = `
    <div class="platform-notice__copy">
      <strong id="update-notice-title">${platformText('updateTitle')}</strong>
      <span data-update-body>${platformText('updateBody')}</span>
    </div>
    <div class="platform-notice__actions">
      <button type="button" data-update-now>${platformText('updateNow')}</button>
      <button type="button" class="platform-notice__later" data-update-later>${platformText('later')}</button>
    </div>
    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-update-status></span>
  `

  const updateButton = notice.querySelector<HTMLButtonElement>('[data-update-now]')
  const updateBody = notice.querySelector<HTMLElement>('[data-update-body]')
  const updateStatus = notice.querySelector<HTMLElement>('[data-update-status]')
  const announceUpdate = (message: string, assertive = false) => {
    if (!updateStatus) return
    updateStatus.setAttribute('aria-live', assertive ? 'assertive' : 'polite')
    updateStatus.textContent = ''
    window.requestAnimationFrame(() => {
      if (updateStatus.isConnected) updateStatus.textContent = message
    })
  }
  const setUpdateBusy = (busy: boolean) => {
    notice.toggleAttribute('aria-busy', busy)
    notice.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = busy })
    if (updateBody) updateBody.textContent = busy ? platformText('serverUpdating') : platformText('updateBody')
  }
  const resetStalledUpdate = () => {
    if (!notice.isConnected || !updateReloadRequested) return
    updateReloadRequested = false
    setUpdateBusy(false)
    notice.dataset.updateFailed = 'true'
    const retryMessage = `${platformText('updateBody')} ${platformText('retryConnection')}.`
    updateButton?.setAttribute('aria-label', `${platformText('updateNow')}. ${platformText('retryConnection')}`)
    announceUpdate(retryMessage, true)
  }

  updateButton?.addEventListener('click', () => {
    const waitingWorker = registration.waiting
    if (!waitingWorker) {
      void registration.update().catch(() => undefined)
      announceUpdate(`${platformText('updateBody')} ${platformText('retryConnection')}.`, true)
      return
    }
    sessionStorage.removeItem(UPDATE_SNOOZE_KEY)
    updateReloadRequested = true
    delete notice.dataset.updateFailed
    updateButton.removeAttribute('aria-label')
    setUpdateBusy(true)
    announceUpdate(platformText('serverUpdating'))
    if (updateActivationTimer !== null) window.clearTimeout(updateActivationTimer)
    updateActivationTimer = window.setTimeout(() => {
      updateActivationTimer = null
      resetStalledUpdate()
    }, UPDATE_ACTIVATION_TIMEOUT_MS)
    try {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      if (updateActivationTimer !== null) window.clearTimeout(updateActivationTimer)
      updateActivationTimer = null
      resetStalledUpdate()
    }
  })
  notice.querySelector<HTMLButtonElement>('[data-update-later]')?.addEventListener('click', () => {
    sessionStorage.setItem(UPDATE_SNOOZE_KEY, String(Date.now() + UPDATE_SNOOZE_MS))
    notice.remove()
    showUpdateNotice(registration)
  })
  noticeRegion.append(notice)
  announceUpdate(`${platformText('updateTitle')}. ${platformText('updateBody')}`)
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  let reloadForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateReloadRequested || reloadForUpdate) return
    reloadForUpdate = true
    if (updateActivationTimer !== null) window.clearTimeout(updateActivationTimer)
    updateActivationTimer = null
    window.location.reload()
  })

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      if (registration.waiting) showUpdateNotice(registration)
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing
        installingWorker?.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateNotice(registration)
          }
        })
      })

      const checkForUpdate = async () => {
        if (document.visibilityState !== 'visible') return
        await registration.update().catch(() => undefined)
        if (registration.waiting) showUpdateNotice(registration)
      }
      window.setInterval(checkForUpdate, 30 * 60 * 1000)
      document.addEventListener('visibilitychange', checkForUpdate)
    } catch {
      // The online game remains usable when service-worker registration is unavailable.
    }
  }, { once: true })
}

document.documentElement.dataset.appVersion = __APP_VERSION__
document.documentElement.dataset.buildCommit = __BUILD_COMMIT__
setOfflineNotice(!navigator.onLine)
window.addEventListener('offline', () => setOfflineNotice(true))
window.addEventListener('online', () => setOfflineNotice(false))
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
