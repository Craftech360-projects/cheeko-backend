from dotenv import load_dotenv
import os
import yaml
from pathlib import Path
import logging

logger = logging.getLogger("config_loader")

class ConfigLoader:
    """Configuration loader for the agent system"""

    @staticmethod
    def load_env():
        """Load environment variables from .env file"""
        load_dotenv(".env")

    @staticmethod
    def get_groq_config():
        """Get Groq configuration from environment variables"""
        return {
            'llm_provider': os.getenv('LLM_PROVIDER', 'groq'),  # groq or openai
            'llm_model': os.getenv('LLM_MODEL', 'openai/gpt-oss-20b'),
            'stt_model': os.getenv('STT_MODEL', 'whisper-large-v3-turbo'),
            'tts_model': os.getenv('TTS_MODEL', 'playai-tts'),
            'tts_voice': os.getenv('TTS_VOICE', 'Aaliyah-PlayAI'),
            'stt_language': os.getenv('STT_LANGUAGE', 'en'),
            'stt_provider': os.getenv('STT_PROVIDER', 'groq'),  # groq, deepgram, funasr, chirp, or openai
            'stt_use_vad': os.getenv('STT_USE_VAD', 'auto').lower(),  # true, false, or auto (auto=false for chirp/google)
            'deepgram_model': os.getenv('DEEPGRAM_MODEL', 'nova-3'),
            # OpenAI STT configuration
            'openai_stt_model': os.getenv('OPENAI_STT_MODEL', 'gpt-4o-transcribe'),
            # Google Chirp STT configuration
            'google_stt_location': os.getenv('GOOGLE_STT_LOCATION', 'asia-southeast1'),  # us-central1, europe-west4, asia-southeast1
            # FunASR WebSocket STT configuration
            'funasr_host': os.getenv('FUNASR_HOST', '127.0.0.1'),
            'funasr_port': int(os.getenv('FUNASR_PORT', '10096')),
            'funasr_use_ssl': os.getenv('FUNASR_USE_SSL', 'false').lower() == 'true',
            'funasr_mode': os.getenv('FUNASR_MODE', '2pass'),  # offline, online, 2pass
            'funasr_use_itn': os.getenv('FUNASR_USE_ITN', 'true').lower() == 'true',
            'funasr_hotwords': os.getenv('FUNASR_HOTWORDS', ''),
            # Fallback configuration
            'fallback_enabled': os.getenv('FALLBACK_ENABLED', 'false').lower() == 'true',
            'fallback_llm_model': os.getenv('FALLBACK_LLM_MODEL', 'llama-3.1-8b-instant'),
        }

    @staticmethod
    def get_tts_config(api_config=None):
        """
        Get TTS configuration, with API config taking precedence over .env

        Args:
            api_config: TTS config from API (if available)

        Returns:
            Dict with TTS configuration
        """
        # Start with .env defaults
        config = {
            'provider': os.getenv('TTS_PROVIDER', 'edge'),  # groq, elevenlabs, or edge
            'model': os.getenv('TTS_MODEL', 'playai-tts'),
            'voice': os.getenv('TTS_VOICE', 'Aaliyah-PlayAI'),
            # ElevenLabs configuration
            'elevenlabs_voice_id': os.getenv('ELEVENLABS_VOICE_ID', ''),
            'elevenlabs_model': os.getenv('ELEVENLABS_MODEL_ID', 'eleven_turbo_v2_5'),
            # EdgeTTS configuration
            'edge_voice': os.getenv('EDGE_TTS_VOICE', 'en-US-AnaNeural'),
            'edge_rate': os.getenv('EDGE_TTS_RATE', '+0%'),
            'edge_volume': os.getenv('EDGE_TTS_VOLUME', '+0%'),
            'edge_pitch': os.getenv('EDGE_TTS_PITCH', '+0Hz'),
            'edge_sample_rate': int(os.getenv('EDGE_TTS_SAMPLE_RATE', '24000')),
            'edge_channels': int(os.getenv('EDGE_TTS_CHANNELS', '1')),
            # Fallback configuration
            'fallback_enabled': os.getenv('TTS_FALLBACK_ENABLED', 'false').lower() == 'true',
        }

        # Override with API config if provided
        if api_config:
            logger.info(f"🔄 Overriding TTS config with API settings: {api_config}")

            if 'provider' in api_config:
                config['provider'] = api_config['provider']
                logger.info(f"✅ TTS Provider from API: {api_config['provider']}")

            if api_config.get('provider') == 'elevenlabs':
                if 'voice_id' in api_config:
                    config['elevenlabs_voice_id'] = api_config['voice_id']
                if 'model' in api_config:
                    config['elevenlabs_model'] = api_config['model']
                logger.info(f"✅ ElevenLabs Voice ID: {config['elevenlabs_voice_id']}")

            elif api_config.get('provider') == 'edge':
                if 'voice' in api_config:
                    config['edge_voice'] = api_config['voice']
                if 'rate' in api_config:
                    config['edge_rate'] = api_config['rate']
                if 'volume' in api_config:
                    config['edge_volume'] = api_config['volume']
                if 'pitch' in api_config:
                    config['edge_pitch'] = api_config['pitch']
                logger.info(f"✅ Edge TTS Voice: {config['edge_voice']}")

            elif api_config.get('provider') == 'groq':
                if 'model' in api_config:
                    config['model'] = api_config['model']
                if 'voice' in api_config:
                    config['voice'] = api_config['voice']
                logger.info(f"✅ Groq TTS - Model: {config.get('model')}, Voice: {config.get('voice')}")
        else:
            logger.info(f"📝 Using TTS config from .env: Provider={config['provider']}")

        return config

    @staticmethod
    def get_livekit_config():
        """Get LiveKit configuration from environment variables"""
        return {
            'api_key': os.getenv('LIVEKIT_API_KEY'),
            'api_secret': os.getenv('LIVEKIT_API_SECRET'),
            'ws_url': os.getenv('LIVEKIT_URL')
        }

    @staticmethod
    def get_agent_config():
        """Get agent configuration from environment variables"""
        return {
            'preemptive_generation': os.getenv('PREEMPTIVE_GENERATION', 'false').lower() == 'true',
            'noise_cancellation': os.getenv('NOISE_CANCELLATION', 'true').lower() == 'true'
        }

    @staticmethod
    def get_vad_config():
        """Get VAD (Voice Activity Detection) configuration from environment variables"""
        return {
            'provider': os.getenv('VAD_PROVIDER', 'silero').lower(),  # silero or ten
            'min_speech_duration': float(os.getenv('VAD_MIN_SPEECH_DURATION', '0.1')),
            'min_silence_duration': float(os.getenv('VAD_MIN_SILENCE_DURATION', '.8')),
            'activation_threshold': float(os.getenv('VAD_ACTIVATION_THRESHOLD', '0.08')),
            'prefix_padding_duration': float(os.getenv('VAD_PREFIX_PADDING_DURATION', '0.3')),
            'max_buffered_speech': float(os.getenv('VAD_MAX_BUFFERED_SPEECH', '60.0')),
            'sample_rate': int(os.getenv('VAD_SAMPLE_RATE', '16000')),
            'hop_size': int(os.getenv('VAD_HOP_SIZE', '160')),  # TEN VAD specific
        }

    @staticmethod
    def load_yaml_config():
        """Load configuration from config.yaml"""
        config_path = Path(__file__).parent.parent.parent / "config.yaml"
        try:
            with open(config_path, 'r', encoding='utf-8') as file:
                return yaml.safe_load(file)
        except FileNotFoundError:
            print(f"Warning: config.yaml not found at {config_path}")
            return {}
        except Exception as e:
            print(f"Error loading config.yaml: {e}")
            return {}

    @staticmethod
    def should_read_from_api():
        """Check if configuration should be read from API"""
        config = ConfigLoader.load_yaml_config()
        return config.get('read_config_from_api', False)

    @staticmethod
    def get_default_prompt():
        """Get default prompt from config.yaml"""
        config = ConfigLoader.load_yaml_config()
        default_prompt = config.get('default_prompt', '')
        if not default_prompt:
            # Fallback prompt if none configured
            return "You are a helpful AI assistant."
        return default_prompt.strip()

    @staticmethod
    def get_manager_api_config():
        """Get manager API configuration from config.yaml"""
        config = ConfigLoader.load_yaml_config()
        return config.get('manager_api', {})