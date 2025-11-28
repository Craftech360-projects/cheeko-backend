import logging
import json
import aiohttp
from typing import Dict, Any, Optional
from datetime import datetime
import asyncio

logger = logging.getLogger("analytics")

# Mode type normalization map - ensures consistent snake_case values
MODE_TYPE_MAP = {
    'cheeko': 'conversation',
    'math tutor': 'math_tutor',
    'riddle solver': 'riddle_solver',
    'word ladder': 'word_ladder',
    'music': 'music',
    'story': 'story',
    'conversation': 'conversation',
    'math_tutor': 'math_tutor',
    'riddle_solver': 'riddle_solver',
    'word_ladder': 'word_ladder'
}

def normalize_mode_type(mode_name: str) -> str:
    """
    Normalize mode type to consistent snake_case format
    
    Args:
        mode_name: Input mode name (any format)
        
    Returns:
        Normalized mode type in snake_case
    """
    if not mode_name:
        return 'conversation'
    
    # Convert to lowercase and try direct mapping first
    mode_lower = mode_name.lower()
    if mode_lower in MODE_TYPE_MAP:
        return MODE_TYPE_MAP[mode_lower]
    
    # Fall back to converting spaces to underscores
    normalized = mode_lower.replace(' ', '_')
    logger.warning(f"📊⚠️ Unknown mode type '{mode_name}', normalized to: {normalized}")
    return normalized

