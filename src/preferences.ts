import { useEffect, useState } from 'react'

export interface Preferences {
  sound: boolean
  haptics: boolean
  reactionsMuted: boolean
  chatNotificationsMuted: boolean
  tutorialComplete: boolean
  scrollHintSeen: boolean
}

const STORAGE_KEY = 'thulla:preferences:v1'

const defaults: Preferences = {
  sound: true,
  haptics: true,
  reactionsMuted: false,
  chatNotificationsMuted: false,
  tutorialComplete: false,
  scrollHintSeen: false,
}

function readPreferences(): Preferences {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  return { preferences, updatePreference }
}
