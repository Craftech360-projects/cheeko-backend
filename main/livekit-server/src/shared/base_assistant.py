"""
Base Assistant class for multi-agent workers
Contains common functionality shared across all agent types
"""

import logging
from typing import Optional
from livekit.agents import Agent

logger = logging.getLogger("base_assistant")


class BaseAssistant(Agent):
    """
    Base Assistant with common functionality for all agent types

    Features are loaded on-demand to minimize initialization latency.
    Specialized workers extend this class for agent-specific behavior.
    """

    # Default greeting instruction - override in subclasses for custom greetings
    GREETING_INSTRUCTION = "Greet the user warmly. Keep it brief and friendly."

    def __init__(self, instructions: str = None) -> None:
        """
        Initialize base assistant

        Args:
            instructions: Agent instructions/prompt
        """
        super().__init__(instructions=instructions or "You are Cheeko, a helpful AI assistant.")

        # Room and device information
        self.room_name: Optional[str] = None
        self.device_mac: Optional[str] = None

        # Session reference for dynamic updates
        self._agent_session = None
        self._session_context = None

        # Lazy-loaded services
        self._device_control_service = None
        self._mcp_executor = None

        # Audio player for music/story playback
        self.audio_player = None

        # Game states (initialized when enabled)
        self.math_game_state = None
        self.riddle_game_state = None
        self.word_ladder_state = None
        self.active_game = None
        self.game_tools = []

        logger.info("Base Assistant initialized")

    async def on_enter(self):
        """
        Lifecycle hook - runs once when agent becomes active.
        Automatically greets the user using the GREETING_INSTRUCTION.
        Override GREETING_INSTRUCTION in subclasses for custom greetings.
        """
        import asyncio
        # Try to import RealtimeError, fallback to Exception if not available
        try:
            from livekit.agents.llm.realtime import RealtimeError
        except ImportError:
            RealtimeError = Exception

        agent_name = self.__class__.__name__
        logger.info(f"{agent_name} on_enter triggered - waiting for connection...")

        # Wait for the Gemini Realtime connection to fully stabilize
        # The connection starts async and needs time to be ready for generation
        await asyncio.sleep(4.0)

        # Retry logic for greeting
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.info(f"{agent_name} sending greeting (attempt {attempt + 1}/{max_retries})")
                await self.session.generate_reply(
                    instructions=self.GREETING_INSTRUCTION
                )
                logger.info(f"{agent_name} greeting sent successfully")
                return  # Success, exit
            except RealtimeError as e:
                logger.warning(f"{agent_name} greeting attempt {attempt + 1} encountered RealtimeError: {e}")
                # Handle specific Gemini Realtime timeout which often happens if the model
                # starts speaking continuously or due to VAD race conditions
                if "timed out waiting for generation_created" in str(e):
                    logger.info(f"{agent_name} greeting likely successfully playing despite timeout (race condition)")
                    return # Assume success to avoid duplicated greetings
                
                if attempt < max_retries - 1:
                    await asyncio.sleep(2.0)
            except Exception as e:
                logger.warning(f"{agent_name} greeting attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2.0)  # Wait longer before retry
                else:
                    logger.error(f"{agent_name} failed to send greeting after {max_retries} attempts")

    # ============================================================================
    # LAZY-LOADED SERVICES (Properties)
    # ============================================================================

    @property
    def device_control_service(self):
        """Lazy-load device control service on first access"""
        if self._device_control_service is None:
            from src.mcp.device_control_service import DeviceControlService
            self._device_control_service = DeviceControlService()
            logger.info("Device control service lazy-loaded")
        return self._device_control_service

    @property
    def mcp_executor(self):
        """Lazy-load MCP executor on first access"""
        if self._mcp_executor is None:
            from src.mcp.mcp_executor import LiveKitMCPExecutor
            self._mcp_executor = LiveKitMCPExecutor()
            logger.info("MCP executor lazy-loaded")
        return self._mcp_executor

    # ============================================================================
    # SERVICE INJECTION
    # ============================================================================

    def set_services(self, device_control_service=None, mcp_executor=None):
        """
        Inject services (optional - will lazy-load if not provided)
        """
        if device_control_service:
            self._device_control_service = device_control_service
        if mcp_executor:
            self._mcp_executor = mcp_executor

    def set_room_info(self, room_name: str = None, device_mac: str = None):
        """Set room name and device MAC address"""
        self.room_name = room_name
        self.device_mac = device_mac
        logger.info(f"Room info set - Room: {room_name}, MAC: {device_mac}")

    def set_agent_session(self, session):
        """Set session reference for dynamic updates"""
        self._agent_session = session
        logger.info("Session reference stored")

    def set_session_context(self, ctx):
        """Set session context for room operations"""
        self._session_context = ctx

    # ============================================================================
    # FEATURE ENABLEMENT (Lazy Loading Pattern)
    # ============================================================================

    def enable_battery_tools(self):
        """Enable battery checking function tools"""
        try:
            from src.features.battery_tools import (
                check_battery_level,
                inject_assistant_context
            )
            inject_assistant_context(self)
            self.check_battery_level = check_battery_level
            logger.info("Battery tools enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable battery tools: {e}")
            return False

    def enable_mode_switching(self):
        """Enable mode switching function tool"""
        try:
            from src.features.mode_switching import update_agent_mode, inject_assistant_context
            inject_assistant_context(self)
            self.update_agent_mode = update_agent_mode
            logger.info("Mode switching enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable mode switching: {e}")
            return False

    def enable_volume_tools(self):
        """Enable volume and light control function tools"""
        try:
            from src.features.volume_tools import (
                self_set_volume, self_get_volume, self_volume_up, self_volume_down,
                self_mute, self_unmute, set_light_color, set_light_mode,
                set_rainbow_speed, inject_assistant_context
            )
            inject_assistant_context(self)
            self.self_set_volume = self_set_volume
            self.self_get_volume = self_get_volume
            self.self_volume_up = self_volume_up
            self.self_volume_down = self_volume_down
            self.self_mute = self_mute
            self.self_unmute = self_unmute
            self.set_light_color = set_light_color
            self.set_light_mode = set_light_mode
            self.set_rainbow_speed = set_rainbow_speed
            logger.info("Volume and light tools enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable volume tools: {e}")
            return False

    def enable_music_tools(self, music_service):
        """Enable music playback tools"""
        try:
            from src.features.music_tools import (
                play_music,
                stop_music,
                next_song,
                previous_song,
                inject_music_context
            )
            inject_music_context(self, music_service)
            self.play_music = play_music
            self.stop_music = stop_music
            self.next_song = next_song
            self.previous_song = previous_song
            logger.info("Music tools enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable music tools: {e}")
            return False

    # ============================================================================
    # GAME STATE MANAGEMENT
    # ============================================================================

    def enable_math_game(self):
        """Enable math game with state management"""
        try:
            from src.games.math_game import MathGameState
            self.math_game_state = MathGameState()
            logger.info("Math game enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable math game: {e}")
            return False

    def enable_riddle_game(self):
        """Enable riddle game with state management"""
        try:
            from src.games.riddle_game import RiddleGameState
            self.riddle_game_state = RiddleGameState()
            logger.info("Riddle game enabled")
            return True
        except Exception as e:
            logger.error(f"Failed to enable riddle game: {e}")
            return False

    def enable_word_ladder_game(self):
        """Enable word ladder game with state management"""
        try:
            from src.games.word_ladder_game import WordLadderGameState, pick_valid_word_pair
            self.word_ladder_state = WordLadderGameState()
            start, target = pick_valid_word_pair()
            self.word_ladder_state.reset(start, target)
            logger.info(f"Word ladder game enabled: {start} -> {target}")
            return True
        except Exception as e:
            logger.error(f"Failed to enable word ladder game: {e}")
            return False

    def enable_game_tools(self, game_name: str):
        """
        Enable function tools for the specified game and connect game state.

        Args:
            game_name: "Math Tutor", "Riddle Solver", or "Word Ladder"

        Returns:
            list: Function tools to register with the LLM
        """
        try:
            from src.features.game_tools import (
                set_math_game_state,
                set_riddle_game_state,
                set_word_ladder_state,
                get_math_tools,
                get_riddle_tools,
                get_word_ladder_tools
            )

            tools = []

            if game_name == "Math Tutor":
                if not self.math_game_state:
                    self.enable_math_game()
                set_math_game_state(self.math_game_state)
                tools = get_math_tools()
                logger.info("Math Tutor tools registered")

            elif game_name == "Riddle Solver":
                if not self.riddle_game_state:
                    self.enable_riddle_game()
                set_riddle_game_state(self.riddle_game_state)
                tools = get_riddle_tools()
                logger.info("Riddle Solver tools registered")

            elif game_name == "Word Ladder":
                if not self.word_ladder_state:
                    self.enable_word_ladder_game()
                set_word_ladder_state(self.word_ladder_state)
                tools = get_word_ladder_tools()
                logger.info("Word Ladder tools registered")

            self.game_tools = tools
            self.active_game = game_name
            return tools

        except Exception as e:
            logger.error(f"Failed to enable game tools for {game_name}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []

    # ============================================================================
    # COMMON FEATURES (Override in subclasses as needed)
    # ============================================================================

    def enable_common_features(self):
        """Enable common features for all agents"""
        self.enable_battery_tools()
        self.enable_volume_tools()
        logger.info("Common features enabled")

    def enable_cheeko_features(self, music_service=None):
        """Enable all features for Cheeko agent"""
        self.enable_common_features()
        self.enable_mode_switching()
        if music_service:
            self.enable_music_tools(music_service)
        # Initialize game states for potential switching
        self.enable_math_game()
        self.enable_riddle_game()
        self.enable_word_ladder_game()
        logger.info("Cheeko features enabled")
