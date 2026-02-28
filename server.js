const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const geoip = require('geoip-lite')
const fs = require('fs')
const config = require('./config.json')

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const logStream = fs.createWriteStream('/home/pi/serial.log', { flags: 'a' })

const colors = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m'
}

app.set('trust proxy', true)
app.use(express.static('public'))

// ================= AUDIO EMITTER =================
const audioEmitter = new EventEmitter()
audioEmitter.setMaxListeners(50)

// ================= HTTP STREAM ENDPOINT (pentru iOS) =================
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '').split(',')[0].trim()
  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} HTTP stream connected (${ip})`)

  const onChunk = chunk => {
    try { res.write(chunk) } catch(e) {}
  }

  audioEmitter.on('chunk', onChunk)

  req.on('close', () => {
    audioEmitter.off('chunk', onChunk)
    console.log(`${getTimestamp()} ${colors.yellow}[INFO]${colors.reset} HTTP stream disconnected (${ip})`)
  })
})

// ================= SERIAL PORT =================
const port = new SerialPort({
  path: config.serial.port,
  baudRate: config.serial.baudRate
})

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

// ================= STATE GLOBAL =================
const state = {
  service:      null,
  serviceType:  null,
  tune:         null,
  ensemble:     null,
  ensembleName: null,
  servicesList: [],
  serviceInfo:  {},
  dynamicLabel: null,
  signal:       {},
  slideshow:    null,
  enabled:      false
}

// ================= SLIDESHOW BUFFER =================
let slideshowBuffer  = ''
let collectingBase64 = false

// ================= HELPER: reset la schimbare mux =================
function resetMuxState() {
  state.ensemble     = null
  state.ensembleName = null
  state.servicesList = []
  state.serviceInfo  = {}
  state.serviceType  = null
  state.dynamicLabel = null
  state.slideshow    = null
  slideshowBuffer    = ''
  collectingBase64   = false
  io.emit('muxReset')
}

// ================= HELPER: tip serviciu din lista =================
function getServiceType(id) {
  const svc = state.servicesList.find(s => s.id === String(id))
  return svc ? svc.type : null
}

// ================= TIMESTAMP =================
function getTimestamp() {
  const now = new Date()
  const pad = n => n.toString().padStart(2, '0')
  return `[${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}]`
}

// ================= ENABLE LA PORNIRE =================
port.on('open', () => {
  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} Port Serial ${port.path} opened`)
  port.write('ENABLE=0\n')
  setTimeout(() => {
    port.write('ENABLE=1\n')
    state.enabled = true
    console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} SI4686 DAB Receiver enabled`)
  }, 300)
})

port.on('error', err => {
  console.error(`${getTimestamp()} ${colors.red}[ERROR]${colors.reset} Serial error: ${err.message}`)
})

port.on('close', () => {
  console.warn(`${getTimestamp()} ${colors.yellow}[WARN]${colors.reset} Port Serial ${port.path} closed`)
})

// ================= PARSARE SERIAL =================
parser.on('data', raw => {
  const line = raw.trim()
  if (!line) return

  // logStream.write(line + '\n')

  // -- colectare base64 - PRIMUL BLOC ----------------------
  if (collectingBase64) {
    if (line.startsWith('$') || line.startsWith('*')) {
      collectingBase64 = false
      state.slideshow  = slideshowBuffer
      if (slideshowBuffer) io.emit('image', slideshowBuffer)
      slideshowBuffer  = ''
    } else {
      slideshowBuffer += line
      return
    }
  }

  // -- BASE64= ---------------------------------------------
  if (line.startsWith('BASE64=')) {
    collectingBase64 = true
    slideshowBuffer  = ''
    return
  }

  // -- *SERVICE= -------------------------------------------
  if (line.startsWith('*SERVICE=')) {
    state.service     = line.slice(9).trim()
    state.serviceType = getServiceType(state.service)
    io.emit('service', {
      id:   state.service,
      type: state.serviceType
    })
    return
  }

  // -- *TUNE= ----------------------------------------------
  if (line.startsWith('*TUNE=')) {
    const newTune = line.slice(6).trim()
    if (state.tune !== newTune) {
      state.tune = newTune
      resetMuxState()
    }
    io.emit('tune', state.tune)
    return
  }

  // -- $M= (metadata hint) ---------------------------------
  if (line.startsWith('$M=')) {
    return
  }

  // -- $L= (lista servicii + ensemble) ---------------------
  if (line.startsWith('$L=')) {
    const content = line.slice(3)
    const [headerPart, servicesPartRaw] = content.split(';SERVICES=')
    const headerParts = headerPart.split(',')

    const ensembleField = headerParts.find(x => x.startsWith('ENSEMBLE='))
    if (ensembleField) {
      state.ensemble = ensembleField.slice(9).trim()
    }

    const ensembleIndex = headerParts.indexOf(ensembleField)
    if (ensembleIndex !== -1 && headerParts[ensembleIndex + 1]) {
      state.ensembleName = headerParts[ensembleIndex + 1].trim()
    }

    if (servicesPartRaw) {
      state.servicesList = servicesPartRaw.split(';').map(s => {
        const parts = s.split(',')
        return {
          id:   parts[0]?.trim(),
          type: parts[1]?.trim(),
          name: parts.slice(2).join(',').trim()
        }
      }).filter(s => s.id !== undefined && s.name)
    }

    if (state.service && !state.serviceType) {
      state.serviceType = getServiceType(state.service)
    }

    io.emit('ensembleInfo', {
      ensemble:     state.ensemble,
      ensembleName: state.ensembleName
    })

    const newListJson = JSON.stringify(state.servicesList)
    if (state._cachedServicesList !== newListJson) {
      state._cachedServicesList = newListJson
      io.emit('servicesList', state.servicesList)
    }
    return
  }

  // -- $I= (info serviciu activ) ----------------------------
  if (line.startsWith('$I=')) {
    const obj = {}
    line.slice(3).split(';').forEach(p => {
      const idx = p.indexOf('=')
      if (idx === -1) return
      const k = p.slice(0, idx).trim()
      const v = p.slice(idx + 1).trim()
      if (k) obj[k] = v
    })
    obj.TYPE = state.serviceType
    state.serviceInfo = obj
    io.emit('serviceInfo', obj)
    return
  }

  // -- $D= (dynamic label / radio text) --------------------
  if (line.startsWith('$D=')) {
    let text = line.slice(3)
    if (text.startsWith('RT=')) text = text.slice(3)
    state.dynamicLabel = text.trim()
    io.emit('dynamicLabel', state.dynamicLabel)
    return
  }

  // -- $S= (semnal) ----------------------------------------
  if (line.startsWith('$S=')) {
    const obj = {}
    line.slice(3).split(',').forEach(p => {
      const idx = p.indexOf('=')
      if (idx === -1) return
      const k = p.slice(0, idx).trim()
      const v = p.slice(idx + 1).trim()
      if (k) obj[k] = v
    })
    state.signal = obj
    io.emit('signal', obj)
    return
  }
})

// ================= SOCKET =================
let connectionCount = 0

io.on('connection', socket => {
  connectionCount++
  const rawIp =
    socket.handshake.headers['x-forwarded-for'] ||
    socket.handshake.address
  const ip = rawIp.replace('::ffff:', '').split(',')[0].trim()

  const geo = geoip.lookup(ip)
  let location = 'Unknown'
  if (geo) {
    location = `${geo.city || 'Unknown city'}, ${geo.region || ''}, ${geo.country || ''}`
  }

  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} Web client connected (${ip === '::1' ? 'localhost' : ip}) [${connectionCount}] Location: ${location}`)

  socket.on('disconnect', reason => {
    connectionCount--
    console.log(`${getTimestamp()} ${colors.yellow}[INFO]${colors.reset} Web client disconnected (${ip}) [${connectionCount}] Reason: ${reason}`)
  })

  if (!state.service) {
    setTimeout(() => socket.emit('fullState', state), 2000)
  } else {
    socket.emit('fullState', state)
  }

  socket.on('setService', id => {
    console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} setService: ${id} from (${ip})`)
    port.write(`SERVICE=${id}\n`)
  })

  socket.on('setTune', channel => {
    console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} setTune: ${channel} from (${ip})`)
    const ch = parseInt(channel)
    if (isNaN(ch) || ch < 0 || ch > 37) {
      socket.emit('tuneError', 'Canal invalid (0-37)')
      return
    }
    resetMuxState()
    port.write(`TUNE=${ch}\n`)
    state.tune = String(ch)
    io.emit('tune', state.tune)
  })

  socket.on('toggleEnable', () => {
    state.enabled = !state.enabled
    port.write(`ENABLE=${state.enabled ? 1 : 0}\n`)
    io.emit('enableState', state.enabled)
    console.log('Enable:', state.enabled)
  })
})

