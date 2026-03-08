// ================= WEBSOCKET =================
let socket = null
let wsReconnectTimer = null

function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}/data-ws`
  socket = new WebSocket(wsUrl)
  socket.onopen = () => {
    console.log('WS connected')
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null }
  }
  socket.onmessage = (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch(e) { return }
    try { handleMessage(msg) } catch(e) { console.error("handleMessage error:", e) }
  }
  socket.onclose = () => {
    console.warn('WS closed, reconnecting in 2s...')
    wsReconnectTimer = setTimeout(wsConnect, 2000)
  }
  socket.onerror = () => {
    socket.close()
  }
}

function wsSend(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg))
  }
}

wsConnect()

let activeService = 0

// ===== AUDIO =====
const audio = new Audio()
document.body.appendChild(audio)
let audioWs = null
let liveAudioPlayer = null

function connectAudioWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}/audio-ws`
  try {
    const logger = { Log: (msg) => { console.log('3LAS:', msg) } }
    const settings = new Fallback_Settings()
    settings.InitialBufferLength = 0.1

    liveAudioPlayer = new Fallback(logger, settings)

    const wsClient = new WebSocketClient(
      logger,
      wsUrl,
      (e) => { console.log('ws error', e) },
      () => { liveAudioPlayer.Init(wsClient) },
      (data) => { liveAudioPlayer.FormatReader.PushData(new Uint8Array(data)) },
      () => { if (isPlaying) setTimeout(connectAudioWs, 1000) }
    )

    audioWs = wsClient
  } catch(e) {
    alert('Eroare: ' + e.message)
  }
}

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
    const isAppleiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    if (isAppleiOS && 'audioSession' in navigator) {
      navigator.audioSession.type = "playback"
    }
    connectAudioWs()
  } else {
    pcControls.classList.remove('pc-playing-state')
    const isAppleiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    if (isAppleiOS && 'audioSession' in navigator) {
      navigator.audioSession.type = "none"
    }
    if (audioWs) { audioWs.Socket.close(); audioWs = null }
    liveAudioPlayer = null
  }
}

function updateVolume(val) {
  document.getElementById('pcVolValue').textContent = val
  document.getElementById('pcVolSlider').style.setProperty('--vol', val + '%')
  if (liveAudioPlayer?.Player) {
    liveAudioPlayer.Player.Volume = val / 100
  }
}

updateVolume(50)

let isMuted = false
function toggleMute() {
  isMuted = !isMuted
  if (liveAudioPlayer?.Player) {
    liveAudioPlayer.Player.Volume = isMuted ? 0 : (parseInt(document.getElementById('pcVolValue').textContent) / 100)
  }
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
  wsSend({ type: 'setTune', channel: ch })
}

// ===== RADIO TEXT =====
function setRadioText(text) {
  const el = document.getElementById('pcRtText')
  text = text.replace(/^[\s\-\ufffd]+/, '').trim()

  function makeLine(str, color) {
    const span = document.createElement('span')
    span.className = 'rt-line'
    span.style.color = color || ''
    span.textContent = str
    el.appendChild(span)
    if (span.scrollWidth > el.clientWidth) {
      span.className = 'rt-line scrolling'
      span.textContent = str + '\u00a0\u00a0\u00a0\u00a0\u00a0' + str
    }
  }

  el.innerHTML = ''
  const parts = text.split(' - ')
  if (parts.length >= 2) {
    const artist = parts[0].trim()
    const track = parts.slice(1).join(' - ').trim()
    if (artist && track) {
      makeLine(artist, '#e6edf3')
      makeLine(track, '')
      return
    }
  }
  makeLine(text, '')
}

function setAudioType(type) {
  const el = document.getElementById('pcAudioType')
  if (el) el.textContent = SERVICE_MODES[type] || 'DAB+'
}

function getStationName(id) {
  const opt = document.getElementById('services').querySelector(`option[value="${id}"]`)
  return opt ? opt.text : id
}

