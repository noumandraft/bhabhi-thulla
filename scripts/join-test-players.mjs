import { io } from 'socket.io-client'

const roomCode = process.argv[2]
const serverUrl = process.argv[3] ?? 'http://localhost:3001'
if (!roomCode) throw new Error('Usage: node scripts/join-test-players.mjs ROOM_CODE [SERVER_URL]')

const names = ['Ayesha', 'Bilal']
const sockets = []

for (const name of names) {
  const socket = io(serverUrl, { transports: ['websocket'] })
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.on('connect_error', reject)
    socket.on('connect', () => {
      socket.emit('room:join', { code: roomCode, name }, (response) => {
        if (response.ok) resolve(response)
        else reject(new Error(response.error))
      })
    })
  })
  console.log(`${name} joined ${roomCode}`)
}

console.log('Test players are connected. Press Ctrl+C to stop.')
setInterval(() => undefined, 60_000)

function stop() {
  for (const socket of sockets) socket.disconnect()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
