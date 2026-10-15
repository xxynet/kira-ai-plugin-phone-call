<div align="center">

# 📞 AI Phone Call Plugin

Real-time voice conversation with AI via browser microphone.

English | [简体中文](README.zh.md)

</div>

## 📖 Overview

This plugin enables hands-free voice calls with AI in the browser. Click the call button and speak naturally after the call connects. Browser-side voice activity detection automatically finds utterance boundaries, runs the **STT → LLM → TTS** pipeline, and resumes listening after the AI finishes speaking.

It works with any LLM, STT, and TTS provider configured in KiraAI.

> [!NOTE]
> The current mode is automatic turn-taking: recording pauses while the AI is thinking or speaking so speaker output is not recognized as user speech. Full-duplex interruption may be added later.

## ✨ Features

- 📞 **Hands-free calls** — automatic speech and silence detection after dialing
- 🔇 **Echo protection** — listening pauses during AI playback and resumes automatically
- 🔄 **Full pipeline** — speech recognition → AI reasoning → voice synthesis in one flow
- 💬 **Conversation history** — multi-turn context preserved throughout the call
- 🧑 **Persona contact** — shows the active persona name and reference image; uses an initial when no image is available
- 🎚️ **Call controls** — call timer, microphone mute, reply-audio toggle, and collapsible captions
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
2. Click the green **call** button
3. Click **Allow** when the browser asks for microphone permission
4. Speak after the call connects; about 0.8 seconds of silence submits the utterance automatically
5. Continue speaking after the AI reply, or click the red button to hang up
6. Use **Mute**, **Speaker**, and **Captions** to control microphone capture, reply-audio playback, and the transcript. The speaker button toggles sound; it does not select an audio output device.

The contact name and avatar are read from the active persona when the page opens and before each call. The reference image downloads separately, so a slow or unavailable avatar does not block dialing. Without a reference image, the avatar shows the first character of the persona name. The page follows the WebUI language and theme.

> [!TIP]
> A relatively quiet environment works best. Continuous background noise can affect automatic utterance detection.

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
User clicks call and the connection opens
       │
       ▼
[Browser VAD] Continuously detects user speech
       │
       ▼  (About 0.8 seconds of silence)
[MediaRecorder] → WebM/Opus utterance → sends "audio_end"
       │
       ▼
[STT] Speech → Text
       │
       ▼
[LLM] Build conversation context → AI response
       │
       ▼
[TTS] Text → Speech audio
       │
       ▼
[Browser] Play audio → automatically resume listening
```

### WebSocket Protocol

```
Connection → ws://<host>/ws/plugin/kira-ai-plugin-phone-call/call

Client → Server:
  ─ Binary frame: complete VAD-segmented WebM/Opus utterance
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
| **recorder.js** | Recorder | Microphone capture, browser VAD, automatic segmentation |
| **persona.js** | Contact | Active persona name and authenticated reference-image loading |
| **i18n.js** | Language | Chinese and English UI strings |
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
├── assets/              # Sidebar phone icon
├── tests/test_web.mjs   # Frontend behavior checks
├── README.md            # This file (English)
├── README.zh.md         # Chinese documentation
└── web/
    ├── index.html       # Web UI entry
    ├── style.css        # UI styles
    ├── icons.svg        # Lucide icon symbols
    └── js/
        ├── app.js       # Main entry point
        ├── ws.js        # WebSocket manager
        ├── recorder.js  # Microphone recorder
        ├── persona.js   # Contact metadata and reference image
        ├── i18n.js      # Chinese and English UI strings
        └── player.js    # Audio playback queue
```

## Verification

Run the frontend behavior checks with Node.js 18 or later:

```bash
node --test tests/test_web.mjs
```

The tests mock media devices and HTTP responses. They cover UI translation keys, persona authentication and image loading, reply-audio mute, and microphone disposal without accessing real microphones or AI providers.

## 🔗 Related

- [KiraAI Documentation](https://docs.kira-ai.top)
- [KiraAI GitHub](https://github.com/xxynet/KiraAI)

Persona requests use the current session cookie first. For sessions that only have a stored Bearer token, the plugin retries with that token after a 401 response; this prevents a stale token from another port from overriding a valid cookie.

The page uses locally bundled Lucide SVG icons.
