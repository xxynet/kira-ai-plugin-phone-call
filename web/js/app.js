/** Persona-based phone call screen and hands-free call lifecycle. */
import * as ws from './ws.js'
import * as recorder from './recorder.js'
import * as player from './player.js'
import { setLocale, t } from './i18n.js'
import { loadPersona, loadPersonaAvatar } from './persona.js'

const $ = (id) => document.getElementById(id)
let state = 'disconnected'
let callActive = false
let ending = false
let busy = false
let clearing = false
let micMuted = false
let speakerEnabled = true
let callGeneration = 0
let microphoneTask = null
let startedAt = null
let durationTimer = null
let personaName = ''
let avatarUrl = null
let personaRequest = 0
let personaController = null
let avatarController = null
let errorKey = null

function setIcon(id, icon) {
  $(id).querySelector('use').setAttribute('href', './icons.svg#' + icon)
}

function render() {
  $('app').dataset.state = state
  $('app').dataset.muted = String(micMuted)
  $('status-text').textContent = t(clearing ? 'clearing' : micMuted && state === 'listening' ? 'muted' : state)
  $('btn-call').classList.toggle('hangup', callActive)
  $('btn-call').setAttribute('aria-label', t(callActive ? 'hangup' : 'dial'))
  $('call-label').textContent = t(ending ? 'ending' : callActive ? 'hangup' : 'dial')
  $('btn-clear').disabled = !callActive || !ws.isConnected() || busy || clearing || player.isPlaying()
  $('btn-mute').disabled = !callActive || !ws.isConnected()
  $('btn-mute').setAttribute('aria-pressed', String(micMuted))
  $('btn-mute').setAttribute('aria-label', t(micMuted ? 'unmuteAction' : 'muteAction'))
  $('mute-label').textContent = t(micMuted ? 'muted' : 'mute')
  setIcon('btn-mute', micMuted ? 'mic-off' : 'mic')
  $('btn-speaker').setAttribute('aria-pressed', String(speakerEnabled))
  $('btn-speaker').setAttribute('aria-label', t(speakerEnabled ? 'speakerOffAction' : 'speakerOnAction'))
  $('speaker-label').textContent = t(speakerEnabled ? 'speaker' : 'speakerOff')
  setIcon('btn-speaker', speakerEnabled ? 'volume-2' : 'volume-x')
  $('contact-name').textContent = personaName || t('assistant')
  for (const label of document.querySelectorAll('.msg-label')) {
    label.textContent = label.dataset.role === 'assistant' ? personaName || t('assistant') : t('user')
  }
  if (errorKey) $('call-error').textContent = t(errorKey)
}

function setState(value) {
  state = value
  render()
}

function applyContext(ctx) {
  document.documentElement.dataset.theme = ctx.isDark ? 'dark' : 'light'
  setLocale(ctx.locale)
  document.title = t('title')
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n)
  }
  $('call-duration').setAttribute('aria-label', t('duration'))
  document.querySelector('.controls').setAttribute('aria-label', t('controls'))
  $('btn-close-captions').setAttribute('aria-label', t('closeCaptions'))
  for (const element of document.querySelectorAll('[data-no-speech]')) element.textContent = t('noSpeech')
  render()
}

function showError(message, key = null) {
  errorKey = key
  $('call-error').textContent = key ? t(key) : message
  $('call-error').hidden = false
}

function clearError() {
  errorKey = null
  $('call-error').hidden = true
  $('call-error').textContent = ''
}

function clearTranscript() {
  $('transcript').replaceChildren()
  $('caption-empty').hidden = false
}

function appendMessage(role, text) {
  if (role !== 'user' && role !== 'assistant') return
  const message = document.createElement('div')
  message.className = 'caption-message'
  message.dataset.role = role
  const label = document.createElement('span')
  label.className = 'msg-label'
  label.dataset.role = role
  label.textContent = role === 'assistant' ? personaName || t('assistant') : t('user')
  const content = document.createElement('p')
  if (text === '(no speech detected)') {
    content.dataset.noSpeech = ''
    content.textContent = t('noSpeech')
  } else {
    content.textContent = text
  }
  message.append(label, content)
  $('transcript').appendChild(message)
  $('caption-empty').hidden = true
  $('transcript').scrollTop = $('transcript').scrollHeight
}