// ================= AUDIO STREAM =================
let audioRunning = false

function startAudio() {
  if (audioRunning) {
    console.log(`${getTimestamp()} ${colors.yellow}[WARN]${colors.reset} startAudio apelat dar deja ruleaza, skip`)
    return
  }
  audioRunning = true

  const arecord = spawn('arecord', [
    '-D', config.audio.device,
    '-f', 'S16_LE',
    '-r', String(config.audio.sampleRate),
    '-c', String(config.audio.channels),
    '-t','raw'
  ])

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+nobuffer+flush_packets',
    '-flags', 'low_delay',
    '-rtbufsize', '32',
    '-probesize', '32',
    '-f', 's16le',
    '-ar', String(config.audio.sampleRate),
    '-ac', String(config.audio.channels),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame',
    '-b:a', config.audio.bitrate,
    '-ac', String(config.audio.channels),
    '-reservoir', '0',
    '-f', 'mp3',
    '-write_xing', '0',
    '-id3v2_version', '0',
    '-fflags', '+nobuffer',
    '-flush_packets', '1',
    'pipe:1'
  ])

  arecord.stdout.pipe(ffmpeg.stdin)

  ffmpeg.stdout.on('data', chunk => {
    io.emit('audio', chunk)         // ? Socket.io pentru desktop
    audioEmitter.emit('chunk', chunk) // ? HTTP stream pentru iOS
  })

  ffmpeg.stderr.on('data', d => {
    // console.error('ffmpeg:', d.toString())
  })

  function cleanup(reason) {
    if (!audioRunning) return
    audioRunning = false
    console.log(`${getTimestamp()} ${colors.yellow}[WARN]${colors.reset} Audio oprit (${reason}), repornim in 2s...`)
    try { arecord.kill('SIGKILL') } catch(e) {}
    try { ffmpeg.kill('SIGKILL') } catch(e) {}
    setTimeout(startAudio, 2000)
  }

  arecord.on('close', () => cleanup('arecord closed'))
  ffmpeg.on('close',  () => cleanup('ffmpeg closed'))
  arecord.on('error', (e) => cleanup(`arecord error: ${e.message}`))
  ffmpeg.on('error',  (e) => cleanup(`ffmpeg error: ${e.message}`))
}

startAudio()

// ================= START SERVER =================
server.listen(config.server.port, () => {
  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} Server running on http://localhost:${config.server.port}`)
})