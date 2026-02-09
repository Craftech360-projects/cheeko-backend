"""
Custom MQTT-driven STT -> LLM -> TTS Pipeline (Standalone)

Subscribes to `internal/server-ingest` (shared with mqtt-gateway).
Filters for messages with orginal_payload.type == "pipeline_request".
Processes: Deepgram STT -> Groq LLM -> ElevenLabs TTS.
Publishes pipeline_audio response back to `internal/server-ingest`
for the gateway to stream to the ESP32 device via UDP.

Usage:
    cd main/livekit-server
    python custom_pipeline.py
"""

import asyncio
import base64
import json
import logging
import os
import uuid
from pathlib import Path

import yaml
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).parent
load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("custom_pipeline")

# ---------------------------------------------------------------------------
# Config (read config.yaml directly — no src/ imports)
# ---------------------------------------------------------------------------
config_path = PROJECT_ROOT / "config.yaml"
with open(config_path, "r", encoding="utf-8") as f:
    yaml_config = yaml.safe_load(f)

api_keys = yaml_config.get("api_keys", {})
mqtt_cfg = yaml_config.get("mqtt", {})
elevenlabs_cfg = yaml_config.get("elevenlabs", {})
groq_cfg = yaml_config.get("groq", {})

MQTT_HOST = os.getenv("MQTT_HOST", mqtt_cfg.get("host", "localhost"))
MQTT_PORT = int(os.getenv("MQTT_PORT", mqtt_cfg.get("port", 1883)))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", mqtt_cfg.get("username", ""))
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", mqtt_cfg.get("password", ""))

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", api_keys.get("deepgram", ""))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", api_keys.get("groq", ""))
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", api_keys.get("elevenlabs", ""))

GROQ_MODEL = groq_cfg.get("model", "llama-3.3-70b-versatile")
GROQ_TEMPERATURE = groq_cfg.get("temperature", 0.6)

ELEVENLABS_VOICE_ID = elevenlabs_cfg.get("voice_id", "ODq5zmih8GrVes37Dizd")
ELEVENLABS_TTS_MODEL = elevenlabs_cfg.get("tts_model", "eleven_flash_v2_5")

SUBSCRIBE_TOPIC = "internal/server-ingest"

SYSTEM_PROMPT = (
    "You are Cheeko, a helpful AI buddy. "
    "Answer based on the context provided. "
    "If the audio transcript is unclear, use the context to understand the intent."
)


# ---------------------------------------------------------------------------
# Deepgram STT (REST / pre-recorded)
# ---------------------------------------------------------------------------
async def transcribe_audio(
    audio_bytes: bytes,
    sample_rate: int = 16000,
    audio_format: str = "opus",
) -> str:
    import aiohttp

    mime_map = {
        "opus": "audio/ogg",
        "ogg": "audio/ogg",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "pcm": "audio/l16",
    }
    content_type = mime_map.get(audio_format, "audio/ogg")

    url = "https://api.deepgram.com/v1/listen"
    params = {
        "model": "nova-3",
        "language": "en",
        "smart_format": "true",
        "sample_rate": str(sample_rate),
    }
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": content_type,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                params=params,
                headers=headers,
                data=audio_bytes,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error(f"Deepgram STT failed ({resp.status}): {error_text}")
                    return ""
                data = await resp.json()
                transcript = (
                    data.get("results", {})
                    .get("channels", [{}])[0]
                    .get("alternatives", [{}])[0]
                    .get("transcript", "")
                )
                logger.info(f"STT transcript: {transcript[:120]}")
                return transcript
    except Exception as e:
        logger.error(f"Deepgram STT error: {e}")
        return ""


# ---------------------------------------------------------------------------
# Groq LLM (OpenAI-compatible)
# ---------------------------------------------------------------------------
async def generate_llm_response(context: str, transcript: str) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=GROQ_API_KEY,
    )

    user_content = f"Context: {context}\n\nUser said: {transcript}"

    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=GROQ_TEMPERATURE,
            max_tokens=1024,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        text = response.choices[0].message.content or ""
        logger.info(f"LLM response ({len(text)} chars): {text[:120]}")
        return text
    except Exception as e:
        logger.error(f"Groq LLM error: {e}")
        return "Sorry, I couldn't think of a response right now. Can you try again?"


# ---------------------------------------------------------------------------
# ElevenLabs TTS -> PCM 24kHz 16-bit mono
# ---------------------------------------------------------------------------
async def synthesize_speech(text: str) -> bytes:
    from elevenlabs import AsyncElevenLabs

    client = AsyncElevenLabs(api_key=ELEVENLABS_API_KEY)

    try:
        audio_iterator = await client.text_to_speech.convert(
            voice_id=ELEVENLABS_VOICE_ID,
            text=text,
            model_id=ELEVENLABS_TTS_MODEL,
            output_format="pcm_24000",
        )

        chunks = []
        async for chunk in audio_iterator:
            chunks.append(chunk)
        audio_bytes = b"".join(chunks)
        logger.info(f"TTS audio: {len(audio_bytes)} bytes (pcm_24000)")
        return audio_bytes
    except Exception as e:
        logger.error(f"ElevenLabs TTS error: {e}")
        return b""