// ===== HELPER: marcare item activ in lista =====
function markActiveServiceInList() {
  const currentCh = parseInt(document.getElementById('tuneSelect').value)
  document.querySelectorAll('.svc-scan-item').forEach(el => {
    el.classList.toggle('active', el.dataset.ch == currentCh && el.dataset.svcId == activeService)
  })
}

// ===== MESSAGE HANDLER =====
const servicesDropdown = document.getElementById('services')
const img = document.getElementById('slideshow')

function handleMessage(msg) {
  switch(msg.type) {

    case 'fullState':
      populateTuneDropdown(msg.tune !== null && msg.tune !== undefined ? String(msg.tune) : null)
      if (msg.tune) updateTuneDisplay(msg.tune)
      if (msg.servicesList?.length) populateServices(msg.servicesList, msg.service)
      if (msg.service) {
        servicesDropdown.value = String(msg.service)
        document.getElementById('pcStationTitle').textContent = getStationName(msg.service)
      }
      if (msg.serviceType) setAudioType(msg.serviceType)
      if (msg.ensemble || msg.ensembleName) updateEnsemble(msg.ensemble, msg.ensembleName)
      if (msg.dynamicLabel) setRadioText(msg.dynamicLabel)
      if (msg.signal) updateSignal(msg.signal)
      if (msg.slideshow) img.src = 'data:image/jpeg;base64,' + msg.slideshow
      if (msg.serviceInfo) renderServiceInfo(msg.serviceInfo)
      if (msg.scanResults?.length) {
        scanResults = msg.scanResults
        drawScanChart(scanResults)
        updateScanChannels(scanResults)
        renderServicesScanList(scanResults)
        markActiveServiceInList()
      }
      if (msg.scanning) {
        document.getElementById('scanOverlay').classList.add('active')
      }
      if (msg.scanStatus) {
        document.getElementById('scanStatus').textContent = msg.scanStatus
      }
      if (msg.slideshow) img.src = `data:${msg.slideshowMime};base64,` + msg.slideshow
      break

    case 'servicesList':
      populateServices(msg.data, null)
      break

    case 'service':
      activeService = String(msg.id)
      servicesDropdown.value = String(msg.id)
      setTimeout(() => {
        document.getElementById('pcStationTitle').textContent = getStationName(msg.id)
      }, 500)
      if (msg.serviceType) setAudioType(msg.serviceType)
      markActiveServiceInList()
      break

    case 'tune':
      const sel = document.getElementById('tuneSelect')
      if (sel) sel.value = String(msg.data)
      updateTuneDisplay(msg.data)
      break

    case 'tuneError':
      alert(msg.data)
      break

    case 'ensembleInfo':
      updateEnsemble(msg.ensemble, msg.ensembleName)
      break

    case 'dynamicLabel':
      setRadioText(msg.data)
      break

    case 'signal':
      updateSignal(msg.data)
      const tuneEl = document.getElementById('tuneSelect')
      if (tuneEl && scanResults.length > 0) {
        const ch = parseInt(tuneEl.value)
        if (!isNaN(ch) && scanResults[ch]) {
          scanResults[ch].signal = parseFloat(msg.data.SIGNAL) || 0
          drawScanChart(scanResults)
        }
      }
      break

    case 'scanUpdate':
      if (scanResults[msg.ch]) {
        scanResults[msg.ch].signal = msg.signal
        scanResults[msg.ch].lock   = msg.lock
        drawScanChart(scanResults)
      }
      break

    case 'scanResultsUpdated':
      if (scanRunning) return
      const prevJson = JSON.stringify(scanResults.filter(r => r && r.services?.length > 0).map(r => r.services.map(s => s.id).join(',')))
      scanResults = msg.data
      const newJson = JSON.stringify(scanResults.filter(r => r && r.services?.length > 0).map(r => r.services.map(s => s.id).join(',')))
      drawScanChart(scanResults)
      if (prevJson !== newJson) {
        renderServicesScanList(scanResults)
        markActiveServiceInList()
      } else {
        markActiveServiceInList()
      }
      break

    case 'image':
      img.src = `data:${msg.mime};base64,` + msg.data
      break

    case 'serviceInfo':
      renderServiceInfo(msg.data)
      if (msg.data.TYPE) setAudioType(msg.data.TYPE)
      break

    case 'muxReset':
      document.getElementById('pcStationTitle').textContent = '-'
      document.getElementById('pcEnsembleName').textContent = '-'
      document.getElementById('pcRtText').textContent = 'No data'
      document.getElementById('pcAudioType').textContent = 'DAB+'
      document.getElementById('ensemble').textContent = '-'
      document.getElementById('ensembleId').textContent = '-'
      document.getElementById('headerEnsemble').textContent = '-'
      servicesDropdown.innerHTML = ''
      document.getElementById('serviceInfo').innerHTML = ''
      break

    case 'scanStart':
      scanRunning = true
      scanResults = []
      drawScanChart([])
      document.getElementById('scanBtn').textContent = 'Stop'
      document.getElementById('scanOverlay').classList.add('active')
      const status = document.getElementById('scanStatus')
      status.textContent = 'Scanning...'
      status.className = 'scan-status scanning'
      break

    case 'scanProgress':
      if (!scanResults[msg.ch]) scanResults[msg.ch] = msg.result
      else scanResults[msg.ch] = msg.result
      const compact = []
      for (let i = 0; i < 38; i++) {
        compact[i] = scanResults[i] || { ch: i, name: '', signal: 0, lock: false, services: [] }
      }
      drawScanChart(compact)
      document.getElementById('scanStatus').textContent = `${msg.result.name} \u00b7 ${msg.ch + 1}/38`
      document.getElementById('scanOverlaySub').textContent = `${msg.result.name} \u00b7 ${msg.ch + 1}/38`
      updateScanChannels(compact)
      break

    case 'scanComplete':
      scanRunning = false
      scanResults = msg.data
      drawScanChart(scanResults)
      updateScanChannels(scanResults)
      renderServicesScanList(scanResults)
      markActiveServiceInList()
      document.getElementById('scanBtn').textContent = 'Scan'
      document.getElementById('scanOverlay').classList.remove('active')
      const found = scanResults.filter(r => r && r.services && r.services.length > 0).length
      const st = document.getElementById('scanStatus')
      st.textContent = `Done \u00b7 ${found} found`
      st.className = 'scan-status'
      break

    case 'scanError':
      document.getElementById('scanStatus').textContent = msg.data
      scanRunning = false
      break

    case 'activeService':
      activeService = String(msg.id)
      document.querySelectorAll('.svc-scan-item').forEach(el => {
        el.classList.toggle('active', el.dataset.ch == msg.ch && el.dataset.svcId == msg.id)
      })
      break

    case 'connectionCount':
      const el = document.getElementById('connectionCount')
      if (el) el.textContent = msg.count + (msg.count === 1 ? ' User Online' : ' Users Online')
      break
  }
}

