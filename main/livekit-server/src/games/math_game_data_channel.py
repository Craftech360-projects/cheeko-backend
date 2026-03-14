"""
Data channel protocol layer for Math Commander game.
Handles JSON communication between backend and React frontend.
"""

import json
import asyncio
import logging
from typing import Callable, Optional

logger = logging.getLogger("math_game_dc")


class DataChannel:
    """
    Manages bidirectional JSON messaging over LiveKit data channels.

    Incoming: registers handlers by message type, routes parsed messages.
    Outgoing: sends JSON via room.local_participant.publish_data().
    Buffers outgoing messages until mark_ready() is called.
    """

    def __init__(self, room):
        self._room = room
        self._handlers: dict[str, Callable] = {}
        self._outgoing_queue: list[dict] = []
        self._ready = False

        # Register for incoming data
        room.on("data_received", self._on_data_received)
        logger.info("dc.initialized")

    def on(self, message_type: str, handler: Callable):
        """Register an async handler for an incoming message type."""
        self._handlers[message_type] = handler
        logger.debug(f"dc.handler_registered(type={message_type})")

    async def send(self, payload: dict):
        """
        Send a JSON payload to the frontend.
        Buffers if not ready (session not started yet).
        """
        if not self._ready:
            self._outgoing_queue.append(payload)
            logger.debug(f"dc.queued(type={payload.get('type', 'unknown')})")
            return

        await self._publish(payload)

    async def mark_ready(self):
        """Called after session.start() — flushes queued outgoing messages."""
        self._ready = True
        if self._outgoing_queue:
            count = len(self._outgoing_queue)
            for msg in self._outgoing_queue:
                await self._publish(msg)
            self._outgoing_queue.clear()
            logger.info(f"dc.queue_flushed(count={count})")

    async def _publish(self, payload: dict):
        """Publish a single JSON payload via local_participant (non-blocking)."""
        import asyncio
        msg_type = payload.get("type", "unknown")
        qid = payload.get("question_id", "")
        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            # Fire-and-forget: don't await publish_data to avoid blocking on congestion
            asyncio.create_task(self._publish_with_log(data_bytes, msg_type, qid))
        except Exception as e:
            logger.error(f"dc.send_failed(type={msg_type}, error={e})")

    async def _publish_with_log(self, data_bytes: bytes, msg_type: str, qid: str):
        """Background task that actually publishes data and logs."""
        try:
            await self._room.local_participant.publish_data(data_bytes, reliable=True)
            logger.info(f"dc.send(type={msg_type}, question_id={qid})")
        except Exception as e:
            logger.error(f"dc.send_bg_failed(type={msg_type}, error={e})")

    def _on_data_received(self, data_packet):
        """Parse incoming JSON and route to registered handler."""
        try:
            raw = data_packet.data
            logger.debug(f"dc.raw_received(length={len(raw)})")

            message = json.loads(raw.decode("utf-8"))
            msg_type = message.get("type")

            if not msg_type:
                logger.warning(f"dc.parse_error(raw={str(raw[:200])})")
                return

            logger.info(f"dc.received(type={msg_type}, raw_length={len(raw)})")

            handler = self._handlers.get(msg_type)
            if not handler:
                logger.warning(f"dc.no_handler(type={msg_type})")
                return

            # Run handler as async task
            asyncio.create_task(self._run_handler(msg_type, handler, message))

        except json.JSONDecodeError:
            logger.warning(f"dc.parse_error(raw={str(data_packet.data[:200])})")
        except Exception as e:
            logger.error(f"dc.receive_error(error={e})")

    async def _run_handler(self, msg_type: str, handler: Callable, message: dict):
        """Run a message handler with error catching."""
        try:
            await handler(message)
        except Exception as e:
            logger.error(f"dc.handler_error(type={msg_type}, error={e})")
