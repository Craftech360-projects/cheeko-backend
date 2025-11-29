"""
FunASR WebSocket Client
Async WebSocket client for FunASR 2-pass speech recognition.

Protocol:
- Connect via WebSocket (ws:// or wss://)
- Send JSON config, then binary audio chunks
- Receive JSON responses with text, mode, is_final fields
"""

import asyncio
import json
import logging
import ssl
from dataclasses import dataclass, field
from typing import Optional, List
import websockets
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger(__name__)


@dataclass
class FunASRConfig:
    """Configuration for FunASR WebSocket connection"""
    host: str = "127.0.0.1"
    port: int = 10096
    use_ssl: bool = False
    mode: str = "2pass"  # offline, online, 2pass
    chunk_size: List[int] = field(default_factory=lambda: [0, 10, 5])  # lookahead, chunk, lookback
    chunk_interval: int = 10
    encoder_chunk_look_back: int = 4
    decoder_chunk_look_back: int = 0
    sample_rate: int = 16000
    use_itn: bool = True
    hotwords: str = ""
    language: str = "en"


@dataclass
class FunASRResponse:
    """Response from FunASR server"""
    text: str
    mode: str  # online, offline, 2pass-online, 2pass-offline
    is_final: bool
    timestamp: Optional[List] = None

    @classmethod
    def from_json(cls, data: dict) -> "FunASRResponse":
        return cls(
            text=data.get("text", ""),
            mode=data.get("mode", ""),
            is_final=data.get("is_final", False),
            timestamp=data.get("timestamp", [])
        )


class FunASRWebSocketClient:
    """Async WebSocket client for FunASR server"""

    def __init__(self, config: FunASRConfig):
        self.config = config
        self._ws = None
        self._connected = False
        self._receive_task = None
        self._response_queue: asyncio.Queue = asyncio.Queue()
        self._lock = asyncio.Lock()

    @property
    def uri(self) -> str:
        protocol = "wss" if self.config.use_ssl else "ws"
        return f"{protocol}://{self.config.host}:{self.config.port}"

    async def connect(self) -> None:
        """Establish WebSocket connection to FunASR server"""
        async with self._lock:
            if self._connected:
                logger.debug("FunASR already connected")
                return

            ssl_context = None
            if self.config.use_ssl:
                ssl_context = ssl.SSLContext()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            logger.info(f"Connecting to FunASR at {self.uri}")

            try:
                self._ws = await websockets.connect(
                    self.uri,
                    subprotocols=["binary"],
                    ping_interval=None,
                    ssl=ssl_context,
                    close_timeout=5
                )
                self._connected = True

                # Start receive task
                self._receive_task = asyncio.create_task(self._receive_loop())

                # Send initial config
                await self._send_config()
                logger.info("FunASR WebSocket connected and configured")

            except Exception as e:
                logger.error(f"Failed to connect to FunASR: {e}")
                self._connected = False
                raise

    async def _send_config(self) -> None:
        """Send initial configuration message"""
        config_msg = {
            "mode": self.config.mode,
            "chunk_size": self.config.chunk_size,
            "chunk_interval": self.config.chunk_interval,
            "encoder_chunk_look_back": self.config.encoder_chunk_look_back,
            "decoder_chunk_look_back": self.config.decoder_chunk_look_back,
            "audio_fs": self.config.sample_rate,
            "wav_name": "livekit_stream",
            "is_speaking": True,
            "hotwords": self.config.hotwords,
            "itn": self.config.use_itn,
        }
        await self._ws.send(json.dumps(config_msg))
        logger.debug(f"Sent FunASR config: {config_msg}")

    async def _receive_loop(self) -> None:
        """Background task to receive messages from FunASR"""
        try:
            while self._connected and self._ws:
                try:
                    msg = await asyncio.wait_for(self._ws.recv(), timeout=0.5)
                    if msg:
                        data = json.loads(msg)
                        response = FunASRResponse.from_json(data)
                        await self._response_queue.put(response)
                        logger.debug(f"FunASR response: mode={response.mode}, text={response.text[:50] if response.text else ''}")
                except asyncio.TimeoutError:
                    continue
                except ConnectionClosed:
                    logger.info("FunASR WebSocket connection closed")
                    self._connected = False
                    break
        except asyncio.CancelledError:
            logger.debug("FunASR receive loop cancelled")
        except Exception as e:
            logger.error(f"FunASR receive error: {e}")
            self._connected = False

    async def send_audio(self, audio_data: bytes) -> None:
        """Send audio chunk to FunASR server"""
        if not self._connected or not self._ws:
            raise RuntimeError("Not connected to FunASR server")
        try:
            await self._ws.send(audio_data)
        except Exception as e:
            logger.error(f"Error sending audio to FunASR: {e}")
            self._connected = False
            raise

    async def end_stream(self) -> None:
        """Signal end of audio stream"""
        if self._connected and self._ws:
            try:
                end_msg = json.dumps({"is_speaking": False})
                await self._ws.send(end_msg)
                logger.debug("Sent end-of-stream to FunASR")
            except Exception as e:
                logger.error(f"Error sending end-of-stream: {e}")

    async def get_response(self, timeout: float = 0.1) -> Optional[FunASRResponse]:
        """Get next response from queue with timeout"""
        try:
            return await asyncio.wait_for(
                self._response_queue.get(),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            return None

    async def get_all_responses(self) -> List[FunASRResponse]:
        """Get all available responses from queue"""
        responses = []
        while not self._response_queue.empty():
            try:
                responses.append(self._response_queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return responses

    async def close(self) -> None:
        """Close WebSocket connection"""
        self._connected = False

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        if self._ws:
            try:
                await self._ws.close()
            except Exception as e:
                logger.debug(f"Error closing FunASR WebSocket: {e}")
            self._ws = None

        # Clear response queue
        while not self._response_queue.empty():
            try:
                self._response_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        logger.info("FunASR WebSocket closed")

    @property
    def is_connected(self) -> bool:
        return self._connected and self._ws is not None
