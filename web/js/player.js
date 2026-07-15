/**
 * Audio playback queue for TTS responses.
 * Plays audio clips sequentially using base64 data URLs.
 */

let queue = []
let playing = false
let currentAudio = null

/** @type {Function|null} */
let onPlayCallback = null
/** @type {Function|null} */
let onEndCallback = null

/**
 * Register callbacks for playback state changes.
 * @param {Function} onPlay - Called when audio starts playing.
 * @param {Function} onEnd  - Called when all queued audio finishes.
 */
export function onStateChange(onPlay, onEnd) {
  onPlayCallback = onPlay
  onEndCallback = onEnd
}

/**
 * Enqueue a base64-encoded audio clip for playback.
 * @param {string} base64Data - Raw base64 string (no data: prefix).
 * @param {string} mime       - MIME type, e.g. 'audio/mpeg'.
 */
export function enqueue(base64Data, mime) {
  queue.push({ base64Data, mime })
  if (!playing) {
    _playNext()
  }
}

function _playNext() {
  if (queue.length === 0) {
    playing = false
    currentAudio = null
    if (onEndCallback) onEndCallback()
    return
  }

  playing = true
  const { base64Data, mime } = queue.shift()

  if (onPlayCallback) onPlayCallback()

  const audio = new Audio(`data:${mime};base64,${base64Data}`)
  currentAudio = audio

  audio.onended = () => {
    currentAudio = null
    _playNext()
  }

  audio.onerror = (e) => {
    console.error('[player] audio playback error:', e)
    currentAudio = null
    _playNext()
  }

  audio.play().catch((err) => {
    console.error('[player] play() rejected:', err)
    currentAudio = null
    _playNext()
  })
}

/**
 * Stop all playback and clear the queue.
 */
export function stopAll() {
  queue = []
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  playing = false
}

/**
 * Check if audio is currently playing.
 * @returns {boolean}
 */
export function isPlaying() {
  return playing
}
