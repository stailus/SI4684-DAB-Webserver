const socket = io()
let activeService = 0

// ===== AUDIO =====
const audio = new Audio()
document.body.appendChild(audio)

let sourceBuffer = null
let mediaSourceObj = null
const queue = []
let isUpdating = false
let mediaSourceReady = false

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

if (!isIOS && typeof MediaSource !== 'undefined') {
  mediaSourceObj = new MediaSource()
  audio.src = URL.createObjectURL(mediaSourceObj)

  mediaSourceObj.addEventListener('sourceopen', () => {
    sourceBuffer = mediaSourceObj.addSourceBuffer('audio/mpeg')
    sourceBuffer.addEventListener('updateend', () => {
      isUpdating = false
      processQueue()
    })
    mediaSourceReady = true
    processQueue()
  })
} else {
  audio.src = '/stream'
}

function processQueue() {
  if (!mediaSourceReady || isUpdating || queue.length === 0 || !sourceBuffer) return
  if (mediaSourceObj.readyState !== 'open') return
  isUpdating = true
  try {
    sourceBuffer.appendBuffer(queue.shift())
  } catch(e) {
    console.log('appendBuffer error:', e)
    isUpdating = false
  }
}

socket.on('audio', (chunk) => {
  if (!mediaSourceReady) return
  if (!isPlaying) {
    queue.length = 0
    return
  }
  const uint8 = new Uint8Array(chunk)
  queue.push(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength))
  processQueue()
})

// ===== SIGNAL GRAPH =====
const canvas = document.getElementById('signalCanvas')
const ctx = canvas.getContext('2d')
const signalHistory = []
const MAX_POINTS = 200

function resizeCanvas() {
  canvas.width = canvas.offsetWidth
  canvas.height = 70
}
resizeCanvas()
window.addEventListener('resize', resizeCanvas)

