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

// ================= HTTP STREAM ENDPOINT (for iOS) =================
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
  enabled:      false,
  scanResults: new Array(38).fill(null),
  scanning:     false,
  scanStatus: null
}

// ================= SLIDESHOW BUFFER =================
let slideshowChunks = []
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
  slideshowChunks = []
  collectingBase64   = false
  state._cachedServicesList = null
  io.emit('muxReset')

  if (!scanning) {
    state.slideshow = null
    io.emit('image', fs.readFileSync('./public/images/default.jpg').toString('base64'))
  }
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

// ================= HELPER: scanResults compact 38 elemente =================
function getScanResultsCompact() {
  const result = []
  for (let i = 0; i < 38; i++) {
    result.push(state.scanResults[i] || null)
  }
  return result
}

// ================= ENABLE LA PORNIRE =================
port.on('open', () => {
  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} Port Serial ${port.path} opened`)
  port.write('ENABLE=0\n')
  setTimeout(() => {
    port.write('ENABLE=1\n')
    state.enabled = true
    console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} SI4686 DAB Receiver enabled`)
    if (config.scan?.autoScanOnStart) {
      setTimeout(() => startScan({ emit: () => {} }), 3000)
    }
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

  if (collectingBase64) {
    if (line.startsWith('$') || line.startsWith('*')) {
      collectingBase64 = false
      const buf = slideshowChunks.join('')
      slideshowChunks = []
      setImmediate(() => {
        state.slideshow = buf
        if (buf) io.emit('image', buf)
      })
    } else {
      slideshowChunks.push(line)
      return
    }
  }

  if (line.startsWith('BASE64=')) {
    collectingBase64 = true
    slideshowChunks = []
    return
  }

  if (line.startsWith('*SERVICE=')) {
    state.service     = line.slice(9).trim()
    state.serviceType = getServiceType(state.service)
    state.slideshow   = null
    io.emit('service', { id: state.service, type: state.serviceType })
    if (!scanning) {
      state.slideshow = null
      io.emit('image', fs.readFileSync('./public/images/default.jpg').toString('base64'))
    }
    return
  }

  if (line.startsWith('*TUNE=')) {
    const newTune = line.slice(6).trim()
    if (state.tune !== newTune) {
      state.tune = newTune
      resetMuxState()
    }
    io.emit('tune', state.tune)
    return
  }

  if (line.startsWith('$M=')) return


