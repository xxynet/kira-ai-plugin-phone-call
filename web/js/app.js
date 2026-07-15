/** AI Phone Call — hands-free call controller. */

import * as ws from './ws.js'
import * as recorder from './recorder.js'
import * as player from './player.js'

const $avatar = document.getElementById('avatar')
const $statusDot = document.getElementById('status-dot')
const $statusText = document.getElementById('status-text')
const $transcript = document.getElementById('transcript')
const $btnCall = document.getElementById('btn-call')
const $btnClear = document.getElementById('btn-clear')
const $callHint = document.getElementById('call-hint')

const PHONE_ICON = `
  <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>`
const HANGUP_ICON = `
  <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M21 15.46l-5.27-1.22a1 1 0 0 0-1.01.34l-1.15 1.41a15.05 15.05 0 0 1-5.56-5.56l1.41-1.15a1 1 0 0 0 .34-1.01L8.54 3A1 1 0 0 0 7.56 2.2H4.03A1.83 1.83 0 0 0 2.2 4.17 19.62 19.62 0 0 0 19.83 21.8a1.83 1.83 0 0 0 1.97-1.83v-3.53a1 1 0 0 0-.8-.98Z" />
  </svg>`

const STATUS_MAP = {
  disconnected: { text: '点击拨号开始通话', dot: 'idle', ring: 'idle' },
  connecting: { text: '正在接通...', dot: 'thinking', ring: 'thinking' },
  listening: { text: '正在聆听...', dot: 'listening', ring: 'listening' },
  thinking: { text: '思考中...', dot: 'thinking', ring: 'thinking' },
  speaking: { text: 'AI 说话中...', dot: 'speaking', ring: 'speaking' },
}

let state = 'disconnected'
let callActive = false

function setState(newState) {
  state = newState
  const info = STATUS_MAP[newState] || STATUS_MAP.disconnected
  $statusText.textContent = info.text
  $statusDot.className = `w-2.5 h-2.5 rounded-full status-dot-${info.dot}`
  $avatar.className = `avatar-ring avatar-${info.ring}`
}

function updateCallButton() {
  $btnCall.innerHTML = callActive ? HANGUP_ICON : PHONE_ICON
  $btnCall.classList.toggle('hangup', callActive)
  $btnCall.setAttribute('aria-label', callActive ? '挂断' : '拨号')
  $callHint.textContent = callActive ? '点击挂断' : '点击拨号'
  $btnClear.disabled = !callActive
}

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
  bubble.append(label, content)
  wrapper.appendChild(bubble)
  $transcript.appendChild(wrapper)
  $transcript.scrollTop = $transcript.scrollHeight
}

function appendError(message) {
  const el = document.createElement('div')
  el.className = 'msg-error'
  el.textContent = message
  $transcript.appendChild(el)
  $transcript.scrollTop = $transcript.scrollHeight
}

function resumeListening() {
  if (!callActive || !ws.isConnected()) return
  recorder.setListening(true)
  setState('listening')
}

function pauseListening() {
  recorder.setListening(false)
}

async function handleUtterance(audioBlob) {
  if (!callActive || !ws.isConnected()) return
  pauseListening()
  setState('thinking')
  const buffer = await audioBlob.arrayBuffer()

  if (!callActive || !ws.isConnected()) return
  ws.sendAudio(buffer)
  ws.sendControl('audio_end')
}

player.onStateChange(
  () => {
    pauseListening()
    setState('speaking')
  },
  () => {
    if (callActive) resumeListening()
  },
)

function handleMessage(data) {
  switch (data.type) {
    case 'status':
      if (data.state === 'thinking' || data.state === 'speaking') {
        pauseListening()
        setState(data.state)
      } else if (data.state === 'idle' && !player.isPlaying()) {
        resumeListening()
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
      appendError(data.message || '通话处理失败')
      if (!player.isPlaying()) resumeListening()
      break
    case 'cleared':
      $transcript.innerHTML = ''
      if (!player.isPlaying()) resumeListening()
      break
  }
}

async function startCall() {
  if (callActive) return
  callActive = true
  updateCallButton()
  $btnCall.disabled = true
  setState('connecting')

  const micReady = await recorder.init()
  if (!micReady) {
    appendError('无法使用麦克风，请允许麦克风权限后重试。')
    callActive = false
    updateCallButton()
    setState('disconnected')
    $btnCall.disabled = false
    return
  }

  recorder.start(handleUtterance, (activity) => {
    if (activity === 'speech' && callActive) setState('listening')
  })
  recorder.setListening(false)
  ws.connect(handleMessage, (connectionState) => {
    if (!callActive) return
    if (connectionState === 'connected') {
      $btnCall.disabled = false
      resumeListening()
    } else {
      pauseListening()
      setState('connecting')
    }
  })
}

async function endCall() {
  if (!callActive) return
  callActive = false
  ws.disconnect()
  player.stopAll()
  await recorder.dispose()
  updateCallButton()
  setState('disconnected')
}

async function init() {
  const ctx = await window.PluginPageContext.ready()
  applyTheme(ctx.isDark)
  window.PluginPageContext.onThemeChange((isDark) => applyTheme(isDark))

  updateCallButton()
  setState('disconnected')
  $btnCall.disabled = false
  $btnCall.addEventListener('click', () => callActive ? endCall() : startCall())
  $btnClear.addEventListener('click', () => {
    if (!callActive) return
    ws.sendControl('clear')
    player.stopAll()
    resumeListening()
  })
  window.addEventListener('beforeunload', () => {
    ws.disconnect()
    recorder.dispose()
  })
}

function applyTheme(isDark) {
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light')
}

init()
