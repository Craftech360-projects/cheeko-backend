import asyncio
from pathlib import Path
import sys

import pytest


LIVEKIT_ROOT = Path(__file__).resolve().parents[1]
if str(LIVEKIT_ROOT) not in sys.path:
    sys.path.insert(0, str(LIVEKIT_ROOT))


from src.services import unified_audio_player as audio_module
from src.services.unified_audio_player import UnifiedAudioPlayer
from src.shared.entrypoint_utils import is_livekit_room_not_found_error


class FakeTwirpError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def test_livekit_room_not_found_errors_are_detected():
    error = FakeTwirpError("not_found", "requested room does not exist")

    assert is_livekit_room_not_found_error(error) is True


@pytest.mark.asyncio
async def test_playback_cancel_closes_streaming_audio_iterator(monkeypatch):
    player = UnifiedAudioPlayer()

    class FakeAudioFrames:
        def __init__(self):
            self.closed = False

        async def aclose(self):
            self.closed = True

    class CancelledSpeechHandle:
        def __await__(self):
            async def raise_cancelled():
                raise asyncio.CancelledError()

            return raise_cancelled().__await__()

    class FakeSession:
        def say(self, **kwargs):
            return CancelledSpeechHandle()

    audio_frames = FakeAudioFrames()
    player.session = FakeSession()

    async def fake_stream_download(url, title):
        return audio_frames

    async def no_op():
        return None

    monkeypatch.setattr(player, "_stream_download_and_convert", fake_stream_download)
    monkeypatch.setattr(player, "_send_music_end_signal", no_op)
    monkeypatch.setattr(player, "_send_agent_state_to_listening", no_op)
    monkeypatch.setattr(audio_module.audio_state_manager, "force_stop_music", lambda: None)

    with pytest.raises(asyncio.CancelledError):
        await player._play_via_session_say("https://example.com/song.mp3", "Song")

    assert audio_frames.closed is True