// ===== HELPERS =====
function updateTuneDisplay(tune) {
  const ch = getChannelByIndex(tune)
  document.getElementById('tuneChannel').textContent = ch ? ch.name : `CH ${tune}`
  document.getElementById('tuneFreq').innerHTML = ch ? `${ch.freq}<span>MHz</span>` : `\u2014<span>MHz</span>`
  document.getElementById('headerTune').textContent = ch ? `${ch.name} \u00b7 ${ch.freq} MHz` : `CH ${tune}`
}

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
  wsSend({ type: 'setService', id: servicesDropdown.value })
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
    wsSend({ type: 'stopScan' })
    scanRunning = false
    document.getElementById('scanBtn').textContent = 'Scan'
    document.getElementById('scanStatus').textContent = 'Stopped'
    document.getElementById('scanStatus').className = 'scan-status'
  } else {
    scanResults = []
    const sc = document.getElementById('scanChannels')
    if (sc) sc.innerHTML = ''
    drawScanChart([])
    wsSend({ type: 'startScan' })
  }
}

function drawScanChart(results) {
  const W = scanCanvas.width
  const H = scanCanvas.height
  scanCtx.clearRect(0, 0, W, H)

  if (!results || results.length === 0) return

  const barW = Math.floor(W / 38) - 1.47
  const maxSig = 80

  for (let i = 0; i < 38; i++) {
    const r = results[i]
    if (!r) continue
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
    if (r.name) scanCtx.fillText(r.name, x + barW / 2, y - 2)
  }
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
  const xCSS = e.clientX - rect.left
  const W = scanCanvas.width
  const barW = Math.floor(W / 38) - 1.40
  const ch = Math.floor(xCSS * (W / rect.width) / (barW + 2))
  if (ch >= 0 && ch < 38) wsSend({ type: 'setTune', channel: String(ch) })
})

