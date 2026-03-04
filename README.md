# Si4686 DAB WebServer

The Si4686 DAB Webserver can be used with the SI4684-DAB-Receiver project (https://github.com/PE5PVB/SI4684-DAB-Receiver). It requires connecting the ESP32 to a USB port and the sound output to a sound card that has an input. 
---
<img width="1914" height="913" alt="image" src="https://github.com/user-attachments/assets/1d7d121f-9042-4ac5-aac5-dc783305b2e8" />

## Features

- 🎵 **Live audio streaming** — MP3 stream via Socket.io (desktop) and HTTP endpoint `/stream` (iOS/Safari)
- 📻 **Real-time metadata** — station name, ensemble, radio text (artist/track), service info
- 📊 **Signal graph** — live signal strength chart with canvas
- 🔒 **Lock indicator** — visual DAB lock status (locked/no lock)
- 🖼️ **DAB Slideshow** — displays album art and slideshow images from the broadcast
- 📋 **Service list** — auto-populated dropdown filtered to audio-only services (DAB/DAB+)
- ⚙️ **Service info** — bitrate, sample rate, PTY, protection level, audio mode
- 📡 **38 DAB Band III channels** — full channel list with frequencies
- 🍎 **iOS compatible** — HTTP stream fallback for Safari/iOS browsers
- ⚙️ **Config file** — all settings in `config.json`, no code changes needed

---

## Hardware

- Raspberry Pi or PC
- Silicon Labs Si4686 DAB receiver module (connected via USB serial)
- USB audio card or HiFiBerry (for audio capture)

---

## Project Structure

```
├── server.js          # Main Node.js server
├── config.json        # Configuration file
├── public/
│   ├── index.html     # Web interface
│   ├── css/
│   │   └── style.css  # Styles
│   └── js/
│       ├── constants.js  # DAB channels, PTY map, audio modes (shared)
│       └── main.js       # Frontend logic
```

---

## Installation

### Prerequisites

```bash
# Node.js 18+
node -v

# Install system dependencies
sudo apt install ffmpeg alsa-utils
```

### Setup

```bash
# Clone or copy files to your Pi
git clone https://github.com/stailus/Si4686-DAB-Webserver
cd /home/pi/Si4686-DAB-Webserver

# Install Node dependencies
npm install
```

### Configuration

Edit `config.json` before starting:

```json
{
  "serial": {
    "port": "/dev/ttyUSB0",
    "baudRate": 1000000
  },
  "audio": {
    "device": "plughw:0,0",
    "sampleRate": 48000,
    "channels": 2,
    "bitrate": "128k"
  },
  "server": {
    "port": 3000
  }
}
```

| Key | Description |
|-----|-------------|
| `serial.port` | Serial port of the Si4686 module |
| `serial.baudRate` | Baud rate (default: 1000000) |
| `audio.device` | ALSA audio capture device (run `arecord -l` to find yours) |
| `audio.bitrate` | MP3 stream bitrate (`64k`, `128k`, `192k`) |
| `server.port` | HTTP server port |

### Finding your audio device

```bash
arecord -l
```

Example output:
```
card 0: sndrpihifiberry [snd_rpi_hifiberry_dac], device 0: ...
```

Then set in config: `"device": "plughw:sndrpihifiberry"`

---

## Running

```bash
node server.js or node . command in /home/pi/Si4686-DAB-Webserver
```

Then open your browser at `http://<raspberry-pi-ip>:3000`

```

