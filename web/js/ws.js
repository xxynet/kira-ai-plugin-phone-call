/**
 * WebSocket connection manager for the phone call plugin.
 */

let ws = null
let messageHandler = null
let reconnectTimer = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 10000

/**
 * Connect to the phone call WebSocket endpoint.
 * @param {Function} onMessage - Callback for incoming JSON messages (parsed object).
 * @param {Function} onStatusChange - Callback for connection status changes.
 */
export function connect(onMessage, onStatusChange) {
  messageHandler = onMessage
  _doConnect(onStatusChange)
}

function _doConnect(onStatusChange) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  // Use PluginPageContext.createWebSocket to inject auth token automatically
  ws = window.PluginPageContext.createWebSocket('/call')

  ws.onopen = () => {
    reconnectDelay = 1000
    onStatusChange('connected')
  }

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      try {
        const data = JSON.parse(event.data)
        if (messageHandler) messageHandler(data)
      } catch (_) {
        // ignore non-JSON text frames
      }
    }
  }

  ws.onerror = () => {
    // onerror is always followed by onclose
  }

  ws.onclose = () => {
    onStatusChange('disconnected')
    // Auto-reconnect with exponential backoff
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
      _doConnect(url, onStatusChange)
    }, reconnectDelay)
  }
}

/**
 * Send binary audio data to the server.
 * @param {Blob|ArrayBuffer} data - Audio data.
 */
export function sendAudio(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(data)
}

/**
 * Send a JSON control message.
 * @param {string} type - Message type (e.g. 'audio_end', 'clear').
 */
export function sendControl(type) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type }))
}

/**
 * Check if the WebSocket is currently connected.
 * @returns {boolean}
 */
export function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN
}

/**
 * Disconnect and stop reconnecting.
 */
export function disconnect() {
  clearTimeout(reconnectTimer)
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
}
