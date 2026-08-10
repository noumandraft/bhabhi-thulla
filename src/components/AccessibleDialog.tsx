import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function canReceiveRestoredFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return false
  if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) return false
  return true
}

function restoreDialogFocus(previousFocus: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    const fallback = document.querySelector<HTMLElement>(
      '#round-result-title, #game-v2-hand, #game-v2-waiting-player, main button:not(:disabled), main [href], main [tabindex]:not([tabindex="-1"])',
    )
    const target = canReceiveRestoredFocus(previousFocus)
      ? previousFocus
      : canReceiveRestoredFocus(fallback)
        ? fallback
        : null
    target?.focus({ preventScroll: true })
  })
}

export function AccessibleDialog({
  labelId,
  className,
  onClose,
  children,
}: {
  labelId: string
  className: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? dialogRef.current)?.focus()
    return () => {
      document.body.style.overflow = overflow
      restoreDialogFocus(previousFocus)
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>
  )
}
