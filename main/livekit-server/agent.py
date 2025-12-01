#!/usr/bin/env python3
"""
Simple LiveKit Agent with Google Chirp STT
A minimal agent that uses Google Chirp for speech-to-text,
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
from livekit.plugins import groq, silero, google

# Import custom providers
from src.providers.edge_tts_provider import EdgeTTS

# Load environment variables
load_dotenv(".env")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chirp-agent")


class SimpleAssistant(Agent):
    """Simple voice assistant using Google Chirp for STT"""

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

    # Create Google Chirp STT provider
    # Chirp model requires a specific location (not available in "global")
    logger.info("Using Google Chirp STT")
    stt_provider = google.STT(
        model="chirp",
        location="asia-southeast1",  # Chirp is available in us-central1, europe-west4, asia-southeast1
        spoken_punctuation=False,
        
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

    # Create agent session with Google Chirp STT
    session = AgentSession(
        llm=llm,
        stt=stt_provider,
        tts=tts,
        vad=vad,
        allow_interruptions=False,
        
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
    logger.info("Starting agent session with Google Chirp STT...")
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_input_options=RoomInputOptions(audio_sample_rate=16000),
    )

    logger.info("Agent session started successfully!")


if __name__ == "__main__":
    logger.info("Starting Google Chirp Agent...")

    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        num_idle_processes=1,
       
    ))
