/**
 * AI Phone Call — main entry point.
 * Orchestrates WebSocket, recorder, and player modules.
 */

import * as ws from './ws.js'
import * as recorder from './recorder.js'
import * as player from './player.js'

// ── DOM refs ─────────────────────────────────────────────────────────────

const $app = document.getElementById('app')
const $avatar = document.getElementById('avatar')
const $statusDot = document.getElementById('status-dot')
const $statusText = document.getElementById('status-text')
const $transcript = document.getElementById('transcript')
const $btnTalk = document.getElementById('btn-talk')
const $btnClear = document.getElementById('btn-clear')
const $talkHint = document.getElementById('talk-hint')

// ── State ────────────────────────────────────────────────────────────────

let state = 'idle' // idle | listening | thinking | speaking
let micReady = false

// ── Status display ───────────────────────────────────────────────────────

const STATUS_MAP = {
  idle:      { text: '等待中',      dot: 'idle',      ring: 'idle' },
  listening: { text: '正在听...',  dot: 'listening', ring: 'listening' },
  thinking:  { text: '思考中...',  dot: 'thinking',  ring: 'thinking' },
  speaking:  { text: 'AI 说话中',  dot: 'speaking',  ring: 'speaking' },
}

function setState(newState) {
  state = newState
  const info = STATUS_MAP[newState] || STATUS_MAP.idle

  $statusText.textContent = info.text

  $statusDot.className = `w-2.5 h-2.5 rounded-full status-dot-${info.dot}`
  $avatar.className = `avatar-ring avatar-${info.ring}`
}

// ── Transcript rendering ─────────────────────────────────────────────────

const ROLE_LABELS = { user: '你', assistant: 'AI' }

function appendMessage(role, text) {
  const wrapper = document.createElement('div')
  wrapper.className = role === 'user' ? 'flex justify-end' : 'flex justify-start'

  const bubble = document.createElement('div')
  bubble.className = `msg-bubble ${role === 'user' ? 'msg-user' : 'msg-assistant'}`

  const label = document.createElement('div')
  label.className = 'msg-label'
  label.textContent = ROLE_LABELS[role] || role

  const content = document.createElement('div')
  content.textContent = text

  bubble.appendChild(label)
  bubble.appendChild(content)
  wrapper.appendChild(bubble)
  $transcript.appendChild(wrapper)

  // Auto-scroll to bottom
  $transcript.scrollTop = $transcript.scrollHeight
}

function appendError(message) {
  const el = document.createElement('div')
  el.className = 'msg-error'
  el.textContent = message
  $transcript.appendChild(el)
  $transcript.scrollTop = $transcript.scrollHeight
}

function clearTranscript() {
  $transcript.innerHTML = ''
}

// ── Audio playback state callbacks ───────────────────────────────────────

player.onStateChange(
  () => setState('speaking'),
  () => {
    if (state === 'speaking') setState('idle')
  },
)

// ── WebSocket message handler ────────────────────────────────────────────

function handleMessage(data) {
  switch (data.type) {
    case 'status':
      if (data.state && STATUS_MAP[data.state]) {
        setState(data.state)
      }
      break

    case 'transcript':
      if (data.role && data.text) {
        appendMessage(data.role, data.text)
      }
      break

    case 'audio':
      if (data.data && data.mime) {
        player.enqueue(data.data, data.mime)
      }
      break

    case 'error':
      appendError(data.message || 'Unknown error')
      if (state === 'thinking') setState('idle')
      break

    case 'cleared':
      clearTranscript()
      setState('idle')
      break
  }
}

// ── Push-to-talk handlers ────────────────────────────────────────────────

async function handleTalkStart(e) {
  e.preventDefault()
  if (!micReady || state === 'thinking' || state === 'speaking') return
  if (!ws.isConnected()) return

  // Stop any playing audio so the user can interrupt
  player.stopAll()
  recorder.start()
  setState('listening')
  $btnTalk.classList.add('pressed')
  $talkHint.textContent = '松开发送'
}

async function handleTalkEnd(e) {
  e.preventDefault()
  if (!recorder.isRecording()) return

  $btnTalk.classList.remove('pressed')
  $talkHint.textContent = '按住说话'

  const audioBlob = await recorder.stop()

  if (audioBlob.size > 0) {
    // Send audio data then signal end
    const buffer = await audioBlob.arrayBuffer()
    ws.sendAudio(buffer)
    ws.sendControl('audio_end')
    setState('thinking')
  } else {
    setState('idle')
  }
}

// ── Initialization ───────────────────────────────────────────────────────

async function init() {
  // 1) Get plugin context from bridge SDK
  const ctx = await window.PluginPageContext.ready()

  // 2) Apply initial theme
  applyTheme(ctx.isDark)

  // 3) Listen for theme changes
  window.PluginPageContext.onThemeChange((isDark) => applyTheme(isDark))

  // 4) Request microphone
  micReady = await recorder.init()
  if (!micReady) {
    $statusText.textContent = '麦克风权限被拒绝'
    $talkHint.textContent = '请允许麦克风权限后刷新'
    return
  }

  // 5) Enable talk button
  $btnTalk.disabled = false

  // 6) Connect WebSocket
  ws.connect(handleMessage, (connState) => {
    if (connState === 'connected') {
      setState('idle')
      $btnTalk.disabled = false
    } else {
      setState('idle')
      $statusText.textContent = '连接断开，正在重连...'
      $btnTalk.disabled = true
    }
  })

  // 7) Wire up button events (pointer events for mouse + touch)
  $btnTalk.addEventListener('pointerdown', handleTalkStart)
  $btnTalk.addEventListener('pointerup', handleTalkEnd)
  $btnTalk.addEventListener('pointerleave', handleTalkEnd)
  $btnTalk.addEventListener('pointercancel', handleTalkEnd)

  // Prevent context menu on long press (mobile)
  $btnTalk.addEventListener('contextmenu', (e) => e.preventDefault())

  // 8) Clear button
  $btnClear.addEventListener('click', () => {
    ws.sendControl('clear')
    player.stopAll()
  })
}

function applyTheme(isDark) {
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light')
}

// ── Go ───────────────────────────────────────────────────────────────────

init()