if (line.startsWith('$L=')) {
  const content = line.slice(3)
  const [headerPart, servicesPartRaw] = content.split(';SERVICES=')
  const headerParts = headerPart.split(',')
  const ensembleField = headerParts.find(x => x.startsWith('ENSEMBLE='))
  if (ensembleField) state.ensemble = ensembleField.slice(9).trim()
  const ensembleIndex = headerParts.indexOf(ensembleField)
  if (ensembleIndex !== -1 && headerParts[ensembleIndex + 1]) {
    state.ensembleName = headerParts[ensembleIndex + 1].trim()
  }
  if (servicesPartRaw) {
    state.servicesList = servicesPartRaw.split(';').map(s => {
      const parts = s.split(',')
      return { id: parts[0]?.trim(), type: parts[1]?.trim(), name: parts.slice(2).join(',').trim() }
    }).filter(s => s.id !== undefined && s.name)
  }
  if (state.service && !state.serviceType) {
    state.serviceType = getServiceType(state.service)
  }
  io.emit('ensembleInfo', { ensemble: state.ensemble, ensembleName: state.ensembleName })
  const newListJson = JSON.stringify(state.servicesList)
    state._cachedServicesList = newListJson
    io.emit('servicesList', state.servicesList)

  if (!scanning && state.tune !== null) {
    const ch = parseInt(state.tune)
    if (!isNaN(ch)) {
      if (state.scanResults[ch] && state.ensemble &&
          state.scanResults[ch].ensembleId &&
          state.scanResults[ch].ensembleId !== state.ensemble) {
          state.scanResults[ch] = null
      }
      if (!state.scanResults[ch]) {
        state.scanResults[ch] = {
          ch,
          name:       DAB_CHANNELS_SCAN[ch].name,
          freq:       DAB_CHANNELS_SCAN[ch].freq,
          signal:     parseFloat(state.signal?.SIGNAL) || 0,
          lock:       true,
          ensemble:   state.ensembleName,
          ensembleId: state.ensemble,
          services:   []
        }
      }
      const newServices = state.servicesList
       .filter(s => AUDIO_MODES_SERVER.includes(s.type))
       .map(s => ({ id: s.id, name: s.name, type: s.type }))
       if (newServices.length > 0) {
          if (newServices.length >= (state.scanResults[ch].services?.length || 0)) {
          state.scanResults[ch].ensemble   = state.ensembleName
          state.scanResults[ch].ensembleId = state.ensemble
          state.scanResults[ch].lock       = true
          state.scanResults[ch].services   = newServices
          io.emit('scanResultsUpdated', getScanResultsCompact())
        }
      }
    }
  }
 return
}

  if (line.startsWith('$I=')) {
    const obj = {}
    line.slice(3).split(';').forEach(p => {
      const idx = p.indexOf('=')
      if (idx === -1) return
      obj[p.slice(0, idx).trim()] = p.slice(idx + 1).trim()
    })
    obj.TYPE = state.serviceType
    state.serviceInfo = obj
    io.emit('serviceInfo', obj)
    return
  }

  if (line.startsWith('$D=')) {
    let text = line.slice(3)
    if (text.startsWith('RT=')) text = text.slice(3)
    state.dynamicLabel = text.trim()
    io.emit('dynamicLabel', state.dynamicLabel)
    return
  }

  if (line.startsWith('$S=')) {
    const obj = {}
    line.slice(3).split(',').forEach(p => {
      const idx = p.indexOf('=')
      if (idx === -1) return
      obj[p.slice(0, idx).trim()] = p.slice(idx + 1).trim()
    })
    state.signal = obj
    io.emit('signal', obj)

    if (state.tune !== null) {
      const ch = parseInt(state.tune)
      if (!isNaN(ch) && state.scanResults[ch]) {
        state.scanResults[ch].signal = parseFloat(obj.SIGNAL) || 0
        state.scanResults[ch].lock   = obj.LOCK === '1'
        io.emit('scanUpdate', { ch, signal: state.scanResults[ch].signal, lock: obj.LOCK === '1' })
      }
    }
    return
  }
})

// ================= SOCKET =================
let connectionCount = 0