class AnalyticsService:
    """Service for capturing and sending analytics data to Manager API"""

    def __init__(self, manager_api_url: str, secret: str, device_mac: str, session_id: str, agent_id: str = None):
        """
        Initialize analytics service

        Args:
            manager_api_url: Base URL of Manager API
            secret: API authentication secret
            device_mac: Device MAC address
            session_id: Session identifier (room name)
            agent_id: Agent identifier (optional)
        """
        self.manager_api_url = manager_api_url.rstrip('/')
        self.secret = secret
        self.device_mac = device_mac
        self.session_id = session_id
        self.agent_id = agent_id

        # Session tracking
        self.session_started = False
        self.current_mode = None
        self.session_start_time = None

        logger.info(f"📊✅ Analytics service initialized - MAC: {device_mac}, Session: {session_id}")

    async def start_session(self, mode_type: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Start a new analytics session

        Args:
            mode_type: Mode type (Math, Riddle, WordLadder, Music, Story, Conversation)
            metadata: Additional session metadata
        """
        try:
            # FIX: Normalize mode type to consistent snake_case format
            normalized_mode = normalize_mode_type(mode_type)
            
            self.current_mode = normalized_mode
            self.session_start_time = datetime.now()
            self.session_started = True

            payload = {
                "sessionId": self.session_id,
                "macAddress": self.device_mac,
                "agentId": self.agent_id,
                "modeType": normalized_mode,  # Use normalized value
                "startedAt": self.session_start_time.isoformat(),
                "metadata": json.dumps(metadata) if metadata else None
            }

            url = f"{self.manager_api_url}/analytics/session/start"
            headers = {"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        logger.info(f"📊✅ Session started - Mode: {normalized_mode}, Session: {self.session_id}")
                    else:
                        logger.warning(f"📊⚠️ Failed to start session - Status: {response.status}")

        except Exception as e:
            logger.error(f"📊❌ Error starting session: {e}")

    async def end_session(self, completion_status: str = "completed"):
        """
        End the current analytics session

        Args:
            completion_status: Completion status (completed, interrupted, switched, victory, failure)
        """
        if not self.session_started:
            return

        try:
            params = {
                "sessionId": self.session_id,
                "completionStatus": completion_status
            }

            url = f"{self.manager_api_url}/analytics/session/end"
            headers = {"Authorization": f"Bearer {self.secret}"}

            async with aiohttp.ClientSession() as session:
                async with session.post(url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        logger.info(f"📊✅ Session ended - Status: {completion_status}, Session: {self.session_id}")
                    else:
                        logger.warning(f"📊⚠️ Failed to end session - HTTP {response.status}")

            self.session_started = False
            self.current_mode = None
            self.session_start_time = None

        except Exception as e:
            logger.error(f"📊❌ Error ending session: {e}")

    async def record_game_attempt(
        self,
        game_type: str,
        is_correct: bool,
        attempt_number: int = 1,
        response_time_ms: Optional[int] = None,
        question_type: Optional[str] = None,
        difficulty_level: Optional[str] = None
    ):
        """
        Record a game attempt (question/answer/move)

        Args:
            game_type: Game type (math_tutor, riddle_solver, word_ladder)
            is_correct: Whether answer was correct
            attempt_number: Attempt number (1 or 2)
            response_time_ms: Response time in milliseconds
            question_type: Question type (addition, subtraction, etc.)
            difficulty_level: Difficulty level (easy, medium, hard)

        Note: Text fields (question_text, correct_answer, user_answer, metadata) are no longer saved
              to comply with privacy requirements - we only track statistics (correct/wrong counts, timing)
        """
        try:
            payload = {
                "sessionId": self.session_id,
                "macAddress": self.device_mac,
                "gameType": game_type,
                "questionText": None,  # Deprecated - not saved anymore
                "correctAnswer": None,  # Deprecated - not saved anymore
                "userAnswer": None,  # Deprecated - not saved anymore
                "isCorrect": is_correct,
                "attemptNumber": attempt_number,
                "responseTimeMs": response_time_ms,
                "questionType": question_type,
                "difficultyLevel": difficulty_level,
                "answeredAt": datetime.now().isoformat(),
                "metadata": None  # Deprecated - not saved anymore
            }

            url = f"{self.manager_api_url}/analytics/game-attempt"
            headers = {"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        logger.debug(f"📊✅ Game attempt recorded - Game: {game_type}, Correct: {is_correct}")
                    else:
                        logger.warning(f"📊⚠️ Failed to record attempt - HTTP {response.status}")

        except Exception as e:
            logger.error(f"📊❌ Error recording game attempt: {e}")

    async def record_media_playback(
        self,
        media_type: str,
        media_id: str,
        media_title: str,
        started_at: datetime,
        ended_at: Optional[datetime] = None,
        duration_played_seconds: Optional[int] = None,
        total_duration_seconds: Optional[int] = None,
        skip_action: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """
        Record media playback event (music/story)

        Args:
            media_type: Media type (music or story)
            media_id: Media identifier
            media_title: Media title
            started_at: Playback start timestamp
            ended_at: Playback end timestamp
            duration_played_seconds: Duration played in seconds
            total_duration_seconds: Total media duration
            skip_action: Skip action (next, previous, stop)
            metadata: Additional metadata
        """
        try:
            payload = {
                "sessionId": self.session_id,
                "macAddress": self.device_mac,
                "mediaType": media_type,
                "mediaId": media_id,
                "mediaTitle": media_title,
                "startedAt": started_at.isoformat(),
                "endedAt": ended_at.isoformat() if ended_at else None,
                "durationPlayedSeconds": duration_played_seconds,
                "totalDurationSeconds": total_duration_seconds,
                "skipAction": skip_action,
                "skippedAt": datetime.now().isoformat() if skip_action else None,
                "metadata": json.dumps(metadata) if metadata else None
            }

            url = f"{self.manager_api_url}/analytics/media-event"
            headers = {"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        logger.info(f"📊✅ Media playback recorded - Type: {media_type}, Title: {media_title}")
                    else:
                        response_text = await response.text()
                        logger.error(f"📊❌ Failed to record media playback - HTTP {response.status}, Response: {response_text}")

        except Exception as e:
            logger.error(f"📊❌ Error recording media playback: {e}")

    async def record_streak(
        self,
        game_type: str,
        streak_number: int,
        questions_in_streak: int,
        started_at: datetime,
        ended_at: datetime,
        duration_seconds: Optional[int] = None
    ):
        """
        Record a completed streak

        Args:
            game_type: Game type (math_tutor, riddle_solver, word_ladder)
            streak_number: Streak number in this session (1, 2, 3...)
            questions_in_streak: Number of consecutive correct answers
            started_at: Streak start timestamp
            ended_at: Streak end timestamp
            duration_seconds: Time taken to complete the streak
        """
        try:
            # Calculate duration if not provided
            if duration_seconds is None:
                duration_ms = (ended_at - started_at).total_seconds() * 1000
                duration_seconds = int(duration_ms / 1000)

            payload = {
                "sessionId": self.session_id,
                "macAddress": self.device_mac,
                "gameType": game_type,
                "streakNumber": streak_number,
                "questionsInStreak": questions_in_streak,
                "startedAt": started_at.isoformat(),
                "endedAt": ended_at.isoformat(),
                "durationSeconds": duration_seconds
            }

            url = f"{self.manager_api_url}/analytics/streak"
            headers = {"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        logger.info(f"📊✅ Streak recorded - Game: {game_type}, Streak #{streak_number}, Questions: {questions_in_streak}, Time: {duration_seconds}s")
                    else:
                        logger.warning(f"📊⚠️ Failed to record streak - HTTP {response.status}")

        except Exception as e:
            logger.error(f"📊❌ Error recording streak: {e}")

    async def get_overall_stats(self) -> Optional[Dict[str, Any]]:
        """
        Get overall usage stats for the current device

        Returns:
            Dictionary with overall statistics or None if error
        """
        try:
            url = f"{self.manager_api_url}/analytics/user/{self.device_mac}/overall"
            headers = {"Authorization": f"Bearer {self.secret}"}

            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get('data')
                    else:
                        logger.warning(f"📊⚠️ Failed to get overall stats - HTTP {response.status}")
                        return None

        except Exception as e:
            logger.error(f"📊❌ Error getting overall stats: {e}")
            return None

    async def get_game_stats(self, game_type: str) -> Optional[Dict[str, Any]]:
        """
        Get game-specific stats

        Args:
            game_type: Game type (math, riddle, wordladder)

        Returns:
            Dictionary with game statistics or None if error
        """
        try:
            url = f"{self.manager_api_url}/analytics/user/{self.device_mac}/{game_type}"
            headers = {"Authorization": f"Bearer {self.secret}"}

            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get('data')
                    else:
                        logger.warning(f"📊⚠️ Failed to get {game_type} stats - HTTP {response.status}")
                        return None

        except Exception as e:
            logger.error(f"📊❌ Error getting game stats: {e}")
            return None
