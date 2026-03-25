"""
Factory for creating LiveKit realtime models from multiple providers.
Supports: Google Gemini (default), OpenAI, xAI Grok
"""

import os
from src.utils.loki_agent_logger import logger

# LiveKit plugins MUST be imported at module level (main thread)
# because Plugin.register_plugin() requires main thread registration.
# Lazy imports inside functions cause RuntimeError in worker threads.
try:
    from livekit.plugins import google as google_plugin
except ImportError:
    google_plugin = None

try:
    from livekit.plugins import openai as openai_plugin
except ImportError:
    openai_plugin = None

try:
    from livekit.plugins import xai as xai_plugin
except ImportError:
    xai_plugin = None


def create_realtime_model(realtime_config: dict, instructions: str):
    """
    Create a realtime model and provider-specific tools based on config.

    Args:
        realtime_config: Dict from ConfigLoader.get_realtime_config()
        instructions: System prompt / agent instructions

    Returns:
        tuple: (realtime_model, provider_tools)
            - realtime_model: The RealtimeModel instance for AgentSession(llm=...)
            - provider_tools: List of provider-specific tools (e.g. GoogleSearch for Gemini)
    """
    provider = realtime_config.get('provider', 'gemini')
    temperature = realtime_config.get('temperature', 0.6)

    if provider == 'openai':
        return _create_openai_model(realtime_config, instructions, temperature)
    elif provider == 'xai':
        return _create_xai_model(realtime_config, instructions, temperature)
    else:
        return _create_gemini_model(realtime_config, instructions, temperature)


def _create_gemini_model(config, instructions, temperature):
    if google_plugin is None:
        raise RuntimeError("livekit-plugins-google is not installed. Install with: pip install livekit-plugins-google")

    model = google_plugin.realtime.RealtimeModel(
        model=config.get('gemini_model', 'gemini-2.5-flash-native-audio-preview-09-2025'),
        voice=config.get('gemini_voice', 'Zephyr'),
        instructions=instructions,
        temperature=temperature,
        modalities=["AUDIO"],
    )

    provider_tools = []
    if config.get('enable_google_search', True):
        provider_tools.append(google_plugin.tools.GoogleSearch())

    logger.info(f"Created Gemini realtime model: {config.get('gemini_model')}, voice: {config.get('gemini_voice')}")
    return model, provider_tools


def _create_openai_model(config, instructions, temperature):
    if openai_plugin is None:
        raise RuntimeError("livekit-plugins-openai is not installed. Install with: pip install livekit-plugins-openai")

    # OpenAI RealtimeModel does not accept 'instructions' in constructor.
    # Instructions are passed via AgentSession(instructions=...) instead.
    model = openai_plugin.realtime.RealtimeModel(
        model=config.get('openai_model', 'gpt-realtime'),
        voice=config.get('openai_voice', 'alloy'),
        temperature=temperature,
    )

    logger.info(f"Created OpenAI realtime model: {config.get('openai_model')}, voice: {config.get('openai_voice')}")
    return model, []


def _create_xai_model(config, instructions, temperature):
    if xai_plugin is None:
        raise RuntimeError("livekit-plugins-xai is not installed. Install with: pip install 'livekit-agents[xai]'")

    # xAI has its own dedicated plugin (not OpenAI with custom base_url)
    model = xai_plugin.realtime.RealtimeModel(
        voice=config.get('xai_voice', 'Ara'),
    )

    logger.info(f"Created xAI realtime model, voice: {config.get('xai_voice')}")
    return model, []
