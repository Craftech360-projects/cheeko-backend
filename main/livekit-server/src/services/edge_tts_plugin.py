"""
Edge TTS plugin for LiveKit Agents.
Wraps the edge-tts library as a LiveKit TTS provider.
"""

import uuid
import edge_tts

from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions


class EdgeTTSChunkedStream(tts.ChunkedStream):
    """Non-streaming Edge TTS synthesis."""

    def __init__(
        self,
        *,
        tts_instance: "EdgeTTS",
        text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts_instance, input_text=text, conn_options=conn_options)
        self._voice = tts_instance._voice
        self._rate = tts_instance._rate
        self._volume = tts_instance._volume
        self._pitch = tts_instance._pitch

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        request_id = str(uuid.uuid4())
        output_emitter.initialize(
            request_id=request_id,
            sample_rate=24000,
            num_channels=1,
            mime_type="audio/mp3",
        )

        communicate = edge_tts.Communicate(
            text=self.input_text,
            voice=self._voice,
            rate=self._rate,
            volume=self._volume,
            pitch=self._pitch,
        )

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                output_emitter.push(chunk["data"])

        output_emitter.flush()


class EdgeTTS(tts.TTS):
    """LiveKit TTS plugin using Microsoft Edge TTS (free, no API key needed)."""

    def __init__(
        self,
        *,
        voice: str = "en-US-AnaNeural",
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz",
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1,
        )
        self._voice = voice
        self._rate = rate
        self._volume = volume
        self._pitch = pitch

    @property
    def model(self) -> str:
        return self._voice

    @property
    def provider(self) -> str:
        return "edge-tts"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> EdgeTTSChunkedStream:
        return EdgeTTSChunkedStream(
            tts_instance=self,
            text=text,
            conn_options=conn_options,
        )