function drawGraph() {
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  if (signalHistory.length < 2) return

  const min = 0, max = 80
  const pts = signalHistory.slice(-MAX_POINTS)

  ctx.beginPath()
  ctx.moveTo(0, H)
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1)) * W
    const y = H - ((v - min) / (max - min)) * H
    i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.lineTo(W, H)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, 'rgba(0,210,255,0.25)')
  grad.addColorStop(1, 'rgba(0,210,255,0)')
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  pts.forEach((v, i) => {
    const x = (i / (pts.length - 1)) * W
    const y = H - ((v - min) / (max - min)) * H
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = '#00d2ff'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

setInterval(drawGraph, 200)

// ===== PLAYER UI =====
let isPlaying = false
const pcControls = document.getElementById('pcControls')

function togglePlay() {
  isPlaying = !isPlaying
  if (isPlaying) {
    pcControls.classList.add('pc-playing-state')
    // goleste buffer-ul acumulat
    queue.length = 0
    if (sourceBuffer && !sourceBuffer.updating && mediaSourceObj.readyState === 'open') {
      try {
        sourceBuffer.abort()
        sourceBuffer.remove(0, Infinity)
      } catch(e) {}
    }
    audio.play()
  } else {
    pcControls.classList.remove('pc-playing-state')
    audio.pause()
  }
}

function updateVolume(val) {
  document.getElementById('pcVolValue').textContent = val
  document.getElementById('pcVolSlider').style.setProperty('--vol', val + '%')
  audio.volume = val / 100
}
updateVolume(50)

let isMuted = false
function toggleMute() {
  isMuted = !isMuted
  audio.muted = isMuted
  document.getElementById('pcVolIcon').style.color = isMuted ? '#e53935' : ''
}

// ===== TUNE =====
function populateTuneDropdown(currentTune) {
  const sel = document.getElementById('tuneSelect')
  sel.innerHTML = ''
  DAB_CHANNELS.forEach(c => {
    const opt = document.createElement('option')
    opt.value = String(c.ch)
    opt.text = `${c.name} \u2014 ${c.freq} MHz`
    sel.appendChild(opt)
  })
  if (currentTune !== null && currentTune !== undefined) {
    sel.value = String(currentTune)
  }
}

function changeTune() {
  const ch = document.getElementById('tuneSelect').value
  if (!ch) return
  socket.emit('setTune', ch)
}

socket.on('tune', tune => {
  const sel = document.getElementById('tuneSelect')
  if (sel) sel.value = String(tune)
  updateTuneDisplay(tune)
})

socket.on('tuneError', msg => alert(msg))

function updateTuneDisplay(tune) {
  const ch = getChannelByIndex(tune)
  document.getElementById('tuneChannel').textContent = ch ? ch.name : `CH ${tune}`
  document.getElementById('tuneFreq').innerHTML = ch ? `${ch.freq}<span>MHz</span>` : `—<span>MHz</span>`
  document.getElementById('headerTune').textContent = ch ? `${ch.name} \u00b7 ${ch.freq} MHz` : `CH ${tune}`
}

// ===== RADIO TEXT =====
function setRadioText(text) {
  const el = document.getElementById('pcRtText')
  text = text.replace(/^[\s\-–—]+/, '').trim()
  const parts = text.split(' - ')
  if (parts.length >= 2) {
    const artist = parts[0].trim()
    const track = parts.slice(1).join(' - ').trim()
    if (artist && track) {
      el.innerHTML = `<span style="display:block; color:#e6edf3;">${artist}</span><span style="display:block;">${track}</span>`
      return
    }
  }
  el.textContent = text
}

function setAudioType(type) {
  const el = document.getElementById('pcAudioType')
  if (el) el.textContent = SERVICE_MODES[type] || 'DAB+'
}

function getStationName(id) {
  const opt = document.getElementById('services').querySelector(`option[value="${id}"]`)
  return opt ? opt.text : id
}

// ===== SOCKET EVENTS =====
const servicesDropdown = document.getElementById('services')
const img = document.getElementById('slideshow')

socket.on('fullState', state => {
  populateTuneDropdown(state.tune !== null && state.tune !== undefined ? String(state.tune) : null)
  if (state.tune) updateTuneDisplay(state.tune)
  if (state.servicesList?.length) populateServices(state.servicesList, state.service)
  if (state.service) {
    servicesDropdown.value = String(state.service)
    document.getElementById('pcStationTitle').textContent = getStationName(state.service)
  }
  if (state.serviceType) setAudioType(state.serviceType)
  if (state.ensemble || state.ensembleName) updateEnsemble(state.ensemble, state.ensembleName)
  if (state.dynamicLabel) setRadioText(state.dynamicLabel)
  if (state.signal) updateSignal(state.signal)
  if (state.slideshow) img.src = 'data:image/jpeg;base64,' + state.slideshow
  if (state.serviceInfo) renderServiceInfo(state.serviceInfo)
  if (state.scanResults?.length) {
    scanResults = state.scanResults
    drawScanChart(scanResults)
    updateScanChannels(scanResults)
  }
  if (state.scanning) {
    document.getElementById('scanOverlay').classList.add('active')
  }
})

socket.on('servicesList', list => populateServices(list, null))

socket.on('service', data => {
  const id   = data.id   !== undefined ? data.id   : data
  const type = data.type !== undefined ? data.type : null
  activeService = String(id)
  servicesDropdown.value = String(id)
  document.getElementById('pcStationTitle').textContent = getStationName(id)
  if (type) setAudioType(type)
})

socket.on('ensembleInfo', data => updateEnsemble(data.ensemble, data.ensembleName))
socket.on('dynamicLabel', text => setRadioText(text))
socket.on('signal', updateSignal)

socket.on('image', base64 => {
  img.src = 'data:image/jpeg;base64,' + base64
})

socket.on('serviceInfo', info => {
  renderServiceInfo(info)
  if (info.TYPE) setAudioType(info.TYPE)
})

socket.on('muxReset', () => {
  document.getElementById('pcStationTitle').textContent = '-'
  document.getElementById('pcEnsembleName').textContent = '-'
  document.getElementById('pcRtText').textContent = 'No data'
  document.getElementById('pcAudioType').textContent = 'DAB+'
  document.getElementById('ensemble').textContent = '-'
  document.getElementById('ensembleId').textContent = '-'
  document.getElementById('headerEnsemble').textContent = '-'
  servicesDropdown.innerHTML = ''
  document.getElementById('serviceInfo').innerHTML = ''
})

// ===== HELPERS =====
function updateEnsemble(ensemble, ensembleName) {
  document.getElementById('ensemble').textContent = ensembleName || '-'
  document.getElementById('ensembleId').textContent = ensemble || '-'
  document.getElementById('headerEnsemble').textContent = ensembleName || '-'
  document.getElementById('pcEnsembleName').textContent = (ensembleName || '\u2014') + ' \u00b7 ' + (ensemble || '\u2014')
}

function populateServices(list, currentService) {
  const audioOnly = list.filter(s => AUDIO_MODES.includes(s.type))
  const newIds = audioOnly.map(s => String(s.id)).join(',')
  const oldIds = Array.from(servicesDropdown.options).map(o => o.value).join(',')

  if (newIds !== oldIds) {
    servicesDropdown.innerHTML = ''
    audioOnly.forEach(s => {
      const opt = document.createElement('option')
      opt.value = String(s.id)
      opt.text = s.name
      servicesDropdown.appendChild(opt)
    })
  }

  const toSelect = (currentService !== null && currentService !== undefined)
    ? String(currentService)
    : String(activeService)
  servicesDropdown.value = toSelect
  activeService = toSelect
}

function changeService() {
  activeService = servicesDropdown.value
  socket.emit('setService', servicesDropdown.value)
}

function updateSignal(data) {
  const sig = parseFloat(data.SIGNAL)
  if (!isNaN(sig)) {
    signalHistory.push(sig)
    if (signalHistory.length > MAX_POINTS * 2) signalHistory.splice(0, MAX_POINTS)
    document.getElementById('signalBig').innerHTML = sig.toFixed(1) + '<span>dBuV</span>'
  }

  setBar('cnr', normalize(data.CNR,  0, 100))
  setBar('fic', normalize(data.FIC,  0, 100))

  const cnr = parseFloat(data.CNR)
  const fic = parseFloat(data.FIC)
  if (!isNaN(cnr)) document.getElementById('cnrVal').textContent = cnr.toFixed(1)
  if (!isNaN(fic)) document.getElementById('ficVal').textContent = fic.toFixed(0) + '%'

  const lockEl    = document.getElementById('lock')
  const lockLabel = document.getElementById('lockLabel')
  const isLocked  = data.LOCK === '1' || data.LOCK === 1
  if (lockEl)    lockEl.classList.toggle('locked', isLocked)
  if (lockLabel) lockLabel.textContent = isLocked ? 'Locked' : 'No Lock'
}

function setBar(id, value) {
  const el = document.getElementById(id)
  if (el) el.style.width = value + '%'
}

function normalize(val, min, max) {
  val = parseFloat(val)
  if (isNaN(val)) return 0
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))
}