// ===== SERVICES SCAN LIST =====
function renderServicesScanList(results) {
  const container = document.getElementById('servicesScanList')
  if (!container) return
  container.innerHTML = ''
  const withServices = results.filter(r => r && r.services && r.services.length > 0)
  if (withServices.length === 0) {
    container.innerHTML = '<div style="font-size:10px; color:var(--text-dim); text-align:center; padding:20px 0;">No services found</div>'
    return
  }
  withServices.forEach(r => {
    const block = document.createElement('div')
    block.className = 'svc-scan-channel'
    const isOpen = localStorage.getItem(`scan-ch-${r.ch}`) !== 'closed'
    const header = document.createElement('div')
    header.className = 'svc-scan-channel-header'
    header.innerHTML = `
      <div>
        <div class="svc-scan-channel-name">${r.name}</div>
      </div>
      <span class="svc-scan-channel-toggle ${isOpen ? 'open' : ''}">&#9658;</span>
    `
    const servicesList = document.createElement('div')
    servicesList.className = 'svc-scan-services' + (isOpen ? ' open' : '')
    r.services.forEach(svc => {
      const item = document.createElement('div')
      item.className = 'svc-scan-item'
      item.textContent = svc.name
      item.title = svc.name
      item.dataset.ch = r.ch
      item.dataset.svcId = svc.id
      item.onclick = () => tuneToService(r.ch, svc.id)
      servicesList.appendChild(item)
    })
    header.onclick = () => {
      const toggle = header.querySelector('.svc-scan-channel-toggle')
      toggle.classList.toggle('open')
      servicesList.classList.toggle('open')
      localStorage.setItem(`scan-ch-${r.ch}`, servicesList.classList.contains('open') ? 'open' : 'closed')
    }
    block.appendChild(header)
    block.appendChild(servicesList)
    container.appendChild(block)
  })
}

function tuneToService(ch, serviceId) {
  const currentCh = parseInt(document.getElementById('tuneSelect').value)
  if (currentCh === ch) {
    wsSend({ type: 'setService', id: serviceId })
  } else {
    wsSend({ type: 'setTune', channel: String(ch) })
    setTimeout(() => wsSend({ type: 'setService', id: serviceId }), 3000)
  }
  document.querySelectorAll('.svc-scan-item').forEach(el => {
    el.classList.toggle('active', el.dataset.ch == ch && el.dataset.svcId == serviceId)
  })
}

function expandSlideshow() {
  const src = document.getElementById('slideshow').src
  if (!src || src.endsWith('default.jpg')) return
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer;'
  const img = document.createElement('img')
  img.src = src
  img.style.cssText = 'height: 240px;border-radius:8px;box-shadow:0 0 40px rgba(0,210,255,0.3);'
  overlay.appendChild(img)
  overlay.onclick = () => document.body.removeChild(overlay)
  document.body.appendChild(overlay)
}


window.addEventListener('pagehide', () => {
  if (audioWs) audioWs.Socket.close()
  if (socket) socket.close()
})

// init
populateTuneDropdown(null)
