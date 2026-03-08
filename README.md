# DAB Webserver

The Si4686 DAB Webserver can be used with the SI4684-DAB-Receiver project (https://github.com/PE5PVB/SI4684-DAB-Receiver). It requires connecting the ESP32 to a USB port and the sound output to a sound card that has an input.

<img width="1920" height="914" alt="image" src="https://github.com/user-attachments/assets/7f841402-a4f3-4fd1-ab7c-7b74557ff6da" />


---

## Requirements

- Node.js 18+
- FFmpeg installed and available in PATH
- SI4684-DAB-Receiver project (https://github.com/PE5PVB/SI4684-DAB-Receiver)
- Windows: sound card accessible via DirectShow (dshow)
- Linux/RPi: sound card accessible via ALSA (`plughw:...`)

---

## Installation

```bash
npm install
node server.js
```

On first run, if `config.json` has no password set, the browser will be automatically redirected to the setup page.

---

## Configuration

The `config.json` file is generated and edited from the setup interface (`/setup`). Structure:

```json
{
  "serial": {
    "port": "COM3",
    "baudRate": 1000000
  },
  "audio": {
    "device": "",
    "sampleRate": 48000,
    "channels": 2,
    "bitrate": "128k"
  },
  "server": {
    "port": 3000
  },
  "scan": {
    "autoScanOnStart": false
  },
  "auth": {
    "password": "your_password"
  }
}
```

> **Note:** `baudRate` is fixed at `1000000` and cannot be changed from the UI. Do not modify this value manually.

---

## Setup (`/setup`)

The setup page allows configuring the serial port, audio device, sample rate, channels, bitrate and the HTTP server port.

- **First run** — if no password exists in `config.json`, you are redirected to `/setup/first-run` to set one
- **Subsequent access** — `/setup` requires authentication; session is valid for 4 hours
- Changes are saved to `config.json`; the server must be restarted manually after saving

---

## Audio streaming

Live audio streaming via WebSocket at the `/audio-ws` endpoint.

- Windows: capture via FFmpeg DirectShow (`-f dshow`)
- Linux: capture via arecord
- MP3 encoding via 3LAS (Low Latency Live Audio Streaming)
- The web client uses 3LAS for in-browser playback without plugins
- Compatibil cu Chrome, Firefox, Safari (inclusiv iPhone)

---

## WebSocket data (`/data-ws`)

Main communication channel between server and clients. All messages are JSON.


---

## Scanner

Automatically scans all 38 DAB channels (Band III). For each detected channel it saves:
- Channel name and frequency
- Ensemble ID and name
- List of available services
- Signal level

If `autoScanOnStart: true` in `config.json`, the scan starts automatically 3 seconds after server startup.

---

## Tested platforms

| Platform | Status |
|-----------|--------|
| Windows 10/11 | ✅ |
| Raspberry Pi (Linux) | ✅ |
| iOS Safari | ✅ |
| Android Chrome | ✅ |