async function refreshAvatar(persona, request) {
  const controller = new AbortController()
  avatarController = controller
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const image = await loadPersonaAvatar(persona, controller.signal)
    if (!image || request !== personaRequest) return
    avatarUrl = URL.createObjectURL(image)
    $('avatar-image').alt = personaName || t('assistant')
    $('avatar-image').src = avatarUrl
  } catch {
    // Optional image failures keep the contact initial and never block dialing.
  } finally {
    clearTimeout(timeout)
    if (avatarController === controller) avatarController = null
  }
}

async function refreshPersona() {
  const request = ++personaRequest
  personaController?.abort()
  avatarController?.abort()
  const controller = new AbortController()
  personaController = controller
  const timeout = setTimeout(() => controller.abort(), 8000)
  let persona
  try {
    persona = await loadPersona(controller.signal)
  } catch (error) {
    if (request === personaRequest) {
      const key = controller.signal.aborted ? 'personaTimeout'
        : error.status === 401 || error.status === 403 ? 'personaAuthError' : 'personaError'
      showError('', key)
    }
    return false
  } finally {
    clearTimeout(timeout)
    if (personaController === controller) personaController = null
  }

  if (request !== personaRequest) return false
  personaName = persona.name
  if (avatarUrl) URL.revokeObjectURL(avatarUrl)
  avatarUrl = null
  $('avatar-image').hidden = true
  $('avatar-image').removeAttribute('src')
  $('avatar-fallback').hidden = false
  $('avatar-fallback').textContent = Array.from(personaName)[0]?.toUpperCase() || 'AI'
  if (errorKey?.startsWith('persona')) clearError()
  render()
  void refreshAvatar(persona, request)
  return true
}

