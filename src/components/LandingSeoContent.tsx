import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

const Bot = (props: IconProps) => <Icon {...props}><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></Icon>
const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const ChevronRight = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>
const Languages = (props: IconProps) => <Icon {...props}><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></Icon>
const Lock = (props: IconProps) => <Icon {...props}><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Icon>
const MonitorSmartphone = (props: IconProps) => <Icon {...props}><path d="M18 8V6a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8"/><path d="M7 22h4M9 18v4"/><rect width="6" height="10" x="17" y="12" rx="2"/></Icon>
const MessageCircle = (props: IconProps) => <Icon {...props}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const Users = (props: IconProps) => <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></Icon>

export interface LandingSeoContentProps {
  onCreateRoom: () => void
  onPractice: () => void
  onOpenRules: () => void
  onOpenTutorial?: () => void
}

const FEATURES = [
  { icon: Lock, title: 'Private tables', body: 'Create a five-letter room code and share it only with the people you want at your table.' },
  { icon: Users, title: 'Live multiplayer', body: 'Play with three to eight people, and let another friend wait safely for the next round.' },
  { icon: MonitorSmartphone, title: 'Made for every screen', body: 'Use the same table on a phone, tablet or computer without installing an app.' },
  { icon: Bot, title: 'Practice with bots', body: 'Learn the flow at your own pace before you invite family or friends.' },
  { icon: Languages, title: 'Three language choices', body: 'Use the interface in English, Roman Urdu or Urdu while playing the same rules.' },
  { icon: MessageCircle, title: 'Table Talk', body: 'Keep the friendly card-table atmosphere with private table chat and quick reactions.' },
] as const

const FAQS = [
  {
    question: 'What is Bhabhi Thulla called in English?',
    answer: 'It is commonly called Getaway or Get Away in English. The names describe the same broad card-game family, although families and regions may use different house rules.',
  },
  {
    question: 'Is Bhabhi Thulla the same as Getaway?',
    answer: 'Yes. Bhabhi Thulla is a South Asian name for the game widely described in English as Getaway. This website specifically follows a Pakistani version, including anticlockwise turns and the right-hand power option.',
  },
  {
    question: 'How many people can play?',
    answer: 'A table supports three to eight active players. If you are short of players, you can add bots or start a separate practice table.',
  },
  {
    question: 'What happens when someone gives a THULLA?',
    answer: 'A THULLA happens when a player cannot follow the led suit and plays a different suit. The player holding the highest card of the led suit takes the entire trick and receives the power to lead next.',
  },
  {
    question: 'Which direction does this version move?',
    answer: 'Turns move anticlockwise. After a player acts, the next turn goes to the next active person sitting on that player\'s right.',
  },
  {
    question: 'Can I play online with friends?',
    answer: 'Yes. Create a private room, then send its room code or invitation link to your friends. There is no public matchmaking or public chat.',
  },
  {
    question: 'Can another friend join after a game has started?',
    answer: 'Yes. A new friend can enter the existing room while a round is in progress. They wait without seeing private hands, then take a seat when the next round is dealt.',
  },
  {
    question: 'Can I learn by playing against bots?',
    answer: 'Yes. Practice mode creates a table with computer players. The interactive tutorial and in-game explanations can also show why a trick was cleared or picked up.',
  },
  {
    question: 'Is the game free, and do I need an account?',
    answer: 'The game is free to play and does not require an account. You choose a display name for the table, while your private room code controls who can join.',
  },
  {
    question: 'What happens if a player disconnects?',
    answer: 'Their seat is held briefly so they can reconnect. The table shows their connection state, and the host can use the available table controls if the player does not return.',
  },
] as const