function renderServiceInfo(info) {
  const container = document.getElementById('serviceInfo')
  container.innerHTML = ''

  Object.entries(info).forEach(([key, value]) => {
    if (key === "ID" || key === "TYPE") return

    let displayValue = value
    let extraClass = "svc-info-value"

    if (key === "AUDIO") {
      displayValue = AUDIO_MAP[value] || value
      const badgeClass = AUDIO_CLASS[value]
      if (badgeClass) {
        container.innerHTML += `
          <div class="svc-info-row">
            <div class="svc-info-label">${SERVICE_INFO_LABELS[key] || key}</div>
            <span class="${badgeClass}">${displayValue}</span>
          </div>`
        return
      }
    } else if (key === "PTY") {
      displayValue = getPtyLabel(value)
      const pc = getPtyClass(value)
      container.innerHTML += `
        <div class="svc-info-row">
          <div class="svc-info-label">${SERVICE_INFO_LABELS[key] || key}</div>
          <span class="${pc}">${displayValue}</span>
        </div>`
      return
    } else if (key === "PROTECTION") {
      displayValue = PROTECTION_MAP[value] || value
    } else if (key === "BITRATE") {
      displayValue = value + " kbps"
    } else if (key === "SAMPLERATE") {
      displayValue = value + " Hz"
    }

    container.innerHTML += `
      <div class="svc-info-row">
        <div class="svc-info-label">${SERVICE_INFO_LABELS[key] || key}</div>
        <div class="${extraClass}">${displayValue}</div>
      </div>`
  })
}

