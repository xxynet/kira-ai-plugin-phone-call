/**
 * Hands-free microphone recorder with lightweight browser-side VAD.
 * Audio is split into utterances after a short period of silence.
 */

const VAD_INTERVAL_MS = 50
const SPEECH_START_MS = 100
const SPEECH_END_SILENCE_MS = 800
const MIN_SPEECH_MS = 250
const MAX_UTTERANCE_MS = 30000
const IDLE_SEGMENT_MS = 3000
const MIN_START_THRESHOLD = 0.018
const MIN_STOP_THRESHOLD = 0.012

let mediaStream = null
let mediaRecorder = null
let audioContext = null
let analyser = null
let samples = null
let vadTimer = null
let chunks = []
let listening = false
let stopping = false
let speechDetected = false
let loudSince = null
let silenceSince = null
let speechStartedAt = null
let segmentStartedAt = null
let noiseFloor = 0.006
let utteranceHandler = null
let activityHandler = null

export async function init() {
  if (mediaStream?.active) return true

  try {
    if (!window.MediaRecorder) throw new Error('MediaRecorder is not supported')
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) throw new Error('Web Audio API is not supported')
    audioContext = new AudioContextClass()
    await audioContext.resume()
    const source = audioContext.createMediaStreamSource(mediaStream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.2
    source.connect(analyser)
    samples = new Float32Array(analyser.fftSize)
    return true
  } catch (err) {
    console.error('[recorder] microphone initialization failed:', err)
    await dispose()
    return false
  }
}

/**
 * Begin automatic utterance detection.
 * @param {(blob: Blob) => void} onUtterance
 * @param {(activity: 'speech'|'silence') => void} [onActivity]
 */
export function start(onUtterance, onActivity) {
  if (!mediaStream?.active || !analyser) return

  utteranceHandler = onUtterance
  activityHandler = onActivity || null
  listening = true
  _startSegment()

  if (!vadTimer) {
    vadTimer = window.setInterval(_detectVoice, VAD_INTERVAL_MS)
  }
}

/** Pause or resume listening without releasing microphone permission. */
export function setListening(enabled) {
  listening = enabled
  _resetVoiceState()

  if (enabled) {
    _startSegment()
  } else {
    _stopSegment(false)
  }
}

function _detectVoice() {
  if (!listening || !analyser || stopping) return
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    _startSegment()
    return
  }

  analyser.getFloatTimeDomainData(samples)
  let sumSquares = 0
  for (const sample of samples) sumSquares += sample * sample
  const rms = Math.sqrt(sumSquares / samples.length)
  const now = performance.now()

  if (!speechDetected) {
    noiseFloor = Math.min(0.03, noiseFloor * 0.95 + rms * 0.05)
    const startThreshold = Math.max(MIN_START_THRESHOLD, noiseFloor * 2.5)

    if (rms >= startThreshold) {
      loudSince ??= now
      if (now - loudSince >= SPEECH_START_MS) {
        speechDetected = true
        speechStartedAt = now
        silenceSince = null
        activityHandler?.('speech')
      }
    } else {
      loudSince = null
    }

    if (segmentStartedAt && now - segmentStartedAt >= IDLE_SEGMENT_MS) {
      _stopSegment(false)
    }
    return
  }

  const stopThreshold = Math.max(MIN_STOP_THRESHOLD, noiseFloor * 1.6)
  if (rms <= stopThreshold) {
    silenceSince ??= now
  } else {
    silenceSince = null
  }

  const speechDuration = now - speechStartedAt
  const silenceDuration = silenceSince === null ? 0 : now - silenceSince
  if (
    speechDuration >= MAX_UTTERANCE_MS ||
    (speechDuration >= MIN_SPEECH_MS && silenceDuration >= SPEECH_END_SILENCE_MS)
  ) {
    activityHandler?.('silence')
    _stopSegment(true)
  }
}

function _startSegment() {
  if (!listening || stopping || !mediaStream?.active) return
  if (mediaRecorder && mediaRecorder.state === 'recording') return

  chunks = []
  _resetVoiceState()

  let mimeType = 'audio/webm;codecs=opus'
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
  }

  mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)
  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size > 0) chunks.push(event.data)
  }
  mediaRecorder.start(250)
  segmentStartedAt = performance.now()
}

function _stopSegment(emitUtterance) {
  if (stopping || !mediaRecorder || mediaRecorder.state !== 'recording') return

  stopping = true
  const recorder = mediaRecorder
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    chunks = []
    mediaRecorder = null
    stopping = false
    _resetVoiceState()

    if (emitUtterance && blob.size > 0) utteranceHandler?.(blob)
    if (listening) _startSegment()
  }
  recorder.stop()
}

function _resetVoiceState() {
  speechDetected = false
  loudSince = null
  silenceSince = null
  speechStartedAt = null
  segmentStartedAt = null
}

export function isListening() {
  return listening
}

export function isReady() {
  return !!mediaStream?.active
}

export async function dispose() {
  listening = false
  if (vadTimer) {
    clearInterval(vadTimer)
    vadTimer = null
  }

  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  mediaRecorder = null
  chunks = []
  stopping = false
  _resetVoiceState()

  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
  analyser = null
  samples = null

  if (audioContext && audioContext.state !== 'closed') await audioContext.close()
  audioContext = null
  noiseFloor = 0.006
}