# ---------------------------------------------------------------------------
# Extract MAC from sender_client_id
# ---------------------------------------------------------------------------
def extract_mac_from_client_id(client_id: str) -> str:
    """
    sender_client_id format: "GID_test@@@aa_bb_cc_dd_ee_ff@@@uuid"
    Returns MAC with colons: "aa:bb:cc:dd:ee:ff"
    """
    parts = client_id.split("@@@")
    if len(parts) >= 2:
        mac_underscored = parts[1]
        return mac_underscored.replace("_", ":")
    return ""


# ---------------------------------------------------------------------------
# Pipeline orchestrator
# ---------------------------------------------------------------------------
async def process_pipeline_request(
    sender_client_id: str,
    payload: dict,
    mqtt_client,
) -> None:
    request_id = payload.get("request_id", str(uuid.uuid4()))
    context = payload.get("context", "")
    audio_b64 = payload.get("audio", "")
    audio_format = payload.get("audio_format", "opus")
    sample_rate = payload.get("sample_rate", 16000)

    mac = extract_mac_from_client_id(sender_client_id)
    logger.info(f"[{request_id}] Processing pipeline_request from {mac}")

    # Decode audio
    try:
        audio_bytes = base64.b64decode(audio_b64)
        logger.info(f"[{request_id}] Decoded audio: {len(audio_bytes)} bytes")
    except Exception as e:
        logger.error(f"[{request_id}] Failed to decode audio: {e}")
        return

    # STT
    transcript = await transcribe_audio(audio_bytes, sample_rate, audio_format)
    if not transcript or not transcript.strip():
        logger.warning(f"[{request_id}] Empty transcript, skipping")
        return

    # LLM
    llm_response = await generate_llm_response(context, transcript)
    if not llm_response.strip():
        logger.warning(f"[{request_id}] Empty LLM response, skipping")
        return

    # TTS
    audio_response = await synthesize_speech(llm_response)
    if not audio_response:
        logger.warning(f"[{request_id}] TTS returned no audio, skipping")
        return

    # Publish response back to internal/server-ingest
    response = {
        "sender_client_id": sender_client_id,
        "orginal_payload": {
            "type": "pipeline_audio",
            "mac": mac,
            "text": llm_response,
            "audio": base64.b64encode(audio_response).decode("utf-8"),
            "sample_rate": 24000,
            "request_id": request_id,
        },
    }

    await mqtt_client.publish(
        SUBSCRIBE_TOPIC,
        json.dumps(response).encode("utf-8"),
    )
    logger.info(
        f"[{request_id}] Pipeline complete — published pipeline_audio "
        f"({len(audio_response)} PCM bytes) for {mac}"
    )


# ---------------------------------------------------------------------------
# MQTT main loop
# ---------------------------------------------------------------------------
async def main() -> None:
    import aiomqtt

    logger.info("=" * 60)
    logger.info("Custom Pipeline Service starting")
    logger.info(f"  MQTT broker:  {MQTT_HOST}:{MQTT_PORT}")
    logger.info(f"  Subscribe:    {SUBSCRIBE_TOPIC}")
    logger.info(f"  Groq model:   {GROQ_MODEL}")
    logger.info(f"  ElevenLabs:   voice={ELEVENLABS_VOICE_ID}, model={ELEVENLABS_TTS_MODEL}")
    logger.info(f"  Deepgram:     nova-3")
    logger.info("=" * 60)

    # Validate API keys
    missing = []
    if not DEEPGRAM_API_KEY:
        missing.append("DEEPGRAM_API_KEY")
    if not GROQ_API_KEY:
        missing.append("GROQ_API_KEY")
    if not ELEVENLABS_API_KEY:
        missing.append("ELEVENLABS_API_KEY")
    if missing:
        logger.error(
            f"Missing API keys: {', '.join(missing)}. "
            "Check .env or config.yaml api_keys section."
        )
        return

    while True:
        try:
            async with aiomqtt.Client(
                hostname=MQTT_HOST,
                port=MQTT_PORT,
                username=MQTT_USERNAME or None,
                password=MQTT_PASSWORD or None,
                identifier=f"custom_pipeline_{uuid.uuid4().hex[:8]}",
            ) as client:
                await client.subscribe(SUBSCRIBE_TOPIC)
                logger.info(f"Connected to MQTT and subscribed to {SUBSCRIBE_TOPIC}")

                async for message in client.messages:
                    try:
                        raw = json.loads(message.payload.decode("utf-8"))

                        # EMQX republish envelope
                        sender_client_id = raw.get("sender_client_id", "")
                        original_payload = raw.get("orginal_payload", {})

                        # Only handle pipeline_request — skip everything else
                        if original_payload.get("type") != "pipeline_request":
                            continue

                        logger.info(
                            f"Received pipeline_request from {sender_client_id}"
                        )
                        asyncio.create_task(
                            process_pipeline_request(
                                sender_client_id, original_payload, client
                            )
                        )

                    except json.JSONDecodeError as e:
                        logger.error(f"Invalid JSON payload: {e}")
                    except Exception as e:
                        logger.error(f"Error handling message: {e}")

        except Exception as e:
            logger.error(f"MQTT connection error: {e}. Reconnecting in 5s...")
            await asyncio.sleep(5)


if __name__ == "__main__":
    # Windows requires SelectorEventLoop for aiomqtt (add_reader/add_writer support)
    import sys
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Pipeline service stopped by user")
