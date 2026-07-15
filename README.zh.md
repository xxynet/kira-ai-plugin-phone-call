<div align="center">

# 📞 AI 通话插件

通过浏览器麦克风与 AI 进行实时语音对话。

[English](README.md) | 简体中文

</div>

## 📖 简介

本插件让你能在浏览器中与 AI 进行实时语音通话。按住麦克风按钮说话，松开后自动完成 **语音识别 → AI 推理 → 语音合成** 全链路处理，AI 的语音回复会通过浏览器播放。

可与 KiraAI 中配置的任何 LLM、STT、TTS 提供商配合使用。

> [!NOTE]
> 最终目标是以真正的打电话形式交互。目前采用的是按住说话模式——按住按钮录音，松手发送。真正的双向实时通话将在后续版本中实现。

## ✨ 功能特性

- 🎙️ **按住说话** — 按下按钮录音，松手即发
- 🔄 **全链路流水线** — 语音识别 → AI 推理 → 语音合成一气呵成
- 💬 **对话历史** — 多轮对话上下文自动保持
- 🧑 **角色人格** — 自动加载 KiraAI 已配置的角色设定（persona）
- 🌙 **深色模式** — 跟随 KiraAI WebUI 主题
- 🎛️ **自定义提示词** — 可在插件设置中配置系统提示词
- 🔗 **自动重连** — WebSocket 断线后指数退避自动重连

## 🚀 快速开始

### 启用插件

1. 打开 KiraAI WebUI → **插件**
2. 找到 **AI 通话** 并启用
3. 确保已在 KiraAI 中配置好 **STT（语音识别）** 和 **TTS（语音合成）** 提供商

### 使用

1. 打开 KiraAI WebUI → 侧边栏中的 **通话** 图标
2. 浏览器弹出麦克风权限请求时点击 **允许**
3. **按住** 中间的绿色按钮，对着麦克风说话
4. **松开** — AI 会进行思考，然后用语音回复你

> [!TIP]
> 在 AI 说话时随时可以按住按钮再次说话，AI 会被打断并倾听你的新输入。

## ⚙️ 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `system_prompt` | textarea | *（默认提示词）* | 自定义通话系统提示词，留空使用默认提示 |

**默认系统提示词：**

```
You are in a real-time voice conversation with the user.
Keep your responses concise and natural, as if speaking aloud.
Avoid long paragraphs, bullet points, or markdown formatting.
Be warm, conversational, and to the point.
```

每次连接时，系统会自动追加当前时间和你在 KiraAI 中配置的角色人格（persona）设定。

## 🧠 工作流程

```
用户按住麦克风按钮
       │
       ▼
[MediaRecorder] → WebM/Opus 音频数据（每 250ms 分片）
       │
       ▼  （松开按钮 → 发送 "audio_end"）
[STT] 语音 → 文字
       │
       ▼
[LLM] 构建对话上下文 → AI 推理回复
       │
       ▼
[TTS] 文字 → 语音音频
       │
       ▼
[浏览器] 播放音频 → 一轮对话完成
```

### WebSocket 协议

```
连接 → ws://<host>/api/plugin/phone-call/call

客户端 → 服务器：
  ─ 二进制帧：音频数据块（录音过程中持续发送）
  ─ 文本帧：  {"type": "audio_end"}  — 触发流水线
  ─ 文本帧：  {"type": "clear"}        — 重置对话

服务器 → 客户端（JSON）：
  ─ {"type": "status", "state": "thinking|speaking|idle"}
  ─ {"type": "transcript", "role": "user", "text": "..."}
  ─ {"type": "transcript", "role": "assistant", "text": "..."}
  ─ {"type": "audio", "data": "<base64>", "mime": "audio/mpeg"}
  ─ {"type": "error", "message": "..."}
```

## 🖥️ 前端模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **app.js** | 入口 | 状态管理、DOM 渲染、事件绑定 |
| **ws.js** | WebSocket | 连接管理、自动重连、消息收发 |
| **recorder.js** | 录音 | 浏览器麦克风录制、MediaRecorder 封装 |
| **player.js** | 播放 | TTS 音频队列顺序播放、中断支持 |

## 🔌 后端依赖

插件对接 KiraAI 核心服务：

- `self.ctx.persona_mgr.get_persona()` — 获取角色人格设定
- `self.ctx.llm_api.speech_to_text()` — STT 语音识别
- `self.ctx.get_default_llm_client()` — 获取默认 LLM 客户端
- `self.ctx.llm_api.text_to_speech()` — TTS 语音合成

## 📁 文件结构

```
data/plugins/kira-ai-plugin-phone-call/
├── __init__.py
├── main.py              # FastAPI WebSocket + 流水线逻辑
├── manifest.json
├── schema.json          # 插件配置 schema
├── README.md            # 英文文档
├── README.zh.md         # 本文档（中文）
└── web/
    ├── index.html       # Web UI 入口
    ├── style.css        # 样式
    └── js/
        ├── app.js       # 主入口
        ├── ws.js        # WebSocket 管理器
        ├── recorder.js  # 麦克风录音器
        └── player.js    # 音频播放队列
```

## 🔗 相关链接

- [KiraAI 文档](https://docs.kira-ai.top/zh/)
- [KiraAI GitHub](https://github.com/xxynet/KiraAI)