export function LandingSeoContent({ onCreateRoom, onPractice, onOpenRules, onOpenTutorial }: LandingSeoContentProps) {
  return <article className="landing-seo" aria-label="About Bhabhi Thulla and how to play" lang="en-PK" dir="ltr">
    <section className="landing-seo__section landing-seo__intro" aria-labelledby="about-thulla-heading">
      <div className="landing-seo__narrow">
        <span className="eyebrow">Pakistan's card-table classic</span>
        <h2 id="about-thulla-heading">What is Bhabhi Thulla?</h2>
        <p>Bhabhi Thulla is a lively Pakistani shedding and trick-taking card game in which every player tries to get away by emptying their hand. It is especially popular around family tables and among groups of friends in Pakistan and Punjab. In English, the game is commonly known as <strong>Getaway</strong> or the <strong>Get Away card game</strong>.</p>
        <p>The goal sounds simple, but every card can change who has the power. You must follow the suit that was led whenever you can. If you cannot, your off-suit card becomes a THULLA and the strongest card of the led suit picks up the pile. Empty your hand at the right moment and you get away; remain as the final active player holding cards and you become the Bhabhi.</p>
        <p>This online table follows the Pakistani anticlockwise variant: play moves to the person on the right, and the player with power can use the special right-hand option before leading. Because house rules vary, the exact rules used here are explained below and are enforced consistently for everyone in the room.</p>
        <button className="text-button landing-seo__jump" type="button" onClick={onOpenRules}><BookOpen size={18}/><span>See the rules in the game</span></button>
      </div>
    </section>

    <section className="landing-seo__section landing-seo__features" aria-labelledby="play-anywhere-heading">
      <div className="landing-seo__header">
        <span className="eyebrow">Your table, wherever you are</span>
        <h2 id="play-anywhere-heading">Play Thulla with friends anywhere</h2>
        <p>Bring the familiar Pakistani card-table experience online without creating an account or asking everyone to install another app.</p>
      </div>
      <ul className="landing-seo__feature-grid">
        {FEATURES.map(({ icon: FeatureIcon, title, body }) => <li key={title}>
          <span className="landing-seo__feature-icon" aria-hidden="true"><FeatureIcon size={22}/></span>
          <div><h3>{title}</h3><p>{body}</p></div>
        </li>)}
      </ul>
    </section>

    <section className="landing-seo__section landing-seo__online" aria-labelledby="play-online-heading">
      <div className="landing-seo__header">
        <span className="eyebrow">From room code to first card</span>
        <h2 id="play-online-heading">How to play Bhabhi Thulla online</h2>
      </div>
      <ol className="landing-seo__steps">
        <li><span aria-hidden="true">1</span><div><h3>Create a private room</h3><p>Enter the name your friends know you by and create a table. No email address, password or registration is required.</p></div></li>
        <li><span aria-hidden="true">2</span><div><h3>Invite your friends</h3><p>Copy the room code or invitation link and send it privately. Friends can join from any modern phone, tablet or computer.</p></div></li>
        <li><span aria-hidden="true">3</span><div><h3>Prepare the table</h3><p>Add bots if you need them, review the Pakistani rules, and let each player mark themselves ready. A late friend can wait for the following round.</p></div></li>
        <li><span aria-hidden="true">4</span><div><h3>Get away before everyone else</h3><p>The Ace of Spades starts the round. Follow suit, watch who has power, and empty your hand without owing the next lead.</p></div></li>
      </ol>
      <button className="button button--primary landing-seo__section-cta" type="button" onClick={onCreateRoom}><Play size={19}/> Create a Bhabhi Thulla room <ChevronRight size={19}/></button>
    </section>

    <section className="landing-seo__section landing-seo__rules" id="bhabhi-thulla-rules" aria-labelledby="rules-heading">
      <div className="landing-seo__header">
        <span className="eyebrow">The variant used at this table</span>
        <h2 id="rules-heading">Bhabhi Thulla card game rules</h2>
        <p>Families often have their own traditions. These are the Pakistani rules implemented by this game, so everyone knows how the online table will decide each trick.</p>
      </div>
      <div className="landing-seo__rule-grid">
        <section aria-labelledby="cards-heading"><span className="landing-seo__rule-number" aria-hidden="true">01</span><h3 id="cards-heading">Players and cards</h3><p>Three to eight people play with a standard 52-card deck and no jokers. Cards rank from high to low: Ace, King, Queen, Jack, 10, then 9 down to 2. The deck is dealt among all active players, so some hands may begin with one extra card.</p></section>
        <section aria-labelledby="opening-heading"><span className="landing-seo__rule-number" aria-hidden="true">02</span><h3 id="opening-heading">The Ace of Spades opens</h3><p>The player holding the Ace of Spades must play it first. Every active player contributes one card to this opening trick. After everyone has played, those cards move to the waste pile even if a player could not follow Spades. The highest Spade receives the power to lead the first regular trick.</p></section>
        <section aria-labelledby="direction-heading"><span className="landing-seo__rule-number" aria-hidden="true">03</span><h3 id="direction-heading">Play moves to the right</h3><p>Turns proceed anticlockwise to the next active player sitting on the right. A led card establishes the suit for that trick. If you hold at least one card of that suit, you must play one of them. Within the led suit, the highest card played is currently in power.</p></section>
        <section aria-labelledby="thulla-heading"><span className="landing-seo__rule-number" aria-hidden="true">04</span><h3 id="thulla-heading">Giving a THULLA</h3><p>If you do not have the led suit, you may play any card from another suit. That card is the THULLA and immediately completes the trick. The player who played the highest card of the original led suit picks up every card in the trick. The THULLA itself cannot win because it belongs to a different suit.</p></section>
        <section aria-labelledby="power-heading"><span className="landing-seo__rule-number" aria-hidden="true">05</span><h3 id="power-heading">Power and the right-hand option</h3><p>The player with the highest led-suit card has the power and normally leads next. Before that new lead, they may instead take the entire hand of the next active player on their right. The right-hand player gets away safely, while the player who took the cards still makes the next lead. This option can be used once before that lead and is not available during the opening trick.</p></section>
        <section aria-labelledby="escape-heading"><span className="landing-seo__rule-number" aria-hidden="true">06</span><h3 id="escape-heading">Getting away</h3><p>A clean trick contains no THULLA and goes to waste; its highest led-suit card keeps the power. Emptying your hand lets you get away only when you do not owe the next lead. If your final card wins a clean trick, you draw from the earlier waste and continue with power. The last active player left with cards loses the round and becomes the Bhabhi.</p></section>
      </div>
      <div className="landing-seo__rule-actions">
        <button className="button button--secondary" type="button" onClick={onPractice}><Bot size={19}/> Practice these rules with bots</button>
        {onOpenTutorial ? <button className="text-button" type="button" onClick={onOpenTutorial}><BookOpen size={18}/> Open the interactive tutorial</button> : null}
      </div>
    </section>

    <section className="landing-seo__section landing-seo__english-name" aria-labelledby="english-name-heading">
      <div className="landing-seo__english-icon" aria-hidden="true"><Languages size={28}/></div>
      <div>
        <span className="eyebrow">One game, several familiar names</span>
        <h2 id="english-name-heading">What is Bhabhi Thulla called in English?</h2>
        <p>Bhabhi Thulla is commonly called <strong>Getaway</strong> or <strong>Get Away</strong> in English. &quot;Bhabhi&quot; is the title given to the last player left holding cards, while &quot;Thulla&quot; is the familiar name for the off-suit card that interrupts a trick. You may also hear people shorten the game's name to Bhabhi or Thulla. The name changes, but the aim remains the same: escape the round before you are the final player with cards.</p>
      </div>
    </section>

    <section className="landing-seo__section landing-seo__faq" aria-labelledby="faq-heading">
      <div className="landing-seo__header">
        <span className="eyebrow">Helpful answers before you deal</span>
        <h2 id="faq-heading">Bhabhi Thulla questions</h2>
      </div>
      <div className="landing-seo__faq-list">
        {FAQS.map(({ question, answer }) => <details key={question}>
          <summary>{question}<ChevronRight size={19}/></summary>
          <p>{answer}</p>
        </details>)}
      </div>
    </section>

    <section className="landing-seo__section landing-seo__final-cta" aria-labelledby="ready-heading">
      <div>
        <span className="eyebrow">The table is ready</span>
        <h2 id="ready-heading">Ready to play Bhabhi Thulla?</h2>
        <p>Create a private room, invite your friends and see who gets away before becoming the Bhabhi.</p>
      </div>
      <div className="landing-seo__final-actions">
        <button className="button button--primary" type="button" onClick={onCreateRoom}><Play size={19}/> Create private room <ChevronRight size={19}/></button>
        <button className="button button--secondary" type="button" onClick={onPractice}><Bot size={19}/> Practice with bots</button>
      </div>
      <p className="landing-seo__privacy"><Lock size={16}/> Free to play. No signup or public chat.</p>
    </section>
  </article>
}
