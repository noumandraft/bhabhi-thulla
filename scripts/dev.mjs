import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const processes = ['dev:client', 'dev:server'].map((script) =>
  spawn(npmCommand, ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' }),
)

function stop() {
  for (const child of processes) child.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of processes) child.on('exit', (code) => {
  if (code && code !== 0) {
    stop()
    process.exitCode = code
  }
})