// ===== SCANNER =====
let scanResults = []
let scanRunning = false
const scanCanvas = document.getElementById('scanCanvas')
const scanCtx = scanCanvas.getContext('2d')

function resizeScanCanvas() {
  scanCanvas.width = scanCanvas.offsetWidth
  scanCanvas.height = 80
  if (scanResults.length > 0) drawScanChart(scanResults)
}

resizeScanCanvas()
window.addEventListener('resize', resizeScanCanvas)

function toggleScan() {
  if (scanRunning) {
    socket.emit('stopScan')
    scanRunning = false
    document.getElementById('scanBtn').textContent = 'Scan'
    document.getElementById('scanStatus').textContent = 'Stopped'
    document.getElementById('scanStatus').className = 'scan-status'
  } else {
    scanResults = []
    const sc = document.getElementById('scanChannels')
    if (sc) sc.innerHTML = ''
    drawScanChart([])
    socket.emit('startScan')
  }
}

socket.on('scanStart', () => {
  scanRunning = true
  document.getElementById('scanBtn').textContent = 'Stop'
  const status = document.getElementById('scanStatus')
  document.getElementById('scanOverlay').classList.add('active')
  status.textContent = 'Scanning...'
  status.className = 'scan-status scanning'
})

socket.on('scanProgress', data => {
  scanResults[data.ch] = data.result
  drawScanChart(scanResults)
  document.getElementById('scanStatus').textContent = `${data.result.name} \u00b7 ${data.ch + 1}/38`
  document.getElementById('scanOverlaySub').textContent = `${data.result.name} \u00b7 ${data.ch + 1}/38`
  updateScanChannels(scanResults)
})

socket.on('scanComplete', results => {
  scanRunning = false
  scanResults = results
  drawScanChart(results)
  updateScanChannels(results)
  document.getElementById('scanBtn').textContent = 'Scan'
  document.getElementById('scanOverlay').classList.remove('active')
  const found = results.filter(r => r.lock).length
  const status = document.getElementById('scanStatus')
  status.textContent = `Done \u00b7 ${found} found`
  status.className = 'scan-status'
})

socket.on('scanError', msg => {
  document.getElementById('scanStatus').textContent = msg
  scanRunning = false
})

function drawScanChart(results) {
  const W = scanCanvas.width
  const H = scanCanvas.height
  scanCtx.clearRect(0, 0, W, H)

  if (!results || results.length === 0) return

const total = 38
  const barW = Math.max(2, Math.floor((W - total * 2) / total))
  const maxSig = 80

  results.forEach((r, i) => {
    if (!r) return
    const x = i * (barW + 2) + 1
    const sig = Math.max(0, r.signal || 0)
    const h = Math.max(2, (sig / maxSig) * (H - 16))
    const y = H - h

    let color
    if (!r.lock || sig < 3)  color = '#1a3a4a'
    else if (sig < 10)        color = '#00d2ff'
    else if (sig < 20)        color = '#00e676'
    else                      color = '#ffeb3b'

    const grad = scanCtx.createLinearGradient(0, y, 0, H)
    grad.addColorStop(0, color)
    grad.addColorStop(1, color + '44')
    scanCtx.fillStyle = grad
    scanCtx.fillRect(x, y, barW, h)
    scanCtx.fillStyle = (r.lock && sig > 3) ? color : '#ffffff'
    scanCtx.font = '12px Share Tech Mono'
    scanCtx.textAlign = 'center'
    scanCtx.fillText(r.name, x + barW / 2, y - 2)
  })
  scanCtx.strokeStyle = 'rgba(0,210,255,0.1)'
  scanCtx.lineWidth = 1
  scanCtx.beginPath()
  scanCtx.moveTo(0, H - 1)
  scanCtx.lineTo(W, H - 1)
  scanCtx.stroke()
}

function updateScanChannels(results) {
}

scanCanvas.addEventListener('click', e => {
  if (scanResults.length === 0) return
  const rect = scanCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const ch = Math.floor((x / scanCanvas.offsetWidth) * 38)
  if (ch >= 0 && ch < 38) socket.emit('setTune', String(ch))
})

// init
populateTuneDropdown(null)
