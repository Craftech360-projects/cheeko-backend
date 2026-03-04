"""
Realtime Model Factory

Creates a Google Gemini RealtimeModel for voice interaction.

Usage:
    from src.utils.realtime_factory import create_realtime_model
    realtime_model, audio_sample_rate = create_realtime_model(
        instructions=agent_prompt,
        enable_google_search=True,
    )
"""

import logging
from src.config.config_loader import ConfigLoader

logger = logging.getLogger(__name__)


def create_realtime_model(instructions: str, enable_google_search: bool = False):
    """Create a Gemini RealtimeModel.

    Args:
        instructions: The system prompt / instructions for the model.
        enable_google_search: Whether to enable Google Search tool.

    Returns:
        Tuple of (realtime_model, audio_sample_rate, provider_tools).
        provider_tools is a list of provider-specific tools (e.g. GoogleSearch)
        that must be added to AgentSession(tools=...).
    """
    from livekit.plugins import google

    realtime_config = ConfigLoader.get_gemini_realtime_config()
    provider_tools = []

    model_kwargs = {
        'model': realtime_config['model'],
        'voice': realtime_config['voice'],
        'instructions': instructions,
        'temperature': realtime_config['temperature'],
        'modalities': ["AUDIO"],
    }

    if enable_google_search:
        provider_tools.append(google.tools.GoogleSearch())

    model = google.realtime.RealtimeModel(**model_kwargs)
    sample_rate = 16000
    logger.info(f"Gemini Realtime model created (model={realtime_config['model']}, voice={realtime_config['voice']})")
    return model, sample_rate, provider_tools
