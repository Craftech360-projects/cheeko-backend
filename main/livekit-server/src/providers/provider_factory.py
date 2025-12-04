import livekit.plugins.groq as groq
import livekit.plugins.elevenlabs as elevenlabs
import livekit.plugins.deepgram as deepgram
from livekit.plugins import openai, inworld, silero
from livekit.agents import stt, llm, tts

# Import our custom providers
from .edge_tts_provider import EdgeTTS
from .funasr_stt_provider import FunASRSTT


class ProviderFactory:
    """Factory class for creating AI service providers"""

    @staticmethod
    def create_llm(config):
        """Create LLM provider with fallback based on configuration"""
        import os
        import logging
        logger = logging.getLogger("provider_factory")

        fallback_enabled = config.get('fallback_enabled', False)
        llm_provider = config.get('llm_provider', 'groq').lower()

        logger.info(f"[LLM] Creating LLM provider: {llm_provider}, model: {config['llm_model']}")

        if fallback_enabled:
            # Create primary and fallback LLM providers
            providers = []

            # Primary provider
            if llm_provider == 'openai':
                api_key = os.getenv('OPENAI_API_KEY')
                if not api_key:
                    raise ValueError("OPENAI_API_KEY environment variable is not set")
                providers.append(openai.LLM(model=config['llm_model'], api_key=api_key))
                logger.info(f"[LLM] Primary: OpenAI with model {config['llm_model']}")
            else:
                providers.append(groq.LLM(model=config['llm_model']))
                logger.info(f"[LLM] Primary: Groq with model {config['llm_model']}")

            # Fallback provider (always Groq for reliability)
            providers.append(groq.LLM(model=config.get('fallback_llm_model', 'llama-3.1-8b-instant')))
            logger.info(f"[LLM] Fallback: Groq with model {config.get('fallback_llm_model', 'llama-3.1-8b-instant')}")

            return llm.FallbackAdapter(providers)
        else:
            # Single provider
            if llm_provider == 'openai':
                api_key = os.getenv('OPENAI_API_KEY')
                if not api_key:
                    raise ValueError("OPENAI_API_KEY environment variable is not set")
                logger.info(f"[LLM] Using OpenAI with model {config['llm_model']}")
                return openai.LLM(model=config['llm_model'], api_key=api_key)
            else:
                logger.info(f"[LLM] Using Groq with model {config['llm_model']}")
                return groq.LLM(model=config['llm_model'])

    @staticmethod
    def create_stt(config, vad=None):
        """Create Speech-to-Text provider with fallback based on configuration"""
        fallback_enabled = config.get('fallback_enabled', False)
        provider = config.get('stt_provider', 'groq').lower()

        if fallback_enabled:
            # Create primary and fallback STT providers with StreamAdapter
            providers = []

            if provider == 'funasr':
                # FunASR WebSocket STT (local server)
                providers.append(stt.StreamAdapter(
                    stt=FunASRSTT(
                        host=config.get('funasr_host', '127.0.0.1'),
                        port=config.get('funasr_port', 10096),
                        use_ssl=config.get('funasr_use_ssl', False),
                        mode=config.get('funasr_mode', '2pass'),
                        language=config.get('stt_language', 'en'),
                        use_itn=config.get('funasr_use_itn', True),
                        hotwords=config.get('funasr_hotwords', ''),
                    ),
                    vad=vad
                ))
            elif provider == 'deepgram':
                import os
                api_key = os.getenv('DEEPGRAM_API_KEY')
                if not api_key:
                    raise ValueError("DEEPGRAM_API_KEY environment variable is not set")
                providers.append(stt.StreamAdapter(
                    stt=deepgram.STT(
                        api_key=api_key,
                        model=config.get('deepgram_model', 'nova-3'),
                        language=config['stt_language']
                    ),
                    vad=vad
                ))
            else:
                providers.append(stt.StreamAdapter(
                    stt=groq.STT(
                        model=config['stt_model'],
                        language=config['stt_language']
                    ),
                    vad=vad
                ))

            # Add fallback (always Groq)
            providers.append(stt.StreamAdapter(
                stt=groq.STT(
                    model=config['stt_model'],
                    language=config['stt_language']
                ),
                vad=vad
            ))

            return stt.FallbackAdapter(providers)
        else:
            # Single provider with StreamAdapter and VAD
            if provider == 'funasr':
                # FunASR WebSocket STT (local server)
                # FunASR WebSocket STT (local server)
                funasr_mode = config.get('funasr_mode', '2pass')
                funasr_stt = FunASRSTT(
                    host=config.get('funasr_host', '127.0.0.1'),
                    port=config.get('funasr_port', 10096),
                    use_ssl=config.get('funasr_use_ssl', False),
                    mode=funasr_mode,
                    language=config.get('stt_language', 'en'),
                    use_itn=config.get('funasr_use_itn', True),
                    hotwords=config.get('funasr_hotwords', ''),
                )
                
                # Only wrap in StreamAdapter if using offline mode (non-streaming)
                if funasr_mode == 'offline':
                    return stt.StreamAdapter(stt=funasr_stt, vad=vad)
                else:
                    return funasr_stt
            elif provider == 'deepgram':
                import os
                api_key = os.getenv('DEEPGRAM_API_KEY')
                if not api_key:
                    raise ValueError("DEEPGRAM_API_KEY environment variable is not set")
                return stt.StreamAdapter(
                    stt=deepgram.STT(
                        api_key=api_key,
                        model=config.get('deepgram_model', 'nova-3'),
                        language=config['stt_language']
                    ),
                    vad=vad
                )
            else:
                # Default to Groq with StreamAdapter and VAD
                return stt.StreamAdapter(
                    stt=groq.STT(
                        model=config['stt_model'],
                        language=config['stt_language']
                    ),
                    vad=vad
                )

    @staticmethod
    def create_tts(groq_config, tts_config):
        """Create Text-to-Speech provider with fallback based on configuration"""
        fallback_enabled = tts_config.get('fallback_enabled', False)

        if fallback_enabled:
            # Create primary and fallback TTS providers
            providers = []

            # Primary provider based on configuration
            primary_provider = tts_config.get('provider', 'edge').lower()
            if primary_provider == 'edge':
                providers.append(EdgeTTS(
                    voice=tts_config.get('edge_voice', 'en-US-AnaNeural'),
                    rate=tts_config.get('edge_rate', '+0%'),
                    volume=tts_config.get('edge_volume', '+0%'),
                    pitch=tts_config.get('edge_pitch', '+0Hz'),
                    sample_rate=tts_config.get('edge_sample_rate', 24000),
                    channels=tts_config.get('edge_channels', 1)
                ))
            elif primary_provider == 'elevenlabs':
                providers.append(elevenlabs.TTS(
                    voice_id=tts_config['elevenlabs_voice_id'],
                    model=tts_config['elevenlabs_model']
                ))
            elif primary_provider == 'inworld':
                import os
                providers.append(inworld.TTS(
                    model=tts_config.get('inworld_model', 'inworld-tts-1-max'),
                    voice=tts_config.get('inworld_voice', 'default-1ynela7pez7baf70bwa69q__cheekotest'),
                    api_key=os.getenv("INWORLD_API_KEY")
                ))
            else:
                # Primary Groq TTS - use tts_config if available
                model = tts_config.get('model', groq_config['tts_model'])
                voice = tts_config.get('voice', groq_config['tts_voice'])
                providers.append(groq.TTS(
                    model=model,
                    voice=voice
                ))

            # Fallback providers (in order of preference)
            if primary_provider != 'edge':
                providers.append(EdgeTTS(
                    voice=tts_config.get('edge_voice', 'en-US-AnaNeural'),
                    rate=tts_config.get('edge_rate', '+0%'),
                    volume=tts_config.get('edge_volume', '+0%'),
                    pitch=tts_config.get('edge_pitch', '+0Hz'),
                    sample_rate=tts_config.get('edge_sample_rate', 24000),
                    channels=tts_config.get('edge_channels', 1)
                ))

            if primary_provider != 'groq':
                providers.append(groq.TTS(
                    model=groq_config['tts_model'],
                    voice=groq_config['tts_voice']
                ))

            return tts.FallbackAdapter(providers)
        else:
            # Single provider (current behavior)
            provider = tts_config.get('provider', 'groq').lower()

            if provider == 'elevenlabs':
                return elevenlabs.TTS(
                    voice_id=tts_config['elevenlabs_voice_id'],
                    model=tts_config['elevenlabs_model']
                )
            elif provider == 'edge':
                return EdgeTTS(
                    voice=tts_config.get('edge_voice', 'en-US-AnaNeural'),
                    rate=tts_config.get('edge_rate', '+0%'),
                    volume=tts_config.get('edge_volume', '+0%'),
                    pitch=tts_config.get('edge_pitch', '+0Hz'),
                    sample_rate=tts_config.get('edge_sample_rate', 24000),
                    channels=tts_config.get('edge_channels', 1)
                )
            elif provider == 'inworld':
                import os
                return inworld.TTS(
                    model=tts_config.get('inworld_model', 'inworld-tts-1-max'),
                    voice=tts_config.get('inworld_voice', 'default-1ynela7pez7baf70bwa69q__cheekotest'),
                    api_key=os.getenv("INWORLD_API_KEY")
                )
            else:
                # Default to Groq - use tts_config if available, otherwise fall back to groq_config
                model = tts_config.get('model', groq_config['tts_model'])
                voice = tts_config.get('voice', groq_config['tts_voice'])
                return groq.TTS(
                    model=model,
                    voice=voice
                )

    @staticmethod
    def create_vad():
        """Create Voice Activity Detection provider optimized for children"""
        from ..config.config_loader import ConfigLoader
        import logging

        logger = logging.getLogger("provider_factory")

        # Get VAD configuration
        vad_config = ConfigLoader.get_vad_config()
        provider = vad_config['provider'].lower()

        logger.info(f"[VAD] Creating VAD provider: {provider}")

        # Skip cache check to avoid circular dependency
        # The cache will be populated after the model is created

        # Create VAD based on provider
        if provider == 'ten':
            # TEN VAD
            try:
                from .ten_vad_wrapper import TENVAD
                logger.info("[VAD] Loading TEN VAD with child-optimized settings")
                logger.info(f"[VAD] Config: threshold={vad_config['activation_threshold']}, "
                           f"min_speech={vad_config['min_speech_duration']}s, "
                           f"min_silence={vad_config['min_silence_duration']}s, "
                           f"hop_size={vad_config['hop_size']}")

                return TENVAD.load(
                    min_speech_duration=vad_config['min_speech_duration'],
                    min_silence_duration=vad_config['min_silence_duration'],
                    activation_threshold=vad_config['activation_threshold'],
                    prefix_padding_duration=vad_config['prefix_padding_duration'],
                    max_buffered_speech=vad_config['max_buffered_speech'],
                    sample_rate=vad_config['sample_rate'],
                    hop_size=vad_config['hop_size'],
                )
            except Exception as e:
                logger.error(f"[VAD] Failed to load TEN VAD: {e}")
                logger.warning("[VAD] Falling back to Silero VAD")
                provider = 'silero'  # Fallback

        # Silero VAD (default or fallback)
        logger.info("[VAD] Loading Silero VAD with child-optimized settings")
        logger.info(f"[VAD] Config: threshold={vad_config['activation_threshold']}, "
                   f"min_speech={vad_config['min_speech_duration']}s, "
                   f"min_silence={vad_config['min_silence_duration']}s")

        return silero.VAD.load(
            min_speech_duration=vad_config['min_speech_duration'],
            min_silence_duration=vad_config['min_silence_duration'],
            activation_threshold=vad_config['activation_threshold'],
            prefix_padding_duration=vad_config['prefix_padding_duration'],
            max_buffered_speech=vad_config['max_buffered_speech'],
        )

    @staticmethod
    def create_turn_detection():
        """Create turn detection model"""
       # return MultilingualModel()
       # return EnglishModel()
        return None  # Disabled to avoid HuggingFace download errors

    @staticmethod
    def create_realtime_model(config=None):
        """
        Create a Realtime model (Gemini or OpenAI) for end-to-end voice streaming.

        Args:
            config: Optional config dict. If not provided, will load from ConfigLoader.

        Returns:
            Realtime model instance (google.realtime.RealtimeModel or openai.realtime.RealtimeModel)
        """
        import os
        import logging
        logger = logging.getLogger("provider_factory")

        # Load config if not provided
        if config is None:
            from ..config.config_loader import ConfigLoader
            config = ConfigLoader.get_gemini_realtime_config()

        provider = config.get('provider', 'gemini').lower()
        logger.info(f"[REALTIME] Creating Realtime model provider: {provider}")

        if provider == 'openai':
            # OpenAI Realtime API
            try:
                from livekit.plugins import openai as openai_plugin

                api_key = os.getenv('OPENAI_API_KEY')
                if not api_key:
                    raise ValueError("OPENAI_API_KEY environment variable is not set")

                model = config.get('openai_model', 'gpt-4o-realtime-preview')
                voice = config.get('openai_voice', 'alloy')
                temperature = config.get('temperature', 0.6)

                logger.info(f"[REALTIME] OpenAI Realtime - Model: {model}, Voice: {voice}")

                return openai_plugin.realtime.RealtimeModel(
                    model=model,
                    voice=voice,
                    temperature=temperature,
                )
            except ImportError as e:
                logger.error(f"[REALTIME] Failed to import OpenAI Realtime plugin: {e}")
                raise
            except Exception as e:
                logger.error(f"[REALTIME] Failed to create OpenAI Realtime model: {e}")
                raise

        else:
            # Gemini Realtime (default)
            try:
                from livekit.plugins import google
                from google.genai import types

                model = config.get('model', 'gemini-2.0-flash-exp')
                voice = config.get('voice', 'Zephyr')
                temperature = config.get('temperature', 0.6)

                logger.info(f"[REALTIME] Gemini Realtime - Model: {model}, Voice: {voice}, Temp: {temperature}")

                # Build VAD configuration
                start_sensitivity_map = {
                    'high': types.StartSensitivity.START_SENSITIVITY_HIGH,
                    'medium': types.StartSensitivity.START_SENSITIVITY_MEDIUM,
                    'low': types.StartSensitivity.START_SENSITIVITY_LOW,
                }
                end_sensitivity_map = {
                    'high': types.EndSensitivity.END_SENSITIVITY_HIGH,
                    'medium': types.EndSensitivity.END_SENSITIVITY_MEDIUM,
                    'low': types.EndSensitivity.END_SENSITIVITY_LOW,
                }

                start_sensitivity = start_sensitivity_map.get(
                    config.get('start_sensitivity', 'high'),
                    types.StartSensitivity.START_SENSITIVITY_HIGH
                )
                end_sensitivity = end_sensitivity_map.get(
                    config.get('end_sensitivity', 'high'),
                    types.EndSensitivity.END_SENSITIVITY_HIGH
                )

                vad_config = types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        disabled=config.get('vad_disabled', False),
                        start_of_speech_sensitivity=start_sensitivity,
                        end_of_speech_sensitivity=end_sensitivity,
                        prefix_padding_ms=config.get('prefix_padding_ms', 10),
                        silence_duration_ms=config.get('silence_duration_ms', 200),
                    )
                )

                logger.info(f"[REALTIME] VAD Config - Start: {config.get('start_sensitivity', 'high')}, "
                           f"End: {config.get('end_sensitivity', 'high')}, "
                           f"Silence: {config.get('silence_duration_ms', 200)}ms")

                # Build tools list
                gemini_tools = []
                if config.get('enable_google_search', True):
                    google_search = types.GoogleSearch()
                    gemini_tools.append(google_search)
                    logger.info("[REALTIME] Google Search tool enabled")

                return google.realtime.RealtimeModel(
                    model=model,
                    voice=voice,
                    temperature=temperature,
                    realtime_input_config=vad_config,
                    _gemini_tools=gemini_tools if gemini_tools else None,
                )

            except ImportError as e:
                logger.error(f"[REALTIME] Failed to import Google Realtime plugin: {e}")
                raise
            except Exception as e:
                logger.error(f"[REALTIME] Failed to create Gemini Realtime model: {e}")
                raise

    @staticmethod
    def create_realtime_session(config=None, agent=None):
        """
        Create an AgentSession configured for Realtime (end-to-end voice).

        This is a convenience method that creates both the Realtime model
        and wraps it in an AgentSession.

        Args:
            config: Optional config dict for the Realtime model.
            agent: Optional Agent instance to use with the session.

        Returns:
            AgentSession configured with Realtime model
        """
        from livekit.agents import AgentSession
        import logging
        logger = logging.getLogger("provider_factory")

        realtime_model = ProviderFactory.create_realtime_model(config)

        session = AgentSession(llm=realtime_model)

        logger.info("[REALTIME] AgentSession created with Realtime model")

        return session
