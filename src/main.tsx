import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

declare const __APP_VERSION__: string
declare const __BUILD_COMMIT__: string

const noticeRegion = document.getElementById('platform-notices')
let updateReloadRequested = false

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
  notice.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M3 3l18 18M8.5 8.6A7 7 0 0 1 19 11m-4.3 4.1A4 4 0 0 0 8.8 14M5 11a10 10 0 0 1 1.5-2.4M12 19h.01" />
    </svg>
    <span><strong>You’re offline.</strong> Your table will reconnect when your internet returns.</span>
  `
  noticeRegion.append(notice)
}

function showUpdateNotice(registration: ServiceWorkerRegistration) {
  if (!noticeRegion || document.getElementById('update-notice')) return

  const notice = document.createElement('div')
  notice.id = 'update-notice'
  notice.className = 'platform-notice platform-notice--update'
  notice.setAttribute('role', 'status')
  notice.innerHTML = `
    <div class="platform-notice__copy">
      <strong>A game update is ready</strong>
      <span>Update when it is safe to reconnect to your seat.</span>
    </div>
    <div class="platform-notice__actions">
      <button type="button" data-update-now>Update &amp; reconnect</button>
      <button type="button" class="platform-notice__later" data-update-later>Later</button>
    </div>
  `

  notice.querySelector<HTMLButtonElement>('[data-update-now]')?.addEventListener('click', () => {
    const waitingWorker = registration.waiting
    if (!waitingWorker) return
    updateReloadRequested = true
    notice.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  })
  notice.querySelector<HTMLButtonElement>('[data-update-later]')?.addEventListener('click', () => notice.remove())
  noticeRegion.append(notice)
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  let reloadForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateReloadRequested || reloadForUpdate) return
    reloadForUpdate = true
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

      const checkForUpdate = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => undefined)
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
