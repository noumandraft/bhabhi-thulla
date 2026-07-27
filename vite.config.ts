import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appVersion = process.env.npm_package_version ?? '1.0.0'
let localCommit = 'local'
try {
  localCommit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // Source archives without Git metadata still get a valid local build marker.
}
const buildCommit = process.env.RENDER_GIT_COMMIT ?? process.env.VITE_APP_COMMIT ?? localCommit

function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    closeBundle() {
      const serviceWorkerPath = resolve(process.cwd(), 'dist/sw.js')
      if (!existsSync(serviceWorkerPath)) return
      const source = readFileSync(serviceWorkerPath, 'utf8')
      const builtHtmlPath = resolve(process.cwd(), 'dist/index.html')
      const builtHtml = existsSync(builtHtmlPath) ? readFileSync(builtHtmlPath, 'utf8') : ''
      const fingerprint = createHash('sha256').update(builtHtml).update(source).digest('hex').slice(0, 10)
      writeFileSync(
        serviceWorkerPath,
        source.replace('__BUILD_VERSION__', `${appVersion}-${buildCommit.slice(0, 12)}-${fingerprint}`),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit.slice(0, 12)),
  },
  server: {
    port: 5173,
  },
})
