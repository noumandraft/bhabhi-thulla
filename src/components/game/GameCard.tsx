import { suitSymbol, type Card, type Suit } from '../../../shared/game'
import type { TFunction } from '../../i18n'

export function localizedSuit(t: TFunction, suit: Suit): string {
  if (suit === 'spades') return t('suitSpades')
  if (suit === 'hearts') return t('suitHearts')
  if (suit === 'diamonds') return t('suitDiamonds')
  return t('suitClubs')
}

function CardFace({ card }: { card: Card }) {
  return <>
    <span className="game-card__corner"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
    <span className="game-card__suit" aria-hidden="true">{suitSymbol[card.suit]}</span>
    <span className="game-card__corner game-card__corner--bottom" aria-hidden="true"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
  </>
}

export function GameCard({ card, t, interactive = false, selectable = false, selected = false, disabled = false, unavailable = false, onClick, small = false }: {
  card: Card
  t: TFunction
  interactive?: boolean
  selectable?: boolean
  selected?: boolean
  disabled?: boolean
  unavailable?: boolean
  onClick?: () => void
  small?: boolean
}) {
  const className = `game-card ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'game-card--red' : ''} ${selectable ? 'game-card--selectable' : ''} ${unavailable ? 'is-unavailable' : ''} ${selected ? 'is-selected' : ''} ${small ? 'game-card--small' : ''}`
  const cardName = t('cardName', { rank: card.rank, suit: localizedSuit(t, card.suit) })
  const label = selected ? t('selectedCardLabel', { card: cardName }) : cardName
  if (!interactive) return <div className={className} role="img" aria-label={label}><CardFace card={card}/></div>
  return <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={label} aria-pressed={selectable ? selected : undefined}><CardFace card={card}/></button>
}
