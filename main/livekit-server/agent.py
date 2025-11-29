#!/usr/bin/env python3
"""
Simple LiveKit Agent with FunASR STT
A minimal agent that uses FunASR WebSocket server for speech-to-text,
Groq LLM, and Edge TTS
"""

import logging
import os
from dotenv import load_dotenv

from livekit.agents import (
    AgentSession,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    Agent,
    RoomInputOptions,
)
from livekit.agents.llm import ChatContext
from livekit.plugins import groq, silero

# Import custom providers
from src.providers.funasr_stt_provider import FunASRSTT
from src.providers.edge_tts_provider import EdgeTTS

# Load environment variables
load_dotenv(".env")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("funasr-agent")


class SimpleAssistant(Agent):
    """Simple voice assistant using FunASR for STT"""

    def __init__(self) -> None:
        super().__init__(
            instructions="""You are a helpful voice assistant.
            Keep your responses brief and conversational.
            Speak naturally as if talking to a friend."""
        )


def prewarm(proc: JobProcess):
    """Prewarm function - load models before accepting jobs"""
    logger.info("Prewarming agent - loading Silero VAD model with child-optimized settings...")
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.1,      # 0.1s speech - kids speak in short bursts
        min_silence_duration=1.2,     # 1.2s silence - kids pause while thinking
        activation_threshold=0.08,    # Ultra-low threshold for quiet kid voices
        prefix_padding_duration=0.3,  # Capture speech start
        max_buffered_speech=60.0,     # Maximum speech buffer
    )
    logger.info("Silero VAD model loaded with child-optimized settings (threshold=0.08, silence=1.2s)")


async def entrypoint(ctx: JobContext):
    """Main entrypoint for the agent"""
    logger.info(f"Agent connecting to room: {ctx.room.name}")

    # Wait for a participant to join
    await ctx.connect()
    logger.info("Connected to room, waiting for participant...")

    # Get FunASR configuration from environment
    funasr_host = os.getenv("FUNASR_HOST", "64.227.121.147")
    funasr_port = int(os.getenv("FUNASR_PORT", "10096"))
    funasr_mode = os.getenv("FUNASR_MODE", "2pass")
    stt_language = os.getenv("STT_LANGUAGE", "en")

    logger.info(f"FunASR Config: host={funasr_host}, port={funasr_port}, mode={funasr_mode}")

    # Test FunASR connection before using it
    stt_provider = None
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)  # 3 second timeout
        result = sock.connect_ex((funasr_host, funasr_port))
        sock.close()

        if result == 0:
            logger.info(f"FunASR server reachable at {funasr_host}:{funasr_port}")
            stt_provider = FunASRSTT(
                host=funasr_host,
                port=funasr_port,
                use_ssl=False,
                mode=funasr_mode,
                language=stt_language,
                use_itn=True,
            )
        else:
            logger.warning(f"FunASR not reachable at {funasr_host}:{funasr_port}")
    except Exception as e:
        logger.warning(f"Error checking FunASR: {e}")

    # Fallback to Groq STT if FunASR not available
    if stt_provider is None:
        logger.info("Using Groq STT as fallback")
        stt_provider = groq.STT(
            model=os.getenv("STT_MODEL", "whisper-large-v3-turbo"),
            language=stt_language,
        )

    # Create LLM (using Groq)
    llm = groq.LLM(model=os.getenv("LLM_MODEL", "llama-3.1-8b-instant"))

    # Create TTS (using Edge TTS - free, fast, high quality)
    tts = EdgeTTS(
        voice=os.getenv("EDGE_TTS_VOICE", "en-US-AnaNeural"),
        rate=os.getenv("EDGE_TTS_RATE", "+0%"),
        volume=os.getenv("EDGE_TTS_VOLUME", "+0%"),
        pitch=os.getenv("EDGE_TTS_PITCH", "+0Hz"),
    )
    logger.info(f"Using Edge TTS with voice: {os.getenv('EDGE_TTS_VOICE', 'en-US-AnaNeural')}")

    # Get prewarmed VAD
    vad = ctx.proc.userdata.get("vad")
    if not vad:
        logger.warning("VAD not prewarmed, loading Silero VAD now...")
        vad = silero.VAD.load(
            min_speech_duration=0.1,      # 0.1s speech - kids speak in short bursts
            min_silence_duration=1.2,     # 1.2s silence - kids pause while thinking
            activation_threshold=0.08,    # Ultra-low threshold for quiet kid voices
            prefix_padding_duration=0.3,
            max_buffered_speech=60.0,
        )

    # Create the assistant
    assistant = SimpleAssistant()

    # Create agent session with STT provider (FunASR or Groq fallback)
    session = AgentSession(
        llm=llm,
        stt=stt_provider,
        tts=tts,
        vad=vad,
    )

    # Setup event handlers
    @session.on("user_input_transcribed")
    def on_user_input(event):
        """Handle transcribed user input"""
        transcript = getattr(event, 'transcript', None) or getattr(event, 'text', '')
        if transcript:
            logger.info(f"User said: {transcript}")

    @session.on("agent_speech_committed")
    def on_agent_speech(event):
        """Handle agent speech"""
        text = getattr(event, 'content', None) or getattr(event, 'text', '')
        if text:
            logger.info(f"Agent said: {text[:100]}...")

    # Start the session
    stt_name = "FunASR" if isinstance(stt_provider, FunASRSTT) else "Groq"
    logger.info(f"Starting agent session with {stt_name} STT...")
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_input_options=RoomInputOptions(audio_sample_rate=16000),
    )

    logger.info("Agent session started successfully!")


if __name__ == "__main__":
    logger.info("Starting FunASR Agent...")
    logger.info(f"FunASR Host: {os.getenv('FUNASR_HOST', '64.227.121.147')}")
    logger.info(f"FunASR Port: {os.getenv('FUNASR_PORT', '10096')}")

    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        num_idle_processes=1,
       
    ))
