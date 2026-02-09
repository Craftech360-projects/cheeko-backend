"""
Realtime Model Factory

Creates the appropriate RealtimeModel (Google Gemini or AWS Nova Sonic)
based on the REALTIME_PROVIDER config setting.

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
    """Create a RealtimeModel based on REALTIME_PROVIDER config.

    Args:
        instructions: The system prompt / instructions for the model.
        enable_google_search: Whether to enable Google Search tool (Gemini only).

    Returns:
        Tuple of (realtime_model, audio_sample_rate).
    """
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    provider = realtime_config.get('provider', 'gemini')

    if provider == 'aws':
        from livekit.plugins import aws
        aws_config = ConfigLoader.get_aws_realtime_config()

        model = aws.realtime.RealtimeModel.with_nova_sonic_2(
            voice=aws_config['voice'],
            tool_choice=aws_config['tool_choice'],
            max_tokens=aws_config['max_tokens'],
            region=aws_config['region'],
            turn_detection=aws_config['turn_detection'],
        )
        sample_rate = 24000  # Nova Sonic requires 24kHz
        logger.info(f"AWS Nova Sonic model created (voice={aws_config['voice']}, region={aws_config['region']})")
        return model, sample_rate

    else:  # default: gemini
        from livekit.plugins import google

        model_kwargs = {
            'model': realtime_config['model'],
            'voice': realtime_config['voice'],
            'instructions': instructions,
            'temperature': realtime_config['temperature'],
            'modalities': ["AUDIO"],
        }

        if enable_google_search:
            google_search_tool = google.tools.GoogleSearch()
            model_kwargs['_gemini_tools'] = [google_search_tool]

        model = google.realtime.RealtimeModel(**model_kwargs)
        sample_rate = 16000
        logger.info(f"Gemini Realtime model created (model={realtime_config['model']}, voice={realtime_config['voice']})")
        return model, sample_rate
