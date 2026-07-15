<div align="center">

# 📞 AI Phone Call Plugin

Real-time voice conversation with AI via browser microphone.

English | [简体中文](README.zh.md)

</div>

## 📖 Overview

This plugin enables real-time voice calls with AI in the browser. Hold the microphone button to speak, release to send — the plugin automatically runs the **STT → LLM → TTS** pipeline and plays the AI voice response through your browser.

It works with any LLM, STT, and TTS provider configured in KiraAI.

> [!NOTE]
> The ultimate goal is true phone calling. Currently, it uses push-to-talk mode — hold to speak, release to send. True two-way voice calling will be implemented in a future version.

## ✨ Features

- 🎙️ **Push-to-talk** — hold to speak, release to send
- 🔄 **Full pipeline** — speech recognition → AI reasoning → voice synthesis in one flow
- 💬 **Conversation history** — multi-turn context preserved throughout the call
- 🧑 **Persona support** — automatically loads persona settings from KiraAI
- 🌙 **Dark mode** — follows KiraAI WebUI theme
- 🎛️ **Customizable prompt** — configure the system prompt in plugin settings
- 🔗 **Auto-reconnect** — WebSocket reconnects on disconnect with exponential backoff

## 🚀 Getting Started

### Enable the Plugin

1. Open KiraAI WebUI → **Plugins**
2. Find **AI Phone Call** and enable it
3. Ensure **STT** and **TTS** providers are configured in KiraAI

### Use

1. Open KiraAI WebUI → the **call** icon in the sidebar
2. Click **"Allow"** when the browser asks for microphone permission
3. **Hold** the green center button, speak into your microphone
4. **Release** — the AI will think, then reply with voice

> [!TIP]
> You can interrupt the AI at any time by holding the button and speaking again.

## ⚙️ Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `system_prompt` | textarea | *(default prompt)* | Custom system prompt for the voice call. Leave empty to use the default |

**Default system prompt:**

```
You are in a real-time voice conversation with the user.
Keep your responses concise and natural, as if speaking aloud.
Avoid long paragraphs, bullet points, or markdown formatting.
Be warm, conversational, and to the point.
```

On each connection, the current time and your KiraAI persona are automatically appended to the system prompt.

## 🧠 Pipeline

```
User presses and holds the talk button
       │
       ▼
[MediaRecorder] → WebM/Opus audio chunks (every 250ms)
       │
       ▼  (Release → sends "audio_end")
[STT] Speech → Text
       │
       ▼
[LLM] Build conversation context → AI response
       │
       ▼
[TTS] Text → Speech audio
       │
       ▼
[Browser] Play audio → round-trip complete
```

### WebSocket Protocol

```
Connection → ws://<host>/api/plugin/phone-call/call

Client → Server:
  ─ Binary frame: audio chunk (incremental during recording)
  ─ Text frame:   {"type": "audio_end"}  — trigger pipeline
  ─ Text frame:   {"type": "clear"}        — reset conversation

Server → Client (JSON):
  ─ {"type": "status", "state": "thinking|speaking|idle"}
  ─ {"type": "transcript", "role": "user", "text": "..."}
  ─ {"type": "transcript", "role": "assistant", "text": "..."}
  ─ {"type": "audio", "data": "<base64>", "mime": "audio/mpeg"}
  ─ {"type": "error", "message": "..."}
```

## 🖥️ Frontend Modules

| Module | File | Responsibility |
|--------|------|----------------|
| **app.js** | Entry | State management, DOM rendering, event binding |
| **ws.js** | WebSocket | Connection management, auto-reconnect, messaging |
| **recorder.js** | Recorder | Microphone capture, MediaRecorder wrapper |
| **player.js** | Player | TTS audio queue playback, interrupt support |

## 🔌 Backend Dependencies

The plugin integrates with KiraAI core services:

- `self.ctx.persona_mgr.get_persona()` — load character persona
- `self.ctx.llm_api.speech_to_text()` — STT recognition
- `self.ctx.get_default_llm_client()` — default LLM client
- `self.ctx.llm_api.text_to_speech()` — TTS synthesis

## 📁 File Structure

```
data/plugins/kira-ai-plugin-phone-call/
├── __init__.py
├── main.py              # FastAPI WebSocket + pipeline logic
├── manifest.json
├── schema.json          # Plugin config schema
├── README.md            # This file (English)
├── README.zh.md         # Chinese documentation
└── web/
    ├── index.html       # Web UI entry
    ├── style.css        # UI styles
    └── js/
        ├── app.js       # Main entry point
        ├── ws.js        # WebSocket manager
        ├── recorder.js  # Microphone recorder
        └── player.js    # Audio playback queue
```

## 🔗 Related

- [KiraAI Documentation](https://docs.kira-ai.top)
- [KiraAI GitHub](https://github.com/xxynet/KiraAI)
