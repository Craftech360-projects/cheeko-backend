"""
Pipeline configuration for Math Commander game.
Creates STT, LLM, and TTS provider instances.
"""

import os
import logging

from livekit.plugins import assemblyai, openai, google
from livekit.agents import inference

logger = logging.getLogger("math_game_pipeline")


def create_pipeline(yaml_config: dict = None):
    """
    Create and return (stt, llm, tts) provider instances.

    Args:
        yaml_config: Optional YAML config dict. If None, reads from env vars only.

    Returns:
        Tuple of (stt, llm, tts) provider instances.

    Raises:
        ValueError: If required API keys are missing.
    """

    # --- STT: AssemblyAI ---
    aai_config = {}
    if yaml_config:
        from src.config.config_loader import ConfigLoader
        aai_config = ConfigLoader.get_assemblyai_config()

    try:
        stt = assemblyai.STT(
            model=aai_config.get("model", "u3-rt-pro"),
            min_turn_silence=aai_config.get("min_turn_silence", 300),
            max_turn_silence=aai_config.get("max_turn_silence", 1500),
            vad_threshold=aai_config.get("vad_threshold", 0.3),
            keyterms_prompt=["samosa", "laddoo", "parrot", "mela", "balloon", "monkey"],
        )
        logger.info(f"pipeline.stt_initialized(model={aai_config.get('model', 'u3-rt-pro')})")
    except Exception as e:
        logger.error(f"pipeline.init_failed(provider=assemblyai, error={e})")
        raise

    # --- LLM: Configurable provider ---
    llm_provider = os.getenv("MATH_LLM_PROVIDER", "openrouter")
    llm_model = os.getenv("MATH_LLM_MODEL", "openai/gpt-4o-mini")
    llm_base_url = os.getenv("MATH_LLM_BASE_URL", "")
    llm_temperature = float(os.getenv("MATH_LLM_TEMPERATURE", "0.6"))

    try:
        llm_kwargs = {"model": llm_model, "temperature": llm_temperature}

        if llm_provider == "openrouter":
            llm_kwargs["base_url"] = "https://openrouter.ai/api/v1"
            llm_kwargs["api_key"] = os.getenv("OPENROUTER_API_KEY", "")
            if not llm_kwargs["api_key"]:
                raise ValueError("OPENROUTER_API_KEY environment variable is required")
            llm = openai.LLM(**llm_kwargs)
        elif llm_provider == "openai":
            if llm_base_url:
                llm_kwargs["base_url"] = llm_base_url
            llm = openai.LLM(**llm_kwargs)
        elif llm_provider == "gemini":
            llm = google.LLM(model=llm_model, temperature=llm_temperature)
        else:
            from livekit.plugins import groq
            llm = groq.LLM(model=llm_model, temperature=llm_temperature)

        logger.info(
            f"pipeline.llm_initialized(provider={llm_provider}, model={llm_model}, "
            f"base_url={llm_base_url or 'default'}, temp={llm_temperature})"
        )
    except Exception as e:
        logger.error(f"pipeline.init_failed(provider={llm_provider}, error={e})")
        raise

    # --- TTS: Deepgram Aura-2 ---
    dg_voice = os.getenv("MATH_DEEPGRAM_TTS_VOICE", "athena")
    try:
        tts = inference.TTS(
            model="deepgram/aura-2",
            voice=dg_voice,
            language="en",
        )
        logger.info(f"pipeline.tts_initialized(provider=deepgram, voice={dg_voice})")
    except Exception as e:
        logger.error(f"pipeline.init_failed(provider=deepgram_tts, error={e})")
        raise

    return stt, llm, tts
