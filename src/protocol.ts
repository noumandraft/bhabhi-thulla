import type { ReactionEvent, RoomSettings, RoomView, SessionScore } from '../shared/game'

export type ClientRoomSettings = RoomSettings
export type ClientPlayerView = RoomView['players'][number]
export type TableReaction = ReactionEvent
export type ClientSessionScore = SessionScore

type BaseGameView = NonNullable<RoomView['game']>

export interface ClientGameView extends BaseGameView {
  whatHappened?: string | null
}

export interface ClientRoomView extends Omit<RoomView, 'game'> {
  game: ClientGameView | null
}

export const DEFAULT_ROOM_SETTINGS: ClientRoomSettings = {
  turnSeconds: 35,
  reconnectGraceSeconds: 60,
  allowBots: true,
  reactionsEnabled: true,
  tutorialHints: true,
}

export function roomSettings(room: ClientRoomView): ClientRoomSettings {
  return room.settings ?? DEFAULT_ROOM_SETTINGS
}
