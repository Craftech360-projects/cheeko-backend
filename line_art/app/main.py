import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles

from app.models import ProgressMessage, TranscriptionMessage, ResultMessage, ErrorMessage, TextInput
from app.image_gen import generate_line_art
from app.stt import transcribe

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HF_TOKEN = os.environ.get("HF_TOKEN")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("GROQ_API_KEY"):
        logger.warning("GROQ_API_KEY not set. Audio transcription will fail.")
    logger.info("Server ready. Using Groq Whisper API for STT.")
    yield


app = FastAPI(title="Line Art Generator", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


async def send_json(ws: WebSocket, msg):
    await ws.send_text(msg.model_dump_json())


async def handle_text_input(ws: WebSocket, subject: str):
    """Process text subject -> line art image."""
    subject = subject.strip()
    if not subject:
        await send_json(ws, ErrorMessage(stage="input", message="Empty text input."))
        return

    logger.info("Text input received: '%s'", subject)
    await send_json(ws, ProgressMessage(stage="generating", message=f"Generating line art for '{subject}'..."))

    try:
        image_data_uri, prompt_used, raw_mono, height = await generate_line_art(subject, HF_TOKEN)
        raw_size = len(raw_mono) * 3 // 4  # approx decoded size
        logger.info("Image generated: 384x%d, raw mono ~%d bytes", height, raw_size)
        await send_json(ws, ResultMessage(image=image_data_uri, prompt_used=prompt_used, raw_mono=raw_mono, height=height))
    except Exception as e:
        logger.exception("Image generation failed")
        await send_json(ws, ErrorMessage(stage="image_gen", message=str(e)))


async def handle_audio_input(ws: WebSocket, audio_bytes: bytes):
    """Process audio -> transcription -> line art image."""
    MAX_AUDIO_SIZE = 10 * 1024 * 1024  # ~10MB
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        await send_json(ws, ErrorMessage(stage="input", message="Audio too large. Keep recordings under 10 seconds."))
        return

    logger.info("Audio received: %d bytes (%.1f KB)", len(audio_bytes), len(audio_bytes) / 1024)
    await send_json(ws, ProgressMessage(stage="stt", message="Transcribing audio..."))

    try:
        text = await transcribe(audio_bytes)
    except Exception as e:
        logger.exception("Transcription failed")
        await send_json(ws, ErrorMessage(stage="stt", message=f"Transcription failed: {e}"))
        return

    if not text:
        logger.warning("STT returned empty transcription")
        await send_json(ws, ErrorMessage(stage="stt", message="Could not transcribe any speech from audio."))
        return

    logger.info("Transcription result: '%s'", text)
    await send_json(ws, TranscriptionMessage(text=text))
    await handle_text_input(ws, text)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "line-art-generator"}


@app.post("/generate")
async def generate_endpoint(
    file: UploadFile = File(None),
    text: str = Form(None),
):
    """Generate line art from audio (WAV) or text input.

    Provide either:
    - `file`: WAV audio file (will be transcribed via Groq Whisper, then used as prompt)
    - `text`: Direct text prompt (e.g., "cat")

    Returns JSON with transcription, raw_mono bitmap (base64), width, and height.
    """
    if not file and not text:
        raise HTTPException(status_code=400, detail="Provide either 'file' (WAV audio) or 'text'")

    transcription = text
    if file:
        audio_bytes = await file.read()
        if len(audio_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio too large. Keep recordings under 10 seconds.")

        logger.info("HTTP /generate: audio received (%d bytes)", len(audio_bytes))
        try:
            transcription = await transcribe(audio_bytes)
        except Exception as e:
            logger.exception("Transcription failed")
            raise HTTPException(status_code=422, detail=f"Transcription failed: {e}")

        if not transcription:
            raise HTTPException(status_code=422, detail="Could not transcribe any speech from audio.")

    transcription = transcription.strip()
    if not transcription:
        raise HTTPException(status_code=400, detail="Empty text input.")

    logger.info("HTTP /generate: generating for '%s'", transcription)
    try:
        image_data_uri, prompt_used, raw_mono, height = await generate_line_art(transcription, HF_TOKEN)
    except Exception as e:
        logger.exception("Image generation failed")
        raise HTTPException(status_code=500, detail=f"Image generation failed: {e}")

    return {
        "transcription": transcription,
        "raw_mono": raw_mono,
        "width": 384,
        "height": height,
        "prompt_used": prompt_used,
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket connected")

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.receive":
                if "text" in message:
                    try:
                        data = json.loads(message["text"])
                        parsed = TextInput(**data)
                        await handle_text_input(ws, parsed.text)
                    except (json.JSONDecodeError, ValueError) as e:
                        await send_json(ws, ErrorMessage(stage="input", message=f"Invalid message: {e}"))

                elif "bytes" in message:
                    await handle_audio_input(ws, message["bytes"])

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
