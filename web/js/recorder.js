/**
 * Microphone recorder — push-to-talk style.
 * Uses MediaRecorder to capture audio in WebM/Opus format.
 */

let mediaStream = null
let mediaRecorder = null
let chunks = []
let recording = false

/**
 * Request microphone permission and prepare the recorder.
 * @returns {Promise<boolean>} true if microphone is ready.
 */
export async function init() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    return true
  } catch (err) {
    console.error('[recorder] getUserMedia failed:', err)
    return false
  }
}

/**
 * Start recording audio.
 * Accumulates dataavailable chunks internally.
 */
export function start() {
  if (!mediaStream || recording) return

  chunks = []

  // Prefer Opus in WebM, fall back to plain WebM
  let mimeType = 'audio/webm;codecs=opus'
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm'
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = '' // let the browser pick
    }
  }

  mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data)
    }
  }

  mediaRecorder.start(250) // collect chunks every 250ms
  recording = true
}

/**
 * Stop recording and return the audio as a single Blob.
 * @returns {Promise<Blob>} The recorded audio blob.
 */
export function stop() {
  return new Promise((resolve) => {
    if (!mediaRecorder || !recording) {
      resolve(new Blob())
      return
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
      chunks = []
      recording = false
      resolve(blob)
    }

    mediaRecorder.stop()
  })
}

/**
 * Check if currently recording.
 * @returns {boolean}
 */
export function isRecording() {
  return recording
}

/**
 * Check if the microphone is ready (stream is active).
 * @returns {boolean}
 */
export function isReady() {
  return !!mediaStream
}

/**
 * Release the microphone stream.
 */
export function dispose() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
  recording = false
  chunks = []
}
