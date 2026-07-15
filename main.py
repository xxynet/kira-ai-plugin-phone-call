import base64
import json
from datetime import datetime

from fastapi import WebSocket, WebSocketDisconnect

from core.plugin import BasePlugin, PluginPage, PageMenu, logger, register
from core.provider import LLMRequest
from core.agent.message import OpenAIMessage
from core.chat.message_elements import Record


DEFAULT_VOICE_CALL_PROMPT = (
    "You are in a real-time voice conversation with the user. "
    "Keep your responses concise and natural, as if speaking aloud. "
    "Avoid long paragraphs, bullet points, or markdown formatting. "
    "Be warm, conversational, and to the point."
)


class PhoneCallPlugin(BasePlugin):
    def __init__(self, ctx, cfg: dict):
        super().__init__(ctx, cfg)

    async def initialize(self):
        logger.info("[phone-call] plugin initialized")

    async def terminate(self):
        logger.info("[phone-call] plugin terminated")

    # ── WebSocket endpoint ──────────────────────────────────────────────

    @register.ws("/call", auth=True)
    async def ws_call(self, ws: WebSocket):
        """Real-time voice call WebSocket endpoint."""
        await ws.accept()
        logger.info("[phone-call] client connected")

        # Per-connection conversation state
        conversation: list[OpenAIMessage] = []
        audio_buffer = bytearray()

        # Build system prompt
        custom_prompt = self.plugin_cfg.get("system_prompt")
        system_text = custom_prompt if custom_prompt else DEFAULT_VOICE_CALL_PROMPT

        # Append current time (following core/prompt_manager.py pattern)
        formatted_time = datetime.now().strftime("%b %d %Y %H:%M %a")
        system_text += f"\n\nCurrent date and time: {formatted_time}"

        # Try to load the configured persona
        try:
            persona = await self.ctx.persona_mgr.get_persona()
            if persona and persona.content:
                system_text = f"{system_text}\n\nThe following is your character setting:\n{persona.content}"
        except Exception as e:
            logger.warning(f"[phone-call] failed to load persona: {e}")

        try:
            while True:
                message = await ws.receive()

                # ── Binary frame: audio chunk from browser ──
                if "bytes" in message and message["bytes"]:
                    audio_buffer.extend(message["bytes"])

                # ── Text frame: JSON control message ──
                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type")

                    # ── audio_end: user finished speaking, run pipeline ──
                    if msg_type == "audio_end":
                        if not audio_buffer:
                            await self._send_json(ws, {
                                "type": "error",
                                "message": "No audio data received"
                            })
                            continue

                        await self._run_pipeline(ws, audio_buffer, conversation, system_text)
                        audio_buffer = bytearray()

                    # ── clear: reset conversation ──
                    elif msg_type == "clear":
                        conversation.clear()
                        audio_buffer = bytearray()
                        await self._send_json(ws, {"type": "cleared"})
                        logger.info("[phone-call] conversation cleared")

        except WebSocketDisconnect:
            logger.info("[phone-call] client disconnected")
        except Exception as e:
            logger.error(f"[phone-call] websocket error: {e}")
            try:
                await ws.close()
            except Exception:
                pass

    # ── Pipeline: STT → LLM → TTS ──────────────────────────────────────

    async def _run_pipeline(
        self,
        ws: WebSocket,
        audio_data: bytearray,
        conversation: list[OpenAIMessage],
        system_text: str,
    ):
        # 1) STT: speech → text
        await self._send_json(ws, {"type": "status", "state": "thinking"})

        try:
            audio_b64 = base64.b64encode(bytes(audio_data)).decode("utf-8")
            record = Record(record=f"data:audio/webm;base64,{audio_b64}")
            user_text = await self.ctx.llm_api.speech_to_text(record)
        except Exception as e:
            logger.error(f"[phone-call] STT error: {e}")
            await self._send_json(ws, {
                "type": "error",
                "message": f"Speech recognition failed: {e}"
            })
            return

        if not user_text or not user_text.strip():
            await self._send_json(ws, {
                "type": "transcript",
                "role": "user",
                "text": "(no speech detected)"
            })
            return

        logger.info(f"[phone-call] user said: {user_text}")
        await self._send_json(ws, {
            "type": "transcript",
            "role": "user",
            "text": user_text
        })

        # 2) LLM: text → response
        conversation.append(OpenAIMessage(role="user", content=user_text))

        try:
            llm_client = self.ctx.get_default_llm_client()
            if not llm_client:
                raise ValueError("Default LLM model not configured")

            request = LLMRequest(
                messages=[OpenAIMessage(role="system", content=system_text)] + conversation,
                tool_choice="none",
            )
            response = await llm_client.chat(request)
            assistant_text = response.text_response or ""
        except Exception as e:
            logger.error(f"[phone-call] LLM error: {e}")
            await self._send_json(ws, {
                "type": "error",
                "message": f"AI response failed: {e}"
            })
            # Remove the user message we just added since we got no response
            if conversation and conversation[-1].role == "user":
                conversation.pop()
            return

        if not assistant_text.strip():
            assistant_text = "..."

        conversation.append(OpenAIMessage(role="assistant", content=assistant_text))
        logger.info(f"[phone-call] AI said: {assistant_text}")

        await self._send_json(ws, {
            "type": "transcript",
            "role": "assistant",
            "text": assistant_text
        })

        # 3) TTS: text → speech
        await self._send_json(ws, {"type": "status", "state": "speaking"})

        try:
            tts_record = await self.ctx.llm_api.text_to_speech(assistant_text)
            if tts_record:
                audio_b64 = await tts_record.to_base64()
                mime = tts_record.mime or "audio/mpeg"
                await self._send_json(ws, {
                    "type": "audio",
                    "data": audio_b64,
                    "mime": mime,
                })
            else:
                logger.warning("[phone-call] TTS returned empty result")
        except Exception as e:
            logger.error(f"[phone-call] TTS error: {e}")
            await self._send_json(ws, {
                "type": "error",
                "message": f"Speech synthesis failed: {e}"
            })

        # 4) Done — back to idle
        await self._send_json(ws, {"type": "status", "state": "idle"})

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    async def _send_json(ws: WebSocket, data: dict):
        try:
            await ws.send_text(json.dumps(data, ensure_ascii=False))
        except Exception:
            pass

    # ── Web UI page ─────────────────────────────────────────────────────

    @register.page(
        "/call",
        auth=True,
        menu=PageMenu(
            label={"zh": "AI 通话", "en": "AI Phone Call"},
            icon="Phone",
            order=100,
        ),
    )
    def page_call(self):
        return PluginPage.from_folder("./web")
