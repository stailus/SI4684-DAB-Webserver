// ================= DAB CHANNELS =================
const DAB_CHANNELS = [
  { ch: 0,  name: '5A',  freq: '174.928' },
  { ch: 1,  name: '5B',  freq: '176.640' },
  { ch: 2,  name: '5C',  freq: '178.352' },
  { ch: 3,  name: '5D',  freq: '180.064' },
  { ch: 4,  name: '6A',  freq: '181.936' },
  { ch: 5,  name: '6B',  freq: '183.648' },
  { ch: 6,  name: '6C',  freq: '185.360' },
  { ch: 7,  name: '6D',  freq: '187.072' },
  { ch: 8,  name: '7A',  freq: '188.928' },
  { ch: 9,  name: '7B',  freq: '190.640' },
  { ch: 10, name: '7C',  freq: '192.352' },
  { ch: 11, name: '7D',  freq: '194.064' },
  { ch: 12, name: '8A',  freq: '195.936' },
  { ch: 13, name: '8B',  freq: '197.648' },
  { ch: 14, name: '8C',  freq: '199.360' },
  { ch: 15, name: '8D',  freq: '201.072' },
  { ch: 16, name: '9A',  freq: '202.928' },
  { ch: 17, name: '9B',  freq: '204.640' },
  { ch: 18, name: '9C',  freq: '206.352' },
  { ch: 19, name: '9D',  freq: '208.064' },
  { ch: 20, name: '10A', freq: '209.936' },
  { ch: 21, name: '10B', freq: '211.648' },
  { ch: 22, name: '10C', freq: '213.360' },
  { ch: 23, name: '10D', freq: '215.072' },
  { ch: 24, name: '11A', freq: '216.928' },
  { ch: 25, name: '11B', freq: '218.640' },
  { ch: 26, name: '11C', freq: '220.352' },
  { ch: 27, name: '11D', freq: '222.064' },
  { ch: 28, name: '12A', freq: '223.936' },
  { ch: 29, name: '12B', freq: '225.648' },
  { ch: 30, name: '12C', freq: '227.360' },
  { ch: 31, name: '12D', freq: '229.072' },
  { ch: 32, name: '13A', freq: '230.784' },
  { ch: 33, name: '13B', freq: '232.496' },
  { ch: 34, name: '13C', freq: '234.208' },
  { ch: 35, name: '13D', freq: '235.776' },
  { ch: 36, name: '13E', freq: '237.488' },
  { ch: 37, name: '13F', freq: '239.200' },
]

// ================= PTY MAP =================
const PTY_MAP = {
  "0":  "None",
  "1":  "News",
  "2":  "Current Affairs",
  "3":  "Information",
  "4":  "Sport",
  "5":  "Education",
  "6":  "Drama",
  "7":  "Culture",
  "8":  "Science",
  "9":  "Varied",
  "10": "Pop Music",
  "11": "Rock Music",
  "12": "Easy Listening",
  "13": "Light Classical",
  "14": "Serious Classical",
  "15": "Other Music",
  "16": "Weather",
  "17": "Finance",
  "18": "Children",
  "19": "Social Affairs",
  "20": "Religion",
  "21": "Phone-In",
  "22": "Travel",
  "23": "Leisure",
  "24": "Jazz",
  "25": "Country",
  "26": "National",
  "27": "Oldies",
  "28": "Folk",
  "29": "Documentary",
  "30": "Alarm Test",
  "31": "Alarm"
}

// ================= PROTECTION MAP =================
const PROTECTION_MAP = {
  "1":  "UEP-1",
  "2":  "UEP-2",
  "3":  "UEP-3",
  "4":  "UEP-4",
  "5":  "UEP-5",
  "6":  "EEP-A1",
  "7":  "EEP-A2",
  "8":  "EEP-A3",
  "9":  "EEP-A4",
  "10": "EEP-B1",
  "11": "EEP-B2",
  "12": "EEP-B3",
  "13": "EEP-B4"
}

// ================= AUDIO MAP =================
const AUDIO_MAP = {
  "0": "Dual",
  "1": "Mono",
  "2": "Stereo",
  "3": "Joint Stereo"
}

const AUDIO_CLASS = {
  "0": "badge badge-mono",
  "1": "badge badge-mono",
  "2": "badge badge-stereo",
  "3": "badge badge-stereo"
}

// ================= SERVICE INFO LABELS =================
const SERVICE_INFO_LABELS = {
  AUDIO:      "Audio",
  BITRATE:    "Bitrate",
  SAMPLERATE: "Sample Rate",
  PTY:        "Program Type",
  PROTECTION: "Protection",
  SID:        "Service ID"
}

// ================= HELPERS =================
function getPtyLabel(value) {
  return PTY_MAP[value] || value
}

function getPtyClass(value) {
  if (value == "30" || value == "31") return "badge badge-alarm"
  if (value >= 10 && value <= 28)     return "badge badge-music"
  return "badge badge-talk"
}

function getChannelByIndex(ch) {
  return DAB_CHANNELS.find(c => c.ch == ch) || null
}

function getChannelLabel(ch) {
  const c = getChannelByIndex(ch)
  return c ? `${c.name} \u00b7 ${c.freq} MHz` : `CH ${ch}`
}

// ================= SERVICE MODES =================
const SERVICE_MODES = {
  "0": "Audio Stream",
  "1": "Data Stream",
  "2": "FIDC",
  "3": "Data Packet",
  "4": "DAB+",
  "5": "DAB",
  "6": "FIC",
  "7": "XPAD",
  "8": "No Media"
}

const AUDIO_MODES = ["4", "5"]

// ================= EXPORT FOR NODE.JS =================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAB_CHANNELS,
    PTY_MAP,
    PROTECTION_MAP,
    AUDIO_MAP,
    AUDIO_CLASS,
    SERVICE_INFO_LABELS,
    SERVICE_MODES,
    AUDIO_MODES,
    getPtyLabel,
    getPtyClass,
    getChannelByIndex,
    getChannelLabel
  }
}