io.on('connection', socket => {
  connectionCount++
  const rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address
  const ip = rawIp.replace('::ffff:', '').split(',')[0].trim()

  const geo = geoip.lookup(ip)
  let location = 'Unknown'
  if (geo) location = `${geo.city || 'Unknown city'}, ${geo.region || ''}, ${geo.country || ''}`

  console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} Web client connected (${ip === '::1' ? 'localhost' : ip}) [${connectionCount}] Location: ${location}`)

  socket.on('disconnect', reason => {
    connectionCount--
    console.log(`${getTimestamp()} ${colors.yellow}[INFO]${colors.reset} Web client disconnected (${ip}) [${connectionCount}] Reason: ${reason}`)
  })

  const defaultImg = fs.readFileSync('./public/images/default.jpg').toString('base64')
  const stateWithImg = {
    ...state,
    slideshow:   state.slideshow || defaultImg,
    scanResults: getScanResultsCompact()
  }

  if (!state.service) {
    setTimeout(() => socket.emit('fullState', stateWithImg), 2000)
  } else {
    socket.emit('fullState', stateWithImg)
  }

  socket.on('setService', id => {
    console.log(`${getTimestamp()} ${colors.green}[INFO]${colors.reset} setService: ${id} from (${ip})`)
    port.write(`SERVICE=${id}\n`)
    const ch = parseInt(state.tune)
    io.emit('activeService', { ch, id: String(id) })
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

  socket.on('startScan', () => startScan(socket))
  socket.on('stopScan',  () => { scanning = false })
})

// ================= SCANNER =================
const DAB_CHANNELS_SCAN = [
  { ch:0,  name:'5A',  freq:174.928 }, { ch:1,  name:'5B',  freq:176.640 },
  { ch:2,  name:'5C',  freq:178.352 }, { ch:3,  name:'5D',  freq:180.064 },
  { ch:4,  name:'6A',  freq:181.936 }, { ch:5,  name:'6B',  freq:183.648 },
  { ch:6,  name:'6C',  freq:185.360 }, { ch:7,  name:'6D',  freq:187.072 },
  { ch:8,  name:'7A',  freq:188.928 }, { ch:9,  name:'7B',  freq:190.640 },
  { ch:10, name:'7C',  freq:192.352 }, { ch:11, name:'7D',  freq:194.064 },
  { ch:12, name:'8A',  freq:195.936 }, { ch:13, name:'8B',  freq:197.648 },
  { ch:14, name:'8C',  freq:199.360 }, { ch:15, name:'8D',  freq:201.072 },
  { ch:16, name:'9A',  freq:202.928 }, { ch:17, name:'9B',  freq:204.640 },
  { ch:18, name:'9C',  freq:206.352 }, { ch:19, name:'9D',  freq:208.064 },
  { ch:20, name:'10A', freq:209.936 }, { ch:21, name:'10B', freq:211.648 },
  { ch:22, name:'10C', freq:213.360 }, { ch:23, name:'10D', freq:215.072 },
  { ch:24, name:'11A', freq:216.928 }, { ch:25, name:'11B', freq:218.640 },
  { ch:26, name:'11C', freq:220.352 }, { ch:27, name:'11D', freq:222.064 },
  { ch:28, name:'12A', freq:223.936 }, { ch:29, name:'12B', freq:225.648 },
  { ch:30, name:'12C', freq:227.360 }, { ch:31, name:'12D', freq:229.072 },
  { ch:32, name:'13A', freq:230.784 }, { ch:33, name:'13B', freq:232.496 },
  { ch:34, name:'13C', freq:234.208 }, { ch:35, name:'13D', freq:235.776 },
  { ch:36, name:'13E', freq:237.488 }, { ch:37, name:'13F', freq:239.200 }
]
const AUDIO_MODES_SERVER = ['4', '5']

let scanning = false

async function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForLock(maxMs) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (state.signal?.LOCK === '1') return true
    await sleepMs(100)
  }
  return false
}

async function startScan(socket) {
  state.scanning = true
  state.signal = {}
  try {
    const defaultImg = fs.readFileSync('./public/images/default.jpg')
    io.emit('image', defaultImg.toString('base64'))
  } catch(e) {
    console.log('Error loading default image:', e.message)
  }

  if (scanning) {
    socket.emit('scanError', 'Scan already in progress')
    return
  }
  scanning = true
  const originalTune = state.tune
  const results = []

  io.emit('scanStart')

  for (let ch = 0; ch <= 37; ch++) {
    if (!scanning) break

    port.write(`TUNE=${ch}\n`)
    state.signal = {}
    const locked = await waitForLock(ch === 0 ? 2000 : 1200)
    if (locked) await sleepMs(1500)

    const sig  = parseFloat(state.signal?.SIGNAL) || 0
    const lock = state.signal?.LOCK === '1'

    const result = {
      ch,
      name:     DAB_CHANNELS_SCAN[ch].name,
      freq:     DAB_CHANNELS_SCAN[ch].freq,
      signal:   sig,
      lock,
      ensemble: lock ? (state.ensembleName || null) : null,
      services: lock ? state.servicesList
        .filter(s => AUDIO_MODES_SERVER.includes(s.type))
        .map(s => ({ id: s.id, name: s.name, type: s.type })) : []
    }
    results.push(result)
    io.emit('scanProgress', { ch, total: 37, result })
  }

  if (originalTune !== null) {
    port.write(`TUNE=${originalTune}\n`)
    state.tune = String(originalTune)
    io.emit('tune', state.tune)
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (!state.scanResults[i]) {
      state.scanResults[i] = r
    } else {
      state.scanResults[i].signal = r.signal
      if (r.services.length > 0) {
        state.scanResults[i].services = r.services
        state.scanResults[i].lock     = true
        state.scanResults[i].ensemble = r.ensemble
      }
    }
  }
  scanning = false
  state.scanning = false
  const compact = getScanResultsCompact()
  const found = compact.filter(r => r && r.services && r.services.length > 0).length
  state.scanStatus = `Done · ${found} found`
  io.emit('scanComplete', compact)
}

// ================= AUDIO STREAM =================
let audioRunning = false
function startAudio() {
  if (audioRunning) {
    return
  }
  audioRunning = true

  const arecord = spawn('arecord', [
    '-D', config.audio.device,
    '-f', 'S16_LE',
    '-r', String(config.audio.sampleRate),
    '-c', String(config.audio.channels),
    '-t', 'raw'
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
    io.emit('audio', chunk)
    audioEmitter.emit('chunk', chunk)
  })

  ffmpeg.stderr.on('data', d => {})

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

