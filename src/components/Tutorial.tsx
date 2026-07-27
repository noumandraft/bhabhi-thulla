import { useState } from 'react'
import type { TFunction } from '../i18n'
import { AccessibleDialog } from './AccessibleDialog'

const steps = [
  { title: 'tutorialStepOne', body: 'tutorialStepOneBody' },
  { title: 'tutorialStepTwo', body: 'tutorialStepTwoBody' },
  { title: 'tutorialStepThree', body: 'tutorialStepThreeBody' },
] as const

function SampleCard({ rank, suit, active = false, thulla = false }: { rank: string; suit: string; active?: boolean; thulla?: boolean }) {
  const red = suit === '♥' || suit === '♦'
  return (
    <div className={`tutorial-card ${red ? 'is-red' : ''} ${active ? 'is-active' : ''} ${thulla ? 'is-thulla' : ''}`} aria-label={`${rank}${suit}`}>
      <b>{rank}</b><span aria-hidden="true">{suit}</span>
    </div>
  )
}

export function Tutorial({ t, onClose, onComplete }: { t: TFunction; onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const current = steps[step]

  function finish() {
    onComplete()
    onClose()
  }

  return (
    <AccessibleDialog labelId="tutorial-title" className="tutorial-sheet" onClose={onClose}>
      <div className="tutorial-sheet__top">
        <span className="eyebrow">{t('interactiveTutorial')}</span>
        <button className="text-button tutorial-sheet__skip" type="button" onClick={finish}>{t('tutorialSkip')}</button>
      </div>
      <h2 id="tutorial-title">{t('tutorialTitle')}</h2>
      <div className="tutorial-progress" aria-label={t('tutorialProgress', { step: step + 1, count: steps.length })}>
        {steps.map((_, index) => <i key={index} className={index <= step ? 'is-active' : ''} />)}
      </div>
      <div className="tutorial-table" aria-hidden="true">
        <div className="tutorial-table__lead"><small>{t('leadLabel')}</small><SampleCard rank="9" suit="♠" active={step === 0} /></div>
        <div className="tutorial-table__follow"><SampleCard rank="K" suit="♠" active={step === 2} /><small>{t('powerLabel')}</small></div>
        <div className="tutorial-table__thulla"><SampleCard rank="6" suit="♥" active={step === 1} thulla={step >= 1} /><small>THULLA</small></div>
      </div>
      <div className="tutorial-copy" aria-live="polite">
        <span>{step + 1}</span>
        <div><h3>{t(current.title)}</h3><p>{t(current.body)}</p></div>
      </div>
      <div className="tutorial-actions">
        {step > 0 ? <button className="button button--secondary" type="button" onClick={() => setStep((value) => value - 1)}>{t('back')}</button> : <span />}
        <button className="button button--primary" type="button" onClick={() => step === steps.length - 1 ? finish() : setStep((value) => value + 1)}>
          {step === steps.length - 1 ? t('tutorialDone') : t('tutorialNext')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
