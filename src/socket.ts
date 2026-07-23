import type { Socket } from 'socket.io-client'
import type { Ack } from '../shared/game'

export function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(
      () => resolve({ ok: false, error: 'The server took too long to respond. Try again.' }),
      12_000,
    )
    socket.emit(event, payload, (response: Ack<T>) => {
      window.clearTimeout(timeout)
      resolve(response)
    })
  })
}
