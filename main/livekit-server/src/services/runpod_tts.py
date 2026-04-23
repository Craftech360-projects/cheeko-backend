from __future__ import annotations

import asyncio
import base64
import binascii
import os
from dataclasses import dataclass
from typing import Any

import aiohttp
from livekit.agents import (
    APIConnectionError,
    APIConnectOptions,
    APIStatusError,
    APITimeoutError,
    tts,
    utils,
)
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS


DEFAULT_ENDPOINT = "https://api.runpod.ai/v2/y430imr0irm1bm/runsync"
DEFAULT_VOICE = "casual_male"
DEFAULT_RESPONSE_FORMAT = "wav"
DEFAULT_SAMPLE_RATE = 24000
NUM_CHANNELS = 1


@dataclass
class _RunPodTTSOptions:
    endpoint_url: str
    api_key: str
    voice: str
    response_format: str
    sample_rate: int
    timeout_seconds: float


class RunPodTTS(tts.TTS):
    def __init__(
        self,
        *,
        endpoint_url: str | None = None,
        api_key: str | None = None,
        voice: str | None = None,
        response_format: str | None = None,
        sample_rate: int | None = None,
        timeout_seconds: float | None = None,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate or int(os.getenv("RUNPOD_TTS_SAMPLE_RATE", DEFAULT_SAMPLE_RATE)),
            num_channels=NUM_CHANNELS,
        )

        resolved_api_key = api_key or os.getenv("RUNPOD_API_KEY")
        if not resolved_api_key:
            raise ValueError("RUNPOD_API_KEY is required for RunPodTTS")

        self._opts = _RunPodTTSOptions(
            endpoint_url=endpoint_url or os.getenv("RUNPOD_TTS_ENDPOINT", DEFAULT_ENDPOINT),
            api_key=resolved_api_key,
            voice=voice or os.getenv("RUNPOD_TTS_VOICE", DEFAULT_VOICE),
            response_format=response_format
            or os.getenv("RUNPOD_TTS_RESPONSE_FORMAT", DEFAULT_RESPONSE_FORMAT),
            sample_rate=self.sample_rate,
            timeout_seconds=timeout_seconds
            or float(os.getenv("RUNPOD_TTS_TIMEOUT_SECONDS", "30")),
        )
        self._session = http_session

    @property
    def model(self) -> str:
        return "runpod-tts"

    @property
    def provider(self) -> str:
        return "RunPod"

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = utils.http_context.http_session()
        return self._session

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return RunPodChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class RunPodChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: RunPodTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._tts = tts
        self._opts = tts._opts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        payload = {
            "input": {
                "text": self.input_text,
                "voice": self._opts.voice,
                "response_format": self._opts.response_format,
            }
        }
        timeout = aiohttp.ClientTimeout(
            total=self._opts.timeout_seconds,
            sock_connect=self._conn_options.timeout,
        )

        try:
            async with self._tts._ensure_session().post(
                self._opts.endpoint_url,
                headers={
                    "Authorization": f"Bearer {self._opts.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout,
            ) as resp:
                request_id = resp.headers.get("x-request-id") or utils.shortuuid()
                if resp.status >= 400:
                    body = await resp.text()
                    raise APIStatusError(
                        message=f"RunPod TTS HTTP {resp.status}",
                        status_code=resp.status,
                        request_id=request_id,
                        body=body,
                    )

                content_type = (resp.headers.get("Content-Type") or "").lower()
                if "audio/" in content_type:
                    audio_bytes = await resp.read()
                else:
                    data = await resp.json(content_type=None)
                    audio_bytes = await self._extract_audio_bytes(data)

                output_emitter.initialize(
                    request_id=request_id,
                    sample_rate=self._opts.sample_rate,
                    num_channels=NUM_CHANNELS,
                    mime_type="audio/wav",
                )
                output_emitter.push(audio_bytes)
                output_emitter.flush()

        except asyncio.TimeoutError:
            raise APITimeoutError() from None
        except APIStatusError:
            raise
        except Exception as e:
            raise APIConnectionError() from e

    async def _extract_audio_bytes(self, data: Any) -> bytes:
        if isinstance(data, dict):
            status = data.get("status")
            if status in {"FAILED", "CANCELLED", "TIMED_OUT"}:
                raise APIStatusError(
                    message=f"RunPod TTS job {status}",
                    status_code=500,
                    request_id=str(data.get("id") or ""),
                    body=data,
                )

            for key in ("audio", "audio_base64", "wav", "wav_base64", "data", "file"):
                if key in data:
                    return await self._extract_audio_bytes(data[key])

            if "output" in data:
                return await self._extract_audio_bytes(data["output"])

            raise APIConnectionError(f"RunPod TTS response did not include audio: {data}")

        if isinstance(data, list):
            for item in data:
                try:
                    return await self._extract_audio_bytes(item)
                except Exception:
                    continue
            raise APIConnectionError("RunPod TTS response list did not include audio")

        if isinstance(data, str):
            value = data.strip()
            if value.startswith("data:"):
                _, _, value = value.partition(",")
                return base64.b64decode(value)

            if value.startswith(("http://", "https://")):
                async with self._tts._ensure_session().get(
                    value,
                    timeout=aiohttp.ClientTimeout(total=self._opts.timeout_seconds),
                ) as resp:
                    resp.raise_for_status()
                    return await resp.read()

            try:
                return base64.b64decode(value, validate=True)
            except binascii.Error as e:
                raise APIConnectionError("RunPod TTS audio string is not valid base64") from e

        if isinstance(data, bytes):
            return data

        raise APIConnectionError(f"Unsupported RunPod TTS audio payload: {type(data)}")
