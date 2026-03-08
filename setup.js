const express = require('express')
const { SerialPort } = require('serialport')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

const crypto = require('crypto')

const CONFIG_PATH = path.join(__dirname, 'config.json')

// ===== AUTH =====
const activeSessions = new Map()
const SESSION_TTL = 4 * 60 * 60 * 1000 // 4 ore

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function isValidSession(req) {
  const cookie = req.headers.cookie || ''
  const match = cookie.match(/setup_session=([a-f0-9]+)/)
  if (!match) return false
  const token = match[1]
  const ts = activeSessions.get(token)
  if (!ts) return false
  if (Date.now() - ts > SESSION_TTL) { activeSessions.delete(token); return false }
  activeSessions.set(token, Date.now())
  return true
}

function requireAuth(req, res, next) {
  const cfg = readConfig()
  if (!cfg.auth?.password) return res.redirect('/setup/first-run')
  if (!isValidSession(req)) return res.redirect('/setup/login')
  next()
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch(e) {
    return {}
  }
}

function saveConfig(newConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2))
}

async function getSerialPorts() {
  try {
    const ports = await SerialPort.list()
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      pnpId: p.pnpId || '',
      vendorId: p.vendorId || '',
      productId: p.productId || ''
    }))
  } catch(e) {
    return []
  }
}
	function getAudioDevices() {
	  return new Promise((resolve) => {
		if (process.platform === 'win32') {
		  // Windows - ffmpeg dshow enumeration
		  const { spawn } = require('child_process')
		  const ffmpeg = spawn('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { windowsHide: true })
		  let output = ''
		  ffmpeg.stderr.on('data', d => output += d.toString())
        	ffmpeg.on('close', () => {
			const devices = []
			const lines = output.split('\n')
			for (const line of lines) {
			const match = line.match(/"([^"]+)"\s+\(audio\)/)
		if (match) {
		  devices.push({ id: match[1], name: match[1] })
		}
	  }
	  resolve(devices)
	})
    } else {
      // Linux - arecord
    exec('arecord -l 2>/dev/null', (err, stdout) => {
	  if (err) return resolve([])
	  const devices = []
	  const lines = stdout.split('\n')
	  for (const line of lines) {
		const match = line.match(/^card \d+:\s+(\S+)\s+\[([^\]]+)\].*device (\d+):[^\[]+\[([^\]]+)\]/)
		if (match) {
		  const cardId = match[1]      // ex: sndrpihifiberry
		  const cardName = match[2]    // ex: sndrpihifiberry
		  const deviceNum = match[3]
		  const deviceName = match[4]
		  devices.push({
			id: `plughw:${cardId}`,
			idPlug: `plughw:${cardId}`,
			name: `${cardName} - ${deviceName} (plughw:${cardId})`
		  })
		}
	  }
	  resolve(devices)
	})
    }
  })
}

const setupHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAB Webserver — Setup</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;600;800&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #080e14;
      --surface: #0d1821;
      --surface2: #111c27;
      --border: #1a2d42;
      --accent: #00d2ff;
      --accent2: #0077aa;
      --text: #c8dce8;
      --muted: #4a6478;
      --success: #00e676;
      --error: #ff5252;
      --warn: #ffab40;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'JetBrains Mono', monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: 
        radial-gradient(ellipse 600px 400px at 20% 10%, rgba(0,120,180,0.07) 0%, transparent 70%),
        radial-gradient(ellipse 400px 300px at 80% 80%, rgba(0,210,255,0.05) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    .wrap {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 720px;
    }

    header {
      margin-bottom: 40px;
      border-left: 3px solid var(--accent);
      padding-left: 16px;
    }

    header h1 {
      font-family: 'Syne', sans-serif;
      font-size: 28px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
    }

    header h1 span { color: var(--accent); }

    header p {
      color: var(--muted);
      font-size: 12px;
      margin-top: 6px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 20px;
    }

    .card-title {
      font-family: 'Syne', sans-serif;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--accent);
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    label {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    select, input {
      width: 100%;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      padding: 10px 14px;
      outline: none;
      transition: border-color 0.2s;
      margin-bottom: 16px;
      appearance: none;
      -webkit-appearance: none;
    }

    select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%234a6478' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 36px;
    }

    select:focus, input:focus {
      border-color: var(--accent2);
    }

    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .btn {
      background: var(--accent);
      color: #080e14;
      border: none;
      border-radius: 6px;
      padding: 12px 28px;
      font-family: 'Syne', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      width: 100%;
      margin-top: 8px;
    }

    .btn:hover { opacity: 0.85; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      margin-top: 0;
      width: auto;
      padding: 8px 16px;
      font-size: 11px;
    }

    .current-config {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 16px;
    }

    .current-config span { color: var(--accent); }

    .toast {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 20px;
      font-size: 13px;
      display: none;
      align-items: center;
      gap: 10px;
      z-index: 100;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    .toast.show { display: flex; }
    .toast.success { border-color: var(--success); color: var(--success); }
    .toast.error { border-color: var(--error); color: var(--error); }

    .refresh-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }

    .badge {
      display: inline-block;
      background: rgba(0,210,255,0.1);
      border: 1px solid rgba(0,210,255,0.2);
      color: var(--accent);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10px;
      letter-spacing: 1px;
    }

    .current-val {
      font-size: 11px;
      color: var(--muted);
      margin-top: -12px;
      margin-bottom: 16px;
    }

    .current-val span { color: var(--warn); }
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Si4684 <span>Setup</span></h1>
    <p>Configure serial port and audio device — saved to config.json</p>
  </header>

  <div class="card">
    <div class="card-title">Current Config</div>
    <div class="current-config" id="currentConfig">Loading...</div>
  </div>

  <div class="card">
    <div class="card-title">Serial Port</div>
    <div class="refresh-btn">
      <button class="btn btn-secondary" onclick="loadPorts()">↻ Refresh</button>
      <span id="portsStatus" style="font-size:11px; color:var(--muted); margin-left:8px;"></span>
    </div>
    <label>Select Port</label>
    <select id="serialPort"></select>
    <div class="current-val">Current: <span id="currentPort">-</span></div>

  </div>

  <div class="card">
    <div class="card-title">Audio Device</div>
    <div class="refresh-btn">
      <button class="btn btn-secondary" onclick="loadAudio()">↻ Refresh</button>
      <span id="audioStatus" style="font-size:11px; color:var(--muted); margin-left:8px;"></span>
    </div>
    <label>Select Device</label>
    <select id="audioDevice"></select>
    <div class="current-val">Current: <span id="currentAudio">-</span></div>
    <div class="row2">
      <div>
        <label>Sample Rate</label>
        <input type="number" id="sampleRate" value="48000">
      </div>
      <div>
        <label>Channels</label>
        <input type="number" id="channels" value="2" min="1" max="2">
      </div>
    </div>
    <label>Bitrate</label>
    <input type="text" id="bitrate" value="128k">
  </div>

  <div class="card">
    <div class="card-title">Server</div>
    <label>HTTP Port</label>
    <input type="number" id="serverPort" value="3000">
  </div>

  <button class="btn" onclick="saveConfig()">Save Config</button>
</div>

<div class="toast" id="toast"></div>

<script>
let currentConfig = {}

async function init() {
  await loadCurrentConfig()
  await loadPorts()
  await loadAudio()
}

async function loadCurrentConfig() {
  const res = await fetch('/setup/config')
  currentConfig = await res.json()
  
  document.getElementById('currentConfig').innerHTML = 
    \`Serial: <span>\${currentConfig.serial?.port || '-'}</span> @ <span>\${currentConfig.serial?.baudRate || '-'}</span> baud &nbsp;|&nbsp; 
     Audio: <span>\${currentConfig.audio?.device || '-'}</span>\`

  document.getElementById('currentPort').textContent = currentConfig.serial?.port || '-'
  document.getElementById('currentAudio').textContent = currentConfig.audio?.device || '-'
  document.getElementById('sampleRate').value = currentConfig.audio?.sampleRate || 48000
  document.getElementById('channels').value = currentConfig.audio?.channels || 2
  document.getElementById('bitrate').value = currentConfig.audio?.bitrate || '128k'
  document.getElementById('serverPort').value = currentConfig.server?.port || 3000
}

async function loadPorts() {
  document.getElementById('portsStatus').textContent = 'Detecting...'
  const res = await fetch('/setup/ports')
  const ports = await res.json()
  const sel = document.getElementById('serialPort')
  sel.innerHTML = ''
  
  if (ports.length === 0) {
    sel.innerHTML = '<option value="">No ports found</option>'
    document.getElementById('portsStatus').textContent = 'No ports detected'
    return
  }

  ports.forEach(p => {
    const opt = document.createElement('option')
    opt.value = p.path
    opt.textContent = p.manufacturer ? \`\${p.path} — \${p.manufacturer}\` : p.path
    if (p.path === currentConfig.serial?.port) opt.selected = true
    sel.appendChild(opt)
  })
  document.getElementById('portsStatus').textContent = \`\${ports.length} port(s) found\`
}

async function loadAudio() {
  document.getElementById('audioStatus').textContent = 'Detecting...'
  const res = await fetch('/setup/audio')
  const devices = await res.json()
  const sel = document.getElementById('audioDevice')
  sel.innerHTML = ''

  if (devices.length === 0) {
    sel.innerHTML = '<option value="">No devices found</option>'
    document.getElementById('audioStatus').textContent = 'No devices detected'
    return
  }

  devices.forEach(d => {
    const opt = document.createElement('option')
    opt.value = d.id
    opt.textContent = d.name
    if (d.id === currentConfig.audio?.device || d.idPlug === currentConfig.audio?.device) opt.selected = true
    sel.appendChild(opt)
  })
  document.getElementById('audioStatus').textContent = \`\${devices.length} device(s) found\`
}

async function saveConfig() {
  const config = {
    serial: {
      port: document.getElementById('serialPort').value,
      baudRate: currentConfig.serial?.baudRate || 1000000
    },
    audio: {
      device: document.getElementById('audioDevice').value,
      sampleRate: parseInt(document.getElementById('sampleRate').value),
      channels: parseInt(document.getElementById('channels').value),
      bitrate: document.getElementById('bitrate').value
    },
    server: {
      port: parseInt(document.getElementById('serverPort').value)
    },
    scan: currentConfig.scan || { autoScanOnStart: false }
  }

  const res = await fetch('/setup/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  })

  if (res.ok) {
    showToast('Config saved! Restart server manually.', 'success')
  } else {
    showToast('Error saving config!', 'error')
  }
}

function showToast(msg, type) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = 'toast show ' + type
  setTimeout(() => t.className = 'toast', 3000)
}

init()
</script>
</body>
</html>`


const loginHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAB Webserver — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg:#080e14; --surface:#0d1821; --border:#1a2d42; --accent:#00d2ff; --text:#c8dce8; --muted:#4a6478; --error:#ff5252; }
    body { background:var(--bg); color:var(--text); font-family:'JetBrains Mono',monospace; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:32px; width:100%; max-width:380px; }
    h1 { font-size:20px; font-weight:700; color:#fff; margin-bottom:6px; }
    h1 span { color:var(--accent); }
    p { color:var(--muted); font-size:12px; margin-bottom:24px; }
    label { display:block; font-size:11px; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; }
    input { width:100%; background:#111c27; border:1px solid var(--border); border-radius:6px; color:var(--text); font-family:'JetBrains Mono',monospace; font-size:13px; padding:10px 14px; outline:none; margin-bottom:16px; }
    input:focus { border-color:var(--accent); }
    button { width:100%; background:var(--accent); color:#080e14; border:none; border-radius:6px; padding:12px; font-size:13px; font-weight:700; cursor:pointer; text-transform:uppercase; letter-spacing:1px; }
    .err { color:var(--error); font-size:12px; margin-bottom:14px; display:none; }
  </style>
</head>
<body>
<div class="card">
  <h1>Si4684 <span>Setup</span></h1>
  <p>Enter password to access setup</p>
  <div class="err" id="err">Incorrect password</div>
  <label>Password</label>
  <input type="password" id="pw" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Login</button>
</div>
<script>
async function login() {
  const pw = document.getElementById('pw').value
  const res = await fetch('/setup/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw}) })
  if (res.ok) { window.location.href = '/setup' }
  else { document.getElementById('err').style.display = 'block' }
}
</script>
</body>
</html>`

const firstRunHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAB Webserver — First Run</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg:#080e14; --surface:#0d1821; --border:#1a2d42; --accent:#00d2ff; --text:#c8dce8; --muted:#4a6478; --error:#ff5252; --success:#00e676; }
    body { background:var(--bg); color:var(--text); font-family:'JetBrains Mono',monospace; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:32px; width:100%; max-width:400px; }
    h1 { font-size:20px; font-weight:700; color:#fff; margin-bottom:6px; }
    h1 span { color:var(--accent); }
    .badge { display:inline-block; background:rgba(0,230,118,0.1); border:1px solid rgba(0,230,118,0.3); color:var(--success); border-radius:4px; padding:2px 8px; font-size:10px; letter-spacing:1px; margin-bottom:16px; }
    p { color:var(--muted); font-size:12px; margin-bottom:24px; line-height:1.6; }
    label { display:block; font-size:11px; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:1px; }
    input { width:100%; background:#111c27; border:1px solid var(--border); border-radius:6px; color:var(--text); font-family:'JetBrains Mono',monospace; font-size:13px; padding:10px 14px; outline:none; margin-bottom:16px; }
    input:focus { border-color:var(--accent); }
    button { width:100%; background:var(--accent); color:#080e14; border:none; border-radius:6px; padding:12px; font-size:13px; font-weight:700; cursor:pointer; text-transform:uppercase; letter-spacing:1px; }
    .err { color:var(--error); font-size:12px; margin-bottom:14px; display:none; }
  </style>
</head>
<body>
<div class="card">
  <div class="badge">FIRST RUN</div>
  <h1>Si4684 <span>Setup</span></h1>
  <p>No password set. Create a password to secure access to the setup page.</p>
  <div class="err" id="err">Passwords do not match</div>
  <label>Password</label>
  <input type="password" id="pw1" placeholder="Enter password">
  <label>Confirm Password</label>
  <input type="password" id="pw2" placeholder="Confirm password" onkeydown="if(event.key==='Enter')setPassword()">
  <button onclick="setPassword()">Set Password & Continue</button>
</div>
<script>
async function setPassword() {
  const pw1 = document.getElementById('pw1').value
  const pw2 = document.getElementById('pw2').value
  if (!pw1 || pw1 !== pw2) { document.getElementById('err').style.display='block'; return }
  const res = await fetch('/setup/first-run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw1}) })
  if (res.ok) { window.location.href = '/setup' }
}
</script>
</body>
</html>`

function registerSetup(app) {
  // First-run
  app.get('/setup/first-run', (req, res) => {
    if (readConfig().auth?.password) return res.redirect('/setup/login')
    res.send(firstRunHTML)
  })
  app.post('/setup/first-run', express.json(), (req, res) => {
    const { password } = req.body
    if (!password) return res.status(400).json({ error: 'No password' })
    const cfg = readConfig()
    cfg.auth = { password }
    saveConfig(cfg)
    const token = generateToken()
    activeSessions.set(token, Date.now())
    res.setHeader('Set-Cookie', `setup_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}`)
    res.json({ ok: true })
  })

  // Login
  app.get('/setup/login', (req, res) => {
    if (!readConfig().auth?.password) return res.redirect('/setup/first-run')
    if (isValidSession(req)) return res.redirect('/setup')
    res.send(loginHTML)
  })
  app.post('/setup/login', express.json(), (req, res) => {
    const cfg = readConfig()
    const { password } = req.body
    if (!cfg.auth?.password || password !== cfg.auth.password) return res.status(401).json({ error: 'Wrong password' })
    const token = generateToken()
    activeSessions.set(token, Date.now())
    res.setHeader('Set-Cookie', `setup_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}`)
    res.json({ ok: true })
  })

  // Setup page - protejat
  app.get('/setup', requireAuth, (req, res) => {
    res.send(setupHTML)
  })

  // Get current config
  app.get('/setup/config', requireAuth, (req, res) => {
    res.json(readConfig())
  })

  // List serial ports
  app.get('/setup/ports', requireAuth, async (req, res) => {
    const ports = await getSerialPorts()
    res.json(ports)
  })

  // List audio devices
  app.get('/setup/audio', requireAuth, async (req, res) => {
    const devices = await getAudioDevices()
    res.json(devices)
  })

  // Save config
  app.post('/setup/save', requireAuth, express.json(), (req, res) => {
    try {
      const existing = readConfig()
      saveConfig({ ...req.body, auth: existing.auth })
      res.json({ ok: true })
    } catch(e) {
      res.status(500).json({ error: e.message })
    }
  })
}

module.exports = { registerSetup }
