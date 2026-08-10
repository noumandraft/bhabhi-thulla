import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LandingSeoContent } from '../src/components/LandingSeoContent'

const outputPath = resolve(process.cwd(), 'dist/index.html')
const rootPlaceholder = '<div id="root"></div>'
const html = readFileSync(outputPath, 'utf8')
const placeholderCount = html.split(rootPlaceholder).length - 1

if (placeholderCount !== 1) {
  throw new Error(
    `Expected exactly one empty React root in ${outputPath}; found ${placeholderCount}.`,
  )
}

const content = renderToStaticMarkup(
  <main className="landing-shell">
    <section className="landing-grid" aria-labelledby="static-landing-title">
      <div className="hero-copy">
        <div className="hero-copy__intro">
          <span className="hero-kicker">Private rooms · No signup</span>
          <h1 id="static-landing-title">Play Bhabhi Thulla Online</h1>
          <p>
            Play the Pakistani Getaway card game with friends in a private online room,
            or read the English guide below before your first deal.
          </p>
        </div>
      </div>
      <aside className="join-card" aria-labelledby="static-play-heading">
        <span className="eyebrow">Online Pakistani Getaway</span>
        <h2 id="static-play-heading">JavaScript is needed to play</h2>
        <p>
          Enable JavaScript to create or join a live table. The complete rules and game
          guide remain available below.
        </p>
      </aside>
    </section>
    <LandingSeoContent
      onCreateRoom={() => undefined}
      onPractice={() => undefined}
      onOpenRules={() => undefined}
      onOpenTutorial={() => undefined}
    />
  </main>,
)

if (!content.includes('<h1 id="static-landing-title">Play Bhabhi Thulla Online</h1>')) {
  throw new Error('The prerendered landing page is missing its expected H1.')
}

if (!content.includes('class="landing-seo"')) {
  throw new Error('The prerendered landing page is missing the SEO guide.')
}

writeFileSync(outputPath, html.replace(rootPlaceholder, `<div id="root">${content}</div>`))
