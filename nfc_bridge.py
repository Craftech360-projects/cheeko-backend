"""
NFC-to-WebSocket Bridge (ACR122U via PC/SC)

Listens for NFC card taps and broadcasts UIDs via WebSocket
so the dashboard can receive them in real-time.

Usage:
    python nfc_bridge.py [--port 8765]
"""

import asyncio
import json
import argparse
import time
from smartcard.System import readers
from smartcard.CardMonitoring import CardMonitor, CardObserver
from smartcard.Exceptions import CardConnectionException

GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]

connected_clients = set()
last_uid = None
last_uid_time = 0
DEBOUNCE_MS = 1500


class WebSocketNFCObserver(CardObserver):
    def __init__(self, loop):
        super().__init__()
        self.loop = loop

    def update(self, observable, handlers):
        global last_uid, last_uid_time
        added, removed = handlers

        for card in added:
            try:
                connection = card.createConnection()
                connection.connect()
                response, sw1, sw2 = connection.transmit(GET_UID)
                if sw1 == 0x90 and sw2 == 0x00:
                    from smartcard.util import toHexString
                    uid = toHexString(response).replace(" ", "")
                    now = time.time() * 1000

                    # Debounce same card
                    if uid == last_uid and (now - last_uid_time) < DEBOUNCE_MS:
                        return

                    last_uid = uid
                    last_uid_time = now

                    print(f"[NFC] Card detected: {uid}")
                    message = json.dumps({
                        "type": "nfc_tap",
                        "uid": uid,
                        "timestamp": int(now)
                    })
                    asyncio.run_coroutine_threadsafe(
                        broadcast(message), self.loop
                    )
            except CardConnectionException as e:
                print(f"[NFC] Connection error: {e}")

        for card in removed:
            pass


async def broadcast(message):
    if connected_clients:
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )


async def handler(websocket):
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"[WS] Client connected: {remote[0]}:{remote[1]} ({len(connected_clients)} total)")

    # Send status on connect
    await websocket.send(json.dumps({
        "type": "status",
        "reader": True,
        "message": "NFC bridge connected"
    }))

    try:
        async for message in websocket:
            # Handle ping/pong
            data = json.loads(message)
            if data.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
    except Exception:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected ({len(connected_clients)} remaining)")


async def main(port):
    try:
        import websockets
    except ImportError:
        print("Installing websockets...")
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
        import websockets

    print(f"[NFC Bridge] Starting on ws://localhost:{port}")

    # Check for reader
    available = readers()
    if not available:
        print("[NFC Bridge] WARNING: No NFC reader found. Will wait for reader...")
    else:
        print(f"[NFC Bridge] Reader: {available[0]}")

    loop = asyncio.get_event_loop()

    # Start NFC monitor
    monitor = CardMonitor()
    observer = WebSocketNFCObserver(loop)
    monitor.addObserver(observer)

    print(f"[NFC Bridge] WebSocket server running on ws://localhost:{port}")
    print("[NFC Bridge] Tap a card to broadcast its UID to connected dashboards\n")

    async with websockets.serve(handler, "localhost", port):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NFC-to-WebSocket Bridge")
    parser.add_argument("--port", type=int, default=8766, help="WebSocket port (default: 8766)")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port))
    except KeyboardInterrupt:
        print("\n[NFC Bridge] Stopped.")
