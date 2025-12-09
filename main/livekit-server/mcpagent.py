"""
LiveKit Agent with Official MCP Support for ESP32 Control

This agent uses the official LiveKit MCP integration to control ESP32 devices
via voice commands. It connects to a custom MCP server that communicates with
the MQTT Gateway.
"""

import os
import logging
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
    mcp
)
from livekit.plugins import deepgram, openai, silero

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("esp32-voice-agent")


class ESP32VoiceAgent(Agent):
    """
    Voice agent that can control ESP32 devices through MCP tools.
    
    The agent uses the official LiveKit MCP integration to load tools
    from a custom MCP server that interfaces with the MQTT Gateway.
    """
    
    def __init__(self):
        super().__init__(
            instructions="""
                You are a helpful voice assistant that can control ESP32 IoT devices.
                
                You have access to the following capabilities:
                - Turn lights on/off on ESP32 devices
                - Set LED brightness (0-100%)
                - Change LED colors (red, green, blue, yellow, purple, white, etc.)
                - Adjust device volume
                - Check device status
                
                When the user asks to control a device, use the appropriate tool.
                Always confirm the action after executing it.
                
                Be conversational and friendly. If you're not sure which device to control,
                ask the user for clarification.
            """,
        )
    
    async def on_enter(self):
        """Called when the agent enters the room."""
        logger.info("ESP32 Voice Agent entered the room")
        logger.info("MCP tools from http://localhost:8080/sse should be auto-loaded")

        # Generate initial greeting
        await self.session.generate_reply()


async def entrypoint(ctx: JobContext):
    """
    Main entrypoint for the LiveKit agent.
    
    This function creates an AgentSession with official MCP support,
    connecting to the custom ESP32 MCP server.
    """
    
    # Create agent session with official MCP support
    session = AgentSession(
        # Voice Activity Detection
        vad=silero.VAD.load(),
        
        # Speech-to-Text
        stt=deepgram.STT(),
        
        # Language Model
        llm=openai.LLM(model="gpt-4o"),
        
        # Text-to-Speech
        tts=openai.TTS(),
        
        # ✅ Official MCP Integration via HTTP
        # Connect to the manually running MCP server via HTTP/SSE
        mcp_servers=[
            mcp.MCPServerHTTP(
                url="http://localhost:8080/sse"
            )
        ]
    )
    
    # Start the agent session
    await session.start(agent=ESP32VoiceAgent(), room=ctx.room)
    
    logger.info("ESP32 Voice Agent session started successfully")


if __name__ == "__main__":
    # Run the agent
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
