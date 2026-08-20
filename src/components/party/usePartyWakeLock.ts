import { useEffect, useState } from 'react'

export interface PartyWakeLockState {
  supported: boolean
  active: boolean
}

/** Keeps a visible shared board awake when the browser supports Screen Wake Lock. */
export function usePartyWakeLock(enabled: boolean): PartyWakeLockState {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!enabled || !supported) {
      setActive(false)
      return
    }

    let disposed = false
    let sentinel: WakeLockSentinel | null = null

    async function acquire() {
      if (disposed || document.visibilityState !== 'visible' || sentinel && !sentinel.released) return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (disposed) {
          await next.release().catch(() => undefined)
          return
        }
        sentinel = next
        setActive(true)
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null
          if (!disposed) setActive(false)
        }, { once: true })
      } catch {
        if (!disposed) setActive(false)
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void acquire()
      else setActive(false)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void acquire()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const current = sentinel
      sentinel = null
      setActive(false)
      if (current && !current.released) void current.release().catch(() => undefined)
    }
  }, [enabled, supported])

  return { supported, active }
}