function updateDuration() {
  if (startedAt === null) return
  const seconds = Math.floor((performance.now() - startedAt) / 1000)
  const parts = seconds >= 3600
    ? [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    : [Math.floor(seconds / 60), seconds % 60]
  $('call-duration').textContent = parts.map((part) => String(part).padStart(2, '0')).join(':')
}

function pauseListening() {
  recorder.setListening(false)
}

function resumeListening() {
  if (!callActive || !ws.isConnected() || busy || clearing || player.isPlaying()) return
  if (!micMuted && !recorder.isListening()) recorder.setListening(true)
  setState('listening')
}

async function handleUtterance(blob) {
  if (!callActive || micMuted || busy || clearing || !ws.isConnected()) return
  const generation = callGeneration
  busy = true
  pauseListening()
  setState('thinking')
  try {
    const buffer = await blob.arrayBuffer()
    if (!callActive || generation !== callGeneration || !ws.isConnected()) return
    ws.sendAudio(buffer)
    ws.sendControl('audio_end')
  } catch {
    if (generation !== callGeneration) return
    busy = false
    showError('', 'callError')
    resumeListening()
  }
}

player.onStateChange(
  () => {
    if (!callActive) return
    pauseListening()
    setState('speaking')
  },
  () => { if (callActive) resumeListening() },
)

function handleMessage(data) {
  if (!callActive) return
  switch (data.type) {
    case 'status':
      if (data.state === 'thinking' || data.state === 'speaking') {
        busy = true
        pauseListening()
        setState(data.state)
      } else if (data.state === 'idle') {
        busy = false
        if (!player.isPlaying()) resumeListening()
        render()
      }
      break
    case 'transcript':
      if (data.role && data.text) appendMessage(data.role, data.text)
      break
    case 'audio':
      if (data.data && data.mime) {
        pauseListening()
        player.enqueue(data.data, data.mime)
      }
      break
    case 'error':
      if (data.message) showError(data.message)
      else showError('', 'callError')
      break
    case 'cleared':
      clearing = false
      clearTranscript()
      resumeListening()
      break
  }
}

async function startCall() {
  if (callActive || ending) return
  const generation = ++callGeneration
  callActive = true
  busy = false
  micMuted = false
  startedAt = null
  $('call-duration').textContent = '00:00'
  clearError()
  clearTranscript()
  setState('connecting')
  microphoneTask = recorder.init()
  const [micReady, personaReady] = await Promise.all([microphoneTask, refreshPersona()])
  microphoneTask = null
  if (!callActive || generation !== callGeneration) return
  if (!micReady || !personaReady) {
    await endCall()
    if (!micReady) showError('', 'microphoneError')
    return
  }

  recorder.setMuted(false)
  recorder.start(handleUtterance)
  pauseListening()
  try {
    ws.connect(
      (data) => { if (generation === callGeneration) handleMessage(data) },
      (connection) => {
        if (!callActive || generation !== callGeneration) return
        busy = false
        clearing = false
        if (connection === 'connected') {
          if (startedAt === null) {
            startedAt = performance.now()
            durationTimer = setInterval(updateDuration, 1000)
          }
          resumeListening()
        } else {
          player.stopAll()
          pauseListening()
          setState('connecting')
        }
      },
    )
  } catch {
    await endCall()
    showError('', 'callError')
  }
}

async function endCall() {
  if (!callActive || ending) return
  ending = true
  callActive = false
  ++callGeneration
  ++personaRequest
  personaController?.abort()
  avatarController?.abort()
  ws.disconnect()
  player.stopAll()
  updateDuration()
  clearInterval(durationTimer)
  durationTimer = null
  busy = false
  clearing = false
  micMuted = false
  $('btn-call').disabled = true
  setState('ended')
  try {
    await microphoneTask
    await recorder.dispose()
  } finally {
    ending = false
    $('btn-call').disabled = false
    render()
  }
}

function showCaptions(visible) {
  $('caption-panel').hidden = !visible
  $('btn-captions').setAttribute('aria-pressed', String(visible))
  $('btn-captions').setAttribute('aria-expanded', String(visible))
  if (visible) $('transcript').scrollTop = $('transcript').scrollHeight
}

async function init() {
  const ctx = await window.PluginPageContext.ready()
  applyContext(ctx)
  window.PluginPageContext.onContext(applyContext)
  $('avatar-image').onload = () => {
    $('avatar-image').hidden = false
    $('avatar-fallback').hidden = true
  }
  $('avatar-image').onerror = () => {
    $('avatar-image').hidden = true
    $('avatar-fallback').hidden = false
  }
  $('btn-call').addEventListener('click', () => callActive ? endCall() : startCall())
  $('btn-mute').addEventListener('click', () => {
    micMuted = !micMuted
    recorder.setMuted(micMuted)
    if (micMuted) pauseListening()
    else resumeListening()
    render()
  })
  $('btn-speaker').addEventListener('click', () => {
    speakerEnabled = !speakerEnabled
    player.setMuted(!speakerEnabled)
    render()
  })
  $('btn-captions').addEventListener('click', () => showCaptions($('caption-panel').hidden))
  $('btn-close-captions').addEventListener('click', () => {
    showCaptions(false)
    $('btn-captions').focus()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('caption-panel').hidden) {
      showCaptions(false)
      $('btn-captions').focus()
    }
  })
  $('btn-clear').addEventListener('click', () => {
    if ($('btn-clear').disabled) return
    clearing = true
    pauseListening()
    clearError()
    render()
    ws.sendControl('clear')
  })
  window.addEventListener('pagehide', () => {
    endCall()
    ++personaRequest
    personaController?.abort()
    avatarController?.abort()
    if (avatarUrl) URL.revokeObjectURL(avatarUrl)
  })
  await refreshPersona()
  $('btn-call').disabled = false
}

init()
