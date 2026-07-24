import json
import re
import time
import uuid
import threading
import socket
import struct
import logging
import argparse
import os
import pyaudio
import keyboard
# hjvk
from typing import Dict, Optional, Tuple
import requests
import paho.mqtt.client as mqtt_client
from paho.mqtt.enums import CallbackAPIVersion
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from queue import Queue, Empty
import opuslib

# --- Configuration ---

SERVER_IP = "192.168.0.82"
OTA_PORT = 8002
MQTT_BROKER_HOST ="192.168.0.82"


MQTT_BROKER_PORT = int(os.getenv("TEST_MQTT_BROKER_PORT", "1883"))
MANAGER_API_BASE = os.getenv("TEST_MANAGER_API_BASE", "http://192.168.0.28:8001/toy")
MQTT_SIGNATURE_KEY = os.getenv("TEST_MQTT_SIGNATURE_KEY", "test-signature-key-12345")
# DEVICE_MAC is now dynamically generated for uniqueness
# Minimum frames to have in buffer to continue playback
PLAYBACK_BUFFER_MIN_FRAMES = 3
# Number of frames to buffer before starting playback
PLAYBACK_BUFFER_START_FRAMES = 16

# --- NEW: Sequence tracking configuration ---
# Set to False to disable sequence logging
ENABLE_SEQUENCE_LOGGING = True
LOG_SEQUENCE_EVERY_N_PACKETS = 32  # Reduced logging frequency for multi-client scenarios

# --- NEW: Timeout configurations ---
TTS_TIMEOUT_SECONDS = 30  # Maximum time to wait for TTS audio
BUFFER_TIMEOUT_SECONDS = 5  # Reduced timeout for faster recovery
KEEP_ALIVE_INTERVAL = 5  # Send keep-alive every N seconds

# --- Logging ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("TestClient")

# --- Global variables ---
mqtt_message_queue = Queue()
udp_session_details = {}
stop_threads = threading.Event()
# Event to signal recording thread to start
start_recording_event = threading.Event()
# Event to signal recording thread to stop
stop_recording_event = threading.Event()


def generate_mqtt_credentials(device_mac: str) -> Dict[str, str]:
    """Generate MQTT credentials for the gateway."""
    import base64
    import hashlib
    import hmac

    # Create client ID
    client_id = f"GID_test@@@{device_mac}@@@{uuid.uuid4()}"

    # Create username (base64 encoded JSON)
    username_data = {"ip": "192.168.1.10"}  # Placeholder IP
    username = base64.b64encode(json.dumps(username_data).encode()).decode()

    # Create password (HMAC-SHA256) - must match gateway's logic
    # Gateway uses: clientId + '|' + username as content
    # Must match MQTT_SIGNATURE_KEY in gateway's .env
    secret_key = MQTT_SIGNATURE_KEY
    content = f"{client_id}|{username}"
    password = base64.b64encode(hmac.new(
        secret_key.encode(), content.encode(), hashlib.sha256).digest()).decode()

    return {
        "client_id": client_id,
        "username": username,
        "password": password
    }


def generate_unique_mac() -> str:
    """Generates a unique MAC address for the client."""
    # Generate 6 random bytes for the MAC address
    # Using a common OUI prefix (00:16:3E) for locally administered addresses
    # and then random bytes to ensure uniqueness for each client instance.
    mac_bytes = [0x00, 0x16, 0x3E,  # OUI prefix
                 uuid.uuid4().bytes[0], uuid.uuid4().bytes[1], uuid.uuid4().bytes[2]]
    return '_'.join(f'{b:02x}' for b in mac_bytes)


# --- Cheeko Face expression tags (mimics firmware parsing) ---
FACE_EXPRESSIONS = {
    "neutral", "happy", "excited", "laughing", "love", "silly", "curious",
    "surprised", "confused", "shy", "sad", "crying", "angry", "scared", "sleepy",
}
FACE_TAG_RE = re.compile(r"^\[([a-z]{2,12})\]\s*")


def parse_expression_tag(text):
    """Mimic firmware: a leading [tag] is stripped from display text.

    Returns (expression, display_text). Known tag drives the face, unknown
    lowercase tag falls back to neutral, non-tag brackets are left untouched.
    """
    m = FACE_TAG_RE.match(text or "")
    if not m:
        return None, text or ""
    tag = m.group(1)
    return (tag if tag in FACE_EXPRESSIONS else "neutral"), text[m.end():]


assert parse_expression_tag("[happy] Yay!") == ("happy", "Yay!")
assert parse_expression_tag("[zzzz] hi") == ("neutral", "hi")
assert parse_expression_tag("[OK!] hi") == (None, "[OK!] hi")


class TestClient:
    def __init__(self, device_mac: Optional[str] = None):
        self.mqtt_client = None
        # Generate a unique MAC address for this client instance
        self.device_mac_formatted = device_mac or "00:16:3e:ac:b5:38"
        print(f"Generated unique MAC address: {self.device_mac_formatted}")

        # MQTT credentials will be set from OTA response
        self.mqtt_credentials = None

        # The P2P topic - will be set after getting MQTT credentials from OTA
        self.p2p_topic = None
        self.ota_config = {}
        self.websocket_url = None  # Will be set from OTA endpoint
        self.udp_socket = None
        self.udp_listener_thread = None
        self.playback_thread = None
        self.audio_recording_thread = None
        self.udp_local_sequence = 0
        self.audio_playback_queue = Queue()

        # --- NEW: Sequence tracking variables ---
        self.expected_sequence = None  # Adopted from the first packet received
        self.first_sequence = None  # First seq of the current stream (baseline)
        self.last_received_sequence = 0  # Last sequence number received
        self.total_packets_received = 0  # Total packets received
        self.out_of_order_packets = 0  # Count of out-of-order packets
        self.duplicate_packets = 0  # Count of duplicate packets
        self.missing_packets = 0  # Count of missing packets
        self.sequence_gaps = []  # List of detected gaps in sequence

        # --- NEW: State tracking ---
        self.tts_active = False
        self.last_audio_received = 0
        self.session_active = True
        self.conversation_count = 0

        # Cards for mid-session RFID mimic: list of (label, uid), tapped via number keys.
        self.rfid_cards = []

        logger.info(
            f"Client initialized with unique MAC: {self.device_mac_formatted}")

    def setup_local_test_config(self):
        """Configure the client for local mqtt-gateway testing without OTA."""
        self.ota_config = {
            "mqtt_gateway": {
                "broker": MQTT_BROKER_HOST,
                "port": MQTT_BROKER_PORT,
            }
        }
        self.mqtt_credentials = generate_mqtt_credentials(self.device_mac_formatted)
        self.p2p_topic = f"devices/p2p/{self.mqtt_credentials['client_id']}"
        logger.info(
            "[RFID-TEST] Local mode configured with broker=%s:%s client_id=%s",
            MQTT_BROKER_HOST,
            MQTT_BROKER_PORT,
            self.mqtt_credentials["client_id"],
        )

    def on_mqtt_connect(self, client, userdata, flags, rc, properties=None):
        """Callback for MQTT connection."""
        if rc == 0:
            logger.info(
                f"[OK] MQTT Connected! Subscribing to P2P topic: {self.p2p_topic}")
            client.subscribe(self.p2p_topic)
        else:
            logger.error(f"[ERROR] MQTT Connection failed with code {rc}")

    def on_mqtt_message(self, client, userdata, msg):
        """Callback for MQTT message reception."""
        try:
            payload_str = msg.payload.decode()
            payload = json.loads(payload_str)
            logger.info(
                f"[EMOJI] MQTT Message received on topic '{msg.topic}':\n{json.dumps(payload, indent=2)}")

            # Mimic firmware Cheeko Face: parse expression tag on text-bearing messages
            if payload.get("type") in ("tts", "llm") and payload.get("text"):
                face, shown = parse_expression_tag(payload["text"])
                if face:
                    logger.info("[FACE] expression=%s | display text: %s", face, shown)

            # Handle TTS start signal (reset sequence tracking)
            if payload.get("type") == "tts" and payload.get("state") == "start":
                logger.info("[TTS] TTS started. Resetting sequence tracking.")
                self.tts_active = True
                self.reset_sequence_tracking()
                # Send immediate UDP keepalive to ensure connection is ready
                if self.udp_socket and udp_session_details:
                    try:
                        keepalive_payload = f"keepalive:{udp_session_details['session_id']}".encode()
                        encrypted_keepalive = self.encrypt_packet(keepalive_payload)
                        if encrypted_keepalive:
                            server_udp_addr = (udp_session_details['udp']['server'], udp_session_details['udp']['port'])
                            self.udp_socket.sendto(encrypted_keepalive, server_udp_addr)
                            logger.info("[UDP] Sent UDP keepalive to ensure connection readiness")
                    except Exception as e:
                        logger.warning(f"[WARN] Failed to send UDP keepalive: {e}")

            # Handle TTS stop signal (start recording for next user input)
            elif payload.get("type") == "tts" and payload.get("state") == "stop":
                logger.info(
                    "[MIC] TTS finished. Received 'stop' signal. Preparing for microphone capture...")
                self.tts_active = False
                self.print_sequence_summary()  # Print summary when TTS ends

                # Proceed with recording even if we didn't receive audio,
                # as the user might have aborted the TTS explicitly (e.g., via spacebar)
                # and wants to speak now.
                if self.total_packets_received == 0:
                    logger.warning("[WARN] No audio packets received during TTS, but proceeding with recording anyway (possibly aborted).")

                # Clear the stop event to allow the recording thread to continue or start
                stop_recording_event.clear()
                # Set the start event to signal the recording thread to begin (if it was waiting)
                start_recording_event.set()
                logger.info(
                    "[MIC] Cleared stop_recording_event and set start_recording_event for next recording.")

            # Handle STT message (server processed our speech)
            elif payload.get("type") == "stt":
                transcription = payload.get("text", "")
                logger.info(f"[EMOJI] Server transcribed: '{transcription}'")

            # Handle record stop signal (stop recording)
            elif payload.get("type") == "record_stop":
                logger.info(
                    "[STOP] Received 'record_stop' signal from server. Stopping current audio recording...")
                stop_recording_event.set()  # This will cause the recording thread loop to exit

            else:
                mqtt_message_queue.put(payload)
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Error processing MQTT message: {e}")

    def publish_device_message(self, payload: Dict) -> None:
        """Publish a raw device message to the gateway."""
        if not self.mqtt_client:
            raise RuntimeError("MQTT client is not connected")
        logger.info("[MQTT->GW] Publishing:\n%s", json.dumps(payload, indent=2))
        self.mqtt_client.publish("device-server", json.dumps(payload))

    def wait_for_message(self, expected_types, timeout: int = 10) -> Optional[Dict]:
        """Wait for a message from the gateway matching one of the expected types."""
        if isinstance(expected_types, str):
            expected_types = {expected_types}
        else:
            expected_types = set(expected_types)

        deadline = time.time() + timeout
        while time.time() < deadline:
            remaining = max(0.1, deadline - time.time())
            try:
                message = mqtt_message_queue.get(timeout=remaining)
            except Empty:
                continue

            msg_type = message.get("type")
            if msg_type in expected_types:
                logger.info("[GW->MQTT] Matched message type=%s", msg_type)
                return message

            logger.info("[GW->MQTT] Ignoring message type=%s while waiting for %s", msg_type, sorted(expected_types))

        return None

    def send_rfid_card_lookup(
        self,
        rfid_uid: str,
        local_version: Optional[str] = None,
        local_content_hash: Optional[str] = None,
        local_skill_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Optional[Dict]:
        """Send a card_lookup payload that exercises tap analytics and version handshake."""
        payload = {
            "type": "card_lookup",
            "event_id": f"lookup_{uuid.uuid4().hex[:12]}",
            "session_id": session_id,
            "rfid_uid": rfid_uid,
            "mac_address": self.device_mac_formatted,
            "tap_ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if local_skill_id:
            payload["local_skill_id"] = local_skill_id
        if local_version is not None:
            payload["local_version"] = str(local_version)
        if local_content_hash is not None:
            payload["local_content_hash"] = str(local_content_hash)

        self.publish_device_message(payload)
        return self.wait_for_message(
            {"card_up_to_date", "card_content", "card_ai", "card_unknown"},
            timeout=15,
        )

    def mimic_rfid_scan(self, rfid_uid: str) -> None:
        """Fire-and-forget card_lookup to mimic a mid-session RFID tap (character switch).

        Unlike send_rfid_card_lookup, this does not block waiting for a reply — during a
        live voice session the gateway handles the switch and dispatches a fresh room.
        """
        rfid_uid = (rfid_uid or "").strip()
        if not rfid_uid:
            logger.warning("[RFID] No card UID; skipping mimic scan.")
            return
        payload = {
            "type": "card_lookup",
            "event_id": f"lookup_{uuid.uuid4().hex[:12]}",
            "session_id": udp_session_details.get("session_id"),
            "rfid_uid": rfid_uid,
            "mac_address": self.device_mac_formatted,
            "tap_ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        logger.info("[RFID] Mimicking card tap for UID=%s", rfid_uid)
        self.publish_device_message(payload)

    def request_content_download(
        self,
        rfid_uid: str,
        current_version: Optional[str] = None,
    ) -> Optional[Dict]:
        """Ask the gateway for download links for a content card."""
        payload = {
            "type": "download_request",
            "rfid_uid": rfid_uid,
            "mac_address": self.device_mac_formatted,
        }
        if current_version is not None:
            payload["current_version"] = str(current_version)

        self.publish_device_message(payload)
        return self.wait_for_message("download_response", timeout=15)

    def fetch_card_tap_analytics(self, auth_token: str, uid: Optional[str] = None) -> None:
        """Fetch tap analytics summary/logs from manager-api-node."""
        headers = {"Authorization": f"Bearer {auth_token}"}
        summary_params = {"mac": self.device_mac_formatted}
        log_params = {"mac": self.device_mac_formatted, "limit": 20}
        if uid:
            summary_params["uid"] = uid
            log_params["uid"] = uid

        summary_url = f"{MANAGER_API_BASE}/admin/rfid/card/tap-analytics/summary"
        logs_url = f"{MANAGER_API_BASE}/admin/rfid/card/tap-logs"

        try:
            summary_resp = requests.get(summary_url, headers=headers, params=summary_params, timeout=10)
            logger.info("[ANALYTICS] Summary status=%s", summary_resp.status_code)
            try:
                logger.info("[ANALYTICS] Summary body:\n%s", json.dumps(summary_resp.json(), indent=2))
            except Exception:
                logger.info("[ANALYTICS] Summary raw body:\n%s", summary_resp.text)

            logs_resp = requests.get(logs_url, headers=headers, params=log_params, timeout=10)
            logger.info("[ANALYTICS] Logs status=%s", logs_resp.status_code)
            try:
                logger.info("[ANALYTICS] Logs body:\n%s", json.dumps(logs_resp.json(), indent=2))
            except Exception:
                logger.info("[ANALYTICS] Logs raw body:\n%s", logs_resp.text)
        except requests.exceptions.RequestException as exc:
            logger.error("[ANALYTICS] Failed to fetch analytics: %s", exc)

    def retry_conversation(self):
        """Retry triggering a conversation if no audio was received."""
        if self.session_active and not self.tts_active:
            self.conversation_count += 1
            logger.info(
                f"[RETRY] Retry attempt #{self.conversation_count}: Sending listen message again...")

            if self.conversation_count < 3:  # Limit retries
                listen_payload = {
                    "type": "listen",
                    "session_id": udp_session_details["session_id"],
                    "state": "detect",
                    "text": f"retry attempt {self.conversation_count}"
                }
                if self.mqtt_client:
                    self.mqtt_client.publish(
                        "device-server", json.dumps(listen_payload))
            else:
                logger.error(
                    "[ERROR] Too many retry attempts. There may be a server issue.")
                self.session_active = False

    def reset_sequence_tracking(self):
        """Reset sequence tracking statistics for a new TTS stream."""
        # Baseline is adopted from the first packet received (the gateway uses one
        # continuous UDP sequence across the session, not per-stream from 1).
        self.expected_sequence = None
        self.first_sequence = None
        self.last_received_sequence = 0
        self.total_packets_received = 0
        self.out_of_order_packets = 0
        self.duplicate_packets = 0
        self.missing_packets = 0
        self.sequence_gaps = []
        self.last_audio_received = time.time()
        if ENABLE_SEQUENCE_LOGGING:
            logger.info("[RETRY] Reset sequence tracking for new TTS stream")

    def print_sequence_summary(self):
        """Print a summary of sequence statistics."""
        if not ENABLE_SEQUENCE_LOGGING:
            return

        logger.info("=" * 60)
        logger.info("[STATS] SEQUENCE TRACKING SUMMARY")
        logger.info("=" * 60)
        logger.info(f"[PKT] Total packets received: {self.total_packets_received}")
        logger.info(f"[SEQ] Last sequence number: {self.last_received_sequence}")
        logger.info(f"[ERROR] Missing packets: {self.missing_packets}")
        logger.info(f"[RETRY] Out-of-order packets: {self.out_of_order_packets}")
        logger.info(f"[DUP] Duplicate packets: {self.duplicate_packets}")

        if self.sequence_gaps:
            logger.info(
                f"[GAP]  Sequence gaps detected: {len(self.sequence_gaps)}")
            for gap in self.sequence_gaps[-5:]:  # Show last 5 gaps
                logger.info(
                    f"   Gap: expected {gap['expected']}, got {gap['received']}")
        else:
            logger.info("[OK] No sequence gaps detected")

        # Calculate packet loss percentage over the actual stream range
        # (last - first + 1), not from sequence 1.
        if self.first_sequence is not None and self.last_received_sequence >= self.first_sequence:
            expected_total = self.last_received_sequence - self.first_sequence + 1
            loss_rate = (self.missing_packets / expected_total) * 100 if expected_total else 0
            logger.info(f"[LOSS] Packet loss rate: {loss_rate:.2f}%")

        logger.info("=" * 60)

    def parse_packet_header(self, header: bytes) -> Dict:
        """Parse the packet header to extract sequence and other info."""
        if len(header) < 16:
            return {}

        try:
            # Unpack header: packet_type, flags, payload_len, ssrc, timestamp, sequence
            packet_type, flags, payload_len, ssrc, timestamp, sequence = struct.unpack(
                '>BBHIII', header)
            return {
                'packet_type': packet_type,
                'flags': flags,
                'payload_len': payload_len,
                'ssrc': ssrc,
                'timestamp': timestamp,
                'sequence': sequence
            }
        except struct.error:
            return {}

    def track_sequence(self, sequence: int):
        """Track and analyze packet sequence numbers (optimized for performance)."""
        if not ENABLE_SEQUENCE_LOGGING:
            return

        self.total_packets_received += 1
        self.last_audio_received = time.time()

        # First packet of a stream: adopt its sequence as the baseline. The gateway
        # uses one continuous UDP sequence across the whole session, so a stream does
        # NOT start at 1 — assuming so produced false "missing packets" reports.
        if self.expected_sequence is None:
            self.expected_sequence = sequence
            self.first_sequence = sequence
            self.last_received_sequence = sequence - 1

        # Check for missing packets (gaps in sequence) - most critical
        if sequence > self.expected_sequence:
            gap_size = sequence - self.expected_sequence
            self.missing_packets += gap_size
            # Only log significant gaps to reduce overhead
            if gap_size > 1:  # Only log if more than 1 packet missing
                self.sequence_gaps.append({
                    'expected': self.expected_sequence,
                    'received': sequence,
                    'gap_size': gap_size
                })
                logger.warning(
                    f"[GAP]  Sequence gap detected: expected {self.expected_sequence}, got {sequence} (missing {gap_size} packets)")

        # Check for out-of-order/duplicate packets (less critical, minimal logging)
        elif sequence < self.expected_sequence:
            if sequence <= self.last_received_sequence:
                self.duplicate_packets += 1
            else:
                self.out_of_order_packets += 1

        # Update tracking variables
        if sequence > self.last_received_sequence:
            self.last_received_sequence = sequence
            self.expected_sequence = sequence + 1

        # Reduce logging frequency to minimize overhead
        if self.total_packets_received % (LOG_SEQUENCE_EVERY_N_PACKETS * 4) == 0:
            logger.info(
                f"[SEQ] Packet #{self.total_packets_received}: seq={sequence}, expected={self.expected_sequence}")

    def encrypt_packet(self, payload: bytes) -> bytes:
        """Encrypts the audio payload using AES-CTR with header as nonce."""
        global udp_session_details
        if "udp" not in udp_session_details:
            logger.error("UDP session details not available for encryption.")
            return b''

        aes_key = bytes.fromhex(udp_session_details["udp"]["key"])

        # Extract connectionId from the nonce (which is the header template)
        nonce_bytes = bytes.fromhex(udp_session_details["udp"]["nonce"])
        connection_id = struct.unpack('>I', nonce_bytes[4:8])[
            0]  # Extract connectionId from nonce

        packet_type, flags = 0x01, 0x00
        payload_len, timestamp, sequence = len(payload), int(
            time.time()), self.udp_local_sequence

        # Header format: [type: 1u, flags: 1u, payload_len: 2u, connectionId: 4u, timestamp: 4u, sequence: 4u]
        header = struct.pack('>BBHIII', packet_type, flags,
                             payload_len, connection_id, timestamp, sequence)

        cipher = Cipher(algorithms.AES(aes_key), modes.CTR(
            header), backend=default_backend())
        encryptor = cipher.encryptor()
        encrypted_payload = encryptor.update(payload) + encryptor.finalize()
        self.udp_local_sequence += 1
        return header + encrypted_payload

    def get_ota_config(self) -> bool:
        """Requests OTA configuration from the server."""
        logger.info(
            f"[STEP] STEP 1: Requesting OTA config from http://{SERVER_IP}:{OTA_PORT}/toy/ota/")
        try:
            # Generate a client ID for this session
            import uuid
            session_client_id = str(uuid.uuid4())

            headers = {"device-id": self.device_mac_formatted}
            data = {
                "application": {
                    "version": "1.7.6",
                    "name": "DOIT AI Kit v1.7.6"
                },
                "board": {
                    "type": "doit-ai-01-kit"
                },
                "client_id": session_client_id
            }
            response = requests.post(
                f"http://{SERVER_IP}:{OTA_PORT}/toy/ota/", headers=headers, json=data, timeout=5)
            response.raise_for_status()
            self.ota_config = response.json()
            print(
                f"OTA Config received: {json.dumps(self.ota_config, indent=2)}")

            # Extract websocket URL from the new OTA response format
            websocket_info = self.ota_config.get("websocket", {})
            if websocket_info and "url" in websocket_info:
                self.websocket_url = websocket_info["url"]
                logger.info(
                    f"[OK] Got websocket URL from OTA: {self.websocket_url}")
            else:
                logger.warning(
                    "[WARN] No websocket URL in OTA response, using fallback")
                self.websocket_url = f"ws://{SERVER_IP}:8000/toy/v1/"

            # Extract MQTT credentials from OTA response
            mqtt_info = self.ota_config.get("mqtt", {})
            if mqtt_info:
                self.mqtt_credentials = {
                    "client_id": mqtt_info.get("client_id"),
                    "username": mqtt_info.get("username"),
                    "password": mqtt_info.get("password")
                }
                logger.info(
                    f"✅ Got MQTT credentials from OTA: {self.mqtt_credentials['client_id']}")
                # Set P2P topic to match the full client_id (as gateway publishes to this)
                self.p2p_topic = f"devices/p2p/{self.mqtt_credentials['client_id']}"
            else:
                logger.warning(
                    "[WARN] No MQTT credentials in OTA response, generating locally as fallback")
                # Generate MQTT credentials locally as fallback
                self.mqtt_credentials = generate_mqtt_credentials(
                    self.device_mac_formatted)
                logger.info(
                    f"✅ Generated MQTT credentials locally: {self.mqtt_credentials['client_id']}")
                # Set P2P topic to match the full client_id
                self.p2p_topic = f"devices/p2p/{self.mqtt_credentials['client_id']}"

            logger.info("[OK] OTA config received successfully.")

            # --- Handle activation logic (optional, may not be needed) ---
            activation = self.ota_config.get("activation")
            if activation:
                code = activation.get("code")
                if code:
                    print(f"[EMOJI] Activation Required. Code: {code}")
                    activated = False
                    for attempt in range(10):
                        logger.info(
                            f"[EMOJI] Checking activation status... Attempt {attempt + 1}/10")
                        try:
                            status_response = requests.get(
                                f"http://{SERVER_IP}:{OTA_PORT}/ota/active", params={"mac": self.device_mac_formatted}, timeout=3)
                            print(
                                f"Activation status response: {status_response.text}")
                            if status_response.ok and status_response.json().get("activated"):
                                logger.info("[OK] Device activated!")
                                activated = True
                                break
                            else:
                                logger.warning(
                                    "[ERROR] Device not activated yet. Retrying...")

                        except Exception as e:
                            logger.warning(f"Activation check failed: {e}")
                        time.sleep(5)
                    if not activated:
                        logger.error(
                            "[ERROR] Activation failed after 10 attempts. Exiting client.")
                        return False
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"[ERROR] Failed to get OTA config: {e}")
            return False

    def connect_mqtt(self) -> bool:
        """Connects to the MQTT Broker."""
        # Get MQTT configuration from OTA response
        mqtt_config = self.ota_config.get("mqtt_gateway", {})
        mqtt_broker = mqtt_config.get("broker", MQTT_BROKER_HOST)
        mqtt_port = mqtt_config.get("port", MQTT_BROKER_PORT)

        logger.info(f"[INFO] MQTT Config from OTA: {mqtt_config}")
        logger.info(f"[INFO] Using MQTT Broker: {mqtt_broker}")
        logger.info(f"[INFO] Using MQTT Port: {mqtt_port}")
        logger.info(
            f"[INFO] MQTT Credentials: client_id={self.mqtt_credentials.get('client_id', 'NOT SET')}")
        logger.info(
            f"[STEP] STEP 2: Connecting to MQTT Gateway at {mqtt_broker}:{mqtt_port}...")

        self.mqtt_client = mqtt_client.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=self.mqtt_credentials["client_id"]
        )
        self.mqtt_client.on_connect = self.on_mqtt_connect
        self.mqtt_client.on_message = self.on_mqtt_message
        self.mqtt_client.username_pw_set(
            self.mqtt_credentials["username"],
            self.mqtt_credentials["password"]
        )

        try:
            logger.info(f"[RETRY] Attempting connection to MQTT broker...")
            logger.info(f"   Host: {mqtt_broker}")
            logger.info(f"   Port: {mqtt_port}")
            logger.info(f"   Client ID: {self.mqtt_credentials['client_id']}")
            logger.info(f"   Username: {self.mqtt_credentials['username']}")

            self.mqtt_client.connect(mqtt_broker, mqtt_port, 60)
            self.mqtt_client.loop_start()

            # Wait a moment for connection to establish
            time.sleep(2)

            # Check if connected
            if self.mqtt_client.is_connected():
                logger.info("[OK] MQTT client is connected!")
            else:
                logger.warning(
                    "[WARN] MQTT client connection status unknown, waiting...")

            return True
        except Exception as e:
            logger.error(f"[ERROR] Failed to connect to MQTT Gateway: {e}")
            logger.error(f"   Error type: {type(e).__name__}")
            logger.error(f"   Broker: {mqtt_broker}:{mqtt_port}")
            return False

    def send_hello_and_get_session(self, feature: Optional[str] = None) -> bool:
        """Sends 'hello' message and waits for session details.

        `feature` (e.g. "ai_imagine") is added at the top level of the hello so the
        gateway routes the whole session to that feature (spec Option A).
        """
        logger.info("[STEP] STEP 3: Sending 'hello' and pinging UDP...")
        # Use the client_id from our generated MQTT credentials
        hello_message = {
            "type": "hello",
            "version": 3,
            "transport": "mqtt",
            "audio_params": {
                "sample_rate": 16000,
                "channels": 1,
                "frame_duration": 20,
                "format": "opus"
            },
            "features": ["tts", "asr", "vad"]
        }
        if feature:
            hello_message["feature"] = feature
        self.mqtt_client.publish("device-server", json.dumps(hello_message))
        try:
            response = mqtt_message_queue.get(timeout=30)
            if response.get("type") == "hello" and "udp" in response:
                global udp_session_details
                udp_session_details = response
                self.udp_socket = socket.socket(
                    socket.AF_INET, socket.SOCK_DGRAM)
                # Increase UDP receive buffer to handle burst traffic
                self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)  # 1MB buffer
                self.udp_socket.settimeout(1.0)
                ping_payload = f"ping:{udp_session_details['session_id']}".encode(
                )
                encrypted_ping = self.encrypt_packet(ping_payload)
                server_udp_addr = (
                    udp_session_details['udp']['server'], udp_session_details['udp']['port'])
                logger.info(f"[RETRY] Sending UDP Ping to {server_udp_addr} with session ID {udp_session_details['session_id']}"
                            f" and key {udp_session_details['udp']['key']}"
                            f" (local sequence: {self.udp_local_sequence})"
                            )
                if encrypted_ping:
                    self.udp_socket.sendto(encrypted_ping, server_udp_addr)
                    logger.info(f"[OK] UDP Ping sent. Session configured.")
                    return True
            logger.error(f"[ERROR] Received unexpected message: {response}")
            return False
        except Empty:
            logger.error("[ERROR] Timed out waiting for 'hello' response.")
            return False

    def _playback_thread(self):
        """Thread to play back incoming audio from the server with a robust jitter buffer."""
        p = pyaudio.PyAudio()
        audio_params = udp_session_details["audio_params"]
        stream = p.open(format=p.get_format_from_width(2),
                        channels=audio_params["channels"],
                        rate=audio_params["sample_rate"],
                        output=True)

        logger.info("[PLAY] Playback thread started.")
        is_playing = False
        buffer_timeout_start = time.time()
        last_buffer_log_time = 0

        while not stop_threads.is_set() and self.session_active:
            try:
                # --- JITTER BUFFER LOGIC ---
                if not is_playing:
                    # Wait until we have enough frames to start playback smoothly
                    if self.audio_playback_queue.qsize() < PLAYBACK_BUFFER_START_FRAMES:
                        # Check for timeout
                        if time.time() - buffer_timeout_start > BUFFER_TIMEOUT_SECONDS:
                            logger.warning(
                                f"[TIME] Buffer timeout after {BUFFER_TIMEOUT_SECONDS}s. Queue size: {self.audio_playback_queue.qsize()}")
                            if self.tts_active:
                                logger.warning(
                                    "[PLAY] TTS is active but no audio received. Possible server issue.")
                            buffer_timeout_start = time.time()  # Reset timeout

                        current_time = time.time()
                        if current_time - last_buffer_log_time >= 1.0:
                            logger.info(
                                f"[AUDIO] Buffering audio... {self.audio_playback_queue.qsize()}/{PLAYBACK_BUFFER_START_FRAMES}")
                            last_buffer_log_time = current_time
                            
                        time.sleep(0.05)
                        continue
                    else:
                        logger.info("[OK] Buffer ready. Starting playback.")
                        is_playing = True

                # --- If buffer runs low, stop playing and re-buffer ---
                if self.audio_playback_queue.qsize() < PLAYBACK_BUFFER_MIN_FRAMES:
                    is_playing = False
                    buffer_timeout_start = time.time()  # Reset timeout when buffering starts
                    logger.warning(
                        f"[ALERT] Playback buffer low ({self.audio_playback_queue.qsize()}). Re-buffering...")
                    continue

                # Get audio chunk from the queue and play it
                stream.write(self.audio_playback_queue.get(timeout=1))

            except Empty:
                is_playing = False
                buffer_timeout_start = time.time()  # Reset timeout
                continue
            except Exception as e:
                logger.error(f"Playback error: {e}")
                break

        stream.stop_stream()
        stream.close()
        p.terminate()
        logger.info("[PLAY] Playback thread finished.")

    def listen_for_udp_audio(self):
        """Thread to listen for incoming UDP audio from the server with sequence tracking."""
        logger.info(
            f"[AUDIO] UDP Listener started on local socket {self.udp_socket.getsockname()}")
        aes_key = bytes.fromhex(udp_session_details["udp"]["key"])
        audio_params = udp_session_details["audio_params"]

        # Initialize the decoder with the sample rate provided by the server
        decoder = opuslib.Decoder(
            audio_params["sample_rate"], audio_params["channels"])
        frame_size_samples = int(
            audio_params["sample_rate"] * audio_params["frame_duration"] / 1000)
        # Maximum frame size for Opus (120ms at 48kHz = 5760 samples, but we'll use a larger buffer)
        # 120ms worth of samples
        max_frame_size = int(audio_params["sample_rate"] * 0.12)

        while not stop_threads.is_set() and self.session_active:
            try:
                data, addr = self.udp_socket.recvfrom(4096)
                if data and len(data) > 16:
                    header, encrypted = data[:16], data[16:]

                    # --- Parse header to extract sequence number (optimized) ---
                    if ENABLE_SEQUENCE_LOGGING:
                        header_info = self.parse_packet_header(header)
                        if header_info:
                            sequence = header_info.get('sequence', 0)
                            # Track sequence for analysis (minimal processing)
                            self.track_sequence(sequence)
                            
                            # Only log details for first few packets to reduce overhead
                            if self.total_packets_received <= 5:
                                timestamp = header_info.get('timestamp', 0)
                                payload_len = header_info.get('payload_len', 0)
                                logger.info(
                                    f"[PKT] Packet details: seq={sequence}, payload={payload_len}B, ts={timestamp}, from={addr}")

                    # Decrypt and decode as usual
                    cipher = Cipher(algorithms.AES(aes_key), modes.CTR(
                        header), backend=default_backend())
                    decryptor = cipher.decryptor()
                    opus_payload = decryptor.update(
                        encrypted) + decryptor.finalize()

                    # Decode the Opus payload to PCM and put it in the playback queue
                    # Use max_frame_size to provide enough buffer space for variable frame sizes
                    pcm_payload = decoder.decode(opus_payload, max_frame_size)
                    self.audio_playback_queue.put(pcm_payload)

            except socket.timeout:
                continue
            except Exception as e:
                logger.error(f"UDP Listen Error: {e}", exc_info=True)

        logger.info("[BYE] UDP Listener shutting down.")

    def _record_and_send_audio_thread(self):
        """Thread to record microphone audio and send it to the server."""
        # Main loop to keep the thread alive for multiple recording sessions
        while not stop_threads.is_set() and self.session_active:
            # Wait here until the start event is set (e.g., after TTS stop)
            if not start_recording_event.wait(timeout=1):
                continue

            # If the main stop signal was set while waiting, exit the thread
            if stop_threads.is_set():
                break

            logger.info("[REC] Recording thread activated. Capturing audio.")
            p = pyaudio.PyAudio()
            audio_params = udp_session_details["audio_params"]
            FORMAT, CHANNELS, RATE, FRAME_DURATION_MS = pyaudio.paInt16, audio_params[
                "channels"], audio_params["sample_rate"], audio_params["frame_duration"]
            SAMPLES_PER_FRAME = int(RATE * FRAME_DURATION_MS / 1000)

            try:
                encoder = opuslib.Encoder(
                    RATE, CHANNELS, opuslib.APPLICATION_VOIP)
            except Exception as e:
                logger.error(f"[ERROR] Failed to create Opus encoder: {e}")
                return  # Exit thread if encoder fails

            stream = p.open(format=FORMAT, channels=CHANNELS, rate=RATE,
                            input=True, frames_per_buffer=SAMPLES_PER_FRAME)
            logger.info(
                "[MIC] Microphone stream opened. Sending audio to server...")
            server_udp_addr = (
                udp_session_details['udp']['server'], udp_session_details['udp']['port'])

            packets_sent = 0
            last_log_time = time.time()

            # Inner loop for the active recording session
            while not stop_threads.is_set() and not stop_recording_event.is_set() and self.session_active:
                try:
                    pcm_data = stream.read(
                        SAMPLES_PER_FRAME, exception_on_overflow=False)
                    opus_data = encoder.encode(pcm_data, SAMPLES_PER_FRAME)
                    encrypted_packet = self.encrypt_packet(opus_data)

                    if encrypted_packet:
                        self.udp_socket.sendto(
                            encrypted_packet, server_udp_addr)
                        packets_sent += 1

                        if time.time() - last_log_time >= 1.0:
                            logger.info(
                                f"[UP]  Sent {packets_sent} audio packets in the last second.")
                            packets_sent = 0
                            last_log_time = time.time()

                except Exception as e:
                    logger.error(
                        f"An error occurred in the recording loop: {e}")
                    break  # Exit inner loop on error

            # Cleanup for the current recording session
            logger.info("[MIC] Stopping microphone stream for this session.")
            stream.stop_stream()
            stream.close()
            p.terminate()

            # Clear the start event so it has to be triggered again for the next session
            start_recording_event.clear()

            if stop_recording_event.is_set():
                logger.info(
                    "[STOP] Recording stopped by server signal. Waiting for next turn.")

        logger.info("[REC] Recording thread finished completely.")

    def trigger_conversation(self):
        """Starts the audio streaming threads and sends initial listen message."""
        if not self.udp_socket:
            return False
        logger.info("[STEP] STEP 4: Starting all streaming audio threads...")
        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.clear()
        # Initially, clear both events. The server's initial TTS will set start_recording_event.
        start_recording_event.clear()
        stop_recording_event.clear()

        self.playback_thread = threading.Thread(
            target=self._playback_thread, daemon=True)
        self.udp_listener_thread = threading.Thread(
            target=self.listen_for_udp_audio, daemon=True)
        self.audio_recording_thread = threading.Thread(
            target=self._record_and_send_audio_thread, daemon=True)
        self.playback_thread.start(), self.udp_listener_thread.start(
        ), self.audio_recording_thread.start()

        logger.info(
            "[STEP] STEP 5: Sending 'listen' message to trigger initial TTS from server...")
        # The server's initial TTS will then trigger the client's recording.
        listen_payload = {
            "type": "listen", "session_id": udp_session_details["session_id"], "state": "detect", "text": "hello baby"}
        self.mqtt_client.publish("device-server", json.dumps(listen_payload))
        logger.info(
            "[WAIT] Test running. Press Spacebar to abort TTS or Ctrl+C to stop.")
        if self.rfid_cards:
            logger.info("[RFID] Press a number key to mimic an RFID card tap (switch character):")
            for i, (label, uid) in enumerate(self.rfid_cards, 1):
                logger.info("   [%d] %s  (uid=%s)", i, label, uid)

        # Start a thread to monitor spacebar (abort) and number keys (RFID mimic)
        def monitor_spacebar():
            while not stop_threads.is_set() and self.session_active:
                if keyboard.is_pressed('space'):
                    logger.info(
                        "[EMOJI] Spacebar pressed. Sending abort message to server...")
                    abort_payload = {
                        "type": "abort",
                        "session_id": udp_session_details["session_id"]
                    }
                    self.mqtt_client.publish(
                        "device-server", json.dumps(abort_payload))
                    logger.info(f"[EMOJI] Sent abort message: {abort_payload}")
                    # Wait for the key to be released to avoid multiple sends
                    while keyboard.is_pressed('space') and not stop_threads.is_set():
                        time.sleep(0.01)

                for i, (label, uid) in enumerate(self.rfid_cards):
                    key = str(i + 1)
                    if keyboard.is_pressed(key):
                        logger.info("[RFID] Key %s -> tapping card %s", key, label)
                        self.mimic_rfid_scan(uid)
                        while keyboard.is_pressed(key) and not stop_threads.is_set():
                            time.sleep(0.01)

                time.sleep(0.01)

        spacebar_thread = threading.Thread(
            target=monitor_spacebar, daemon=True)
        spacebar_thread.start()

        try:
            # Keep running with better timeout handling
            timeout_count = 0
            while not stop_threads.is_set() and self.session_active:
                time.sleep(1)

                # Check if we've been inactive for too long
                if self.tts_active and time.time() - self.last_audio_received > TTS_TIMEOUT_SECONDS:
                    logger.warning(
                        f"[TIME] No audio received for {TTS_TIMEOUT_SECONDS}s during TTS. Possible server issue.")
                    timeout_count += 1
                    if timeout_count >= 3:
                        logger.error("[ERROR] Too many timeouts. Stopping session.")
                        self.session_active = False
                        break
                    else:
                        logger.info(
                            "[RETRY] Attempting to recover by sending new listen message...")
                        self.retry_conversation()

        except KeyboardInterrupt:
            logger.info("Manual interruption detected. Cleaning up...")
            stop_threads.set()
            self.session_active = False
        return True

    def cleanup(self):
        """Cleans up resources and disconnects."""
        logger.info("[STEP] STEP 6: Cleaning up and disconnecting...")
        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.set()
        self.session_active = False
        start_recording_event.set()  # Unblock if waiting
        stop_recording_event.set()  # Unblock if running

        # Print final sequence summary
        if ENABLE_SEQUENCE_LOGGING and self.total_packets_received > 0:
            logger.info("[STATS] FINAL SEQUENCE SUMMARY")
            self.print_sequence_summary()

        if self.audio_recording_thread:
            logger.info("Attempting to join audio_recording_thread...")
            self.audio_recording_thread.join(timeout=2)
            if self.audio_recording_thread.is_alive():
                logger.warning(
                    "Audio recording thread did not terminate gracefully.")

        if self.playback_thread:
            self.playback_thread.join(timeout=2)
        if self.udp_listener_thread:
            self.udp_listener_thread.join(timeout=2)
        if self.udp_socket:
            self.udp_socket.close()

        if self.mqtt_client and udp_session_details:
            goodbye_payload = {"type": "goodbye",
                               "session_id": udp_session_details.get("session_id")}
            self.mqtt_client.publish(
                "device-server", json.dumps(goodbye_payload))
            logger.info("[BYE] Sent 'goodbye' message.")

        if self.mqtt_client:
            self.mqtt_client.loop_stop()
            self.mqtt_client.disconnect()
            logger.info("[DISC] MQTT Disconnected.")
        logger.info("[OK] Test finished.")

    def run_test(self):
        """Runs the full test sequence."""
        if ENABLE_SEQUENCE_LOGGING:
            logger.info("[SEQ] Sequence tracking is ENABLED")
            logger.info(
                f"[STATS] Will log sequence info every {LOG_SEQUENCE_EVERY_N_PACKETS} packets")
        else:
            logger.info("[SEQ] Sequence tracking is DISABLED")

        if not self.get_ota_config():
            return
        if not self.connect_mqtt():
            return
        time.sleep(1)  # Give MQTT a moment to connect and subscribe
        if not self.send_hello_and_get_session():
            self.cleanup()
            return
        self.trigger_conversation()
        self.cleanup()

    def run_rfid_test(
        self,
        rfid_uid: str,
        local_version: Optional[str] = None,
        local_content_hash: Optional[str] = None,
        local_skill_id: Optional[str] = None,
        request_download: bool = False,
        download_current_version: Optional[str] = None,
        analytics_token: Optional[str] = None,
    ):
        """Run a focused RFID tap/version test against local services."""
        self.setup_local_test_config()
        if not self.connect_mqtt():
            return

        time.sleep(1)
        lookup_response = self.send_rfid_card_lookup(
            rfid_uid=rfid_uid,
            local_version=local_version,
            local_content_hash=local_content_hash,
            local_skill_id=local_skill_id,
        )
        if lookup_response is None:
            logger.error("[RFID-TEST] Timed out waiting for card lookup response")
        else:
            logger.info("[RFID-TEST] card_lookup response:\n%s", json.dumps(lookup_response, indent=2))

        if request_download:
            effective_version = download_current_version if download_current_version is not None else local_version
            download_response = self.request_content_download(
                rfid_uid=rfid_uid,
                current_version=effective_version,
            )
            if download_response is None:
                logger.error("[RFID-TEST] Timed out waiting for download_response")
            else:
                logger.info("[RFID-TEST] download_response:\n%s", json.dumps(download_response, indent=2))

        if analytics_token:
            self.fetch_card_tap_analytics(analytics_token, uid=rfid_uid)
        else:
            logger.info("[RFID-TEST] Skipping analytics fetch because no auth token was provided")

        self.cleanup()

    def save_image_from_url(self, url: str, request_id: str = "") -> Optional[str]:
        """Download the generated AI Imagine image and save it under imagine_outputs/.

        Mimics the device fetching the image{url} over HTTPS. Returns the saved path.
        """
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
        except requests.exceptions.RequestException as exc:
            logger.error("[IMAGINE] Failed to download image from %s: %s", url, exc)
            return None

        os.makedirs("imagine_outputs", exist_ok=True)
        name = request_id or uuid.uuid4().hex[:8]
        path = os.path.join("imagine_outputs", f"{name}.jpg")
        with open(path, "wb") as fh:
            fh.write(resp.content)
        logger.info("[IMAGINE] Saved image -> %s (%d bytes)", path, len(resp.content))
        try:
            os.startfile(path)  # Windows: open in the default image viewer
        except Exception:
            pass  # headless / non-Windows: just leave the file on disk
        return path

    def run_imagine_test(self, use_ota: bool = False) -> None:
        """AI Imagine: speak a prompt, receive a generated image URL, download it.

        Hold SPACE and speak your prompt; release to generate. Repeat for more images.
        Ctrl+C to quit. No TTS playback — the response is an image, not audio.
        """
        if use_ota:
            if not self.get_ota_config():
                return
        else:
            self.setup_local_test_config()
        if not self.connect_mqtt():
            return
        time.sleep(1)  # Give MQTT a moment to connect and subscribe
        if not self.send_hello_and_get_session(feature="ai_imagine"):
            self.cleanup()
            return

        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.clear()
        start_recording_event.clear()
        stop_recording_event.clear()

        # Only the mic record/send thread is needed; there is no return audio to play.
        self.audio_recording_thread = threading.Thread(
            target=self._record_and_send_audio_thread, daemon=True)
        self.audio_recording_thread.start()

        session_id = udp_session_details["session_id"]
        logger.info("[IMAGINE] Hold SPACE and speak your prompt; release to generate. Ctrl+C to quit.")
        try:
            while not stop_threads.is_set() and self.session_active:
                if not keyboard.is_pressed('space'):
                    time.sleep(0.02)
                    continue

                # SPACE down -> start capturing. The gateway taps the raw Opus frames
                # for the session regardless of listen/start, so we just stream audio.
                logger.info("[IMAGINE] Listening... (release SPACE to send)")
                stop_recording_event.clear()
                start_recording_event.set()
                while keyboard.is_pressed('space') and not stop_threads.is_set():
                    time.sleep(0.02)

                # SPACE up -> stop capturing and signal end of utterance (the trigger).
                stop_recording_event.set()
                start_recording_event.clear()
                self.mqtt_client.publish("device-server", json.dumps(
                    {"type": "speech_end", "session_id": session_id}))
                logger.info("[IMAGINE] Sent speech_end; waiting for image...")

                result = self.wait_for_message({"image", "image_error"}, timeout=40)
                if result is None:
                    logger.error("[IMAGINE] Timed out waiting for image.")
                elif result.get("type") == "image_error":
                    logger.error("[IMAGINE] image_error: code=%s msg=%s",
                                 result.get("code"), result.get("message"))
                else:
                    logger.info("[IMAGINE] image received:\n%s", json.dumps(result, indent=2))
                    if result.get("url"):
                        self.save_image_from_url(result["url"], result.get("request_id", ""))

                time.sleep(0.3)  # debounce before the next prompt
        except KeyboardInterrupt:
            logger.info("Manual interruption detected. Cleaning up...")
            stop_threads.set()
            self.session_active = False
        self.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Cheeko test client. Defaults to voice mode; use --mode rfid with --rfid-uid for card tests."
    )
    parser.add_argument(
        "--mode",
        choices=["voice", "rfid", "imagine"],
        default="voice",
        help="Test mode to run. RFID mode requires --rfid-uid. "
             "imagine mode = AI Imagine (speak a prompt, get a generated image).",
    )
    parser.add_argument(
        "--ota",
        action="store_true",
        help="imagine mode: use the OTA handshake instead of the local-gateway config.",
    )
    parser.add_argument("--device-mac", default=os.getenv("TEST_DEVICE_MAC", "00:16:3e:ac:b5:38"))
    parser.add_argument("--rfid-uid", default=os.getenv("TEST_RFID_UID"))
    parser.add_argument(
        "--cards",
        default=os.getenv("TEST_RFID_CARDS"),
        help='Voice mode: cards to tap with number keys, e.g. "Tenali:E91C3E0E,Bheem:A1B2C3D4". '
             '"label:uid" or bare "uid".',
    )
    parser.add_argument("--local-version", default=os.getenv("TEST_LOCAL_VERSION"))
    parser.add_argument("--local-content-hash", default=os.getenv("TEST_LOCAL_CONTENT_HASH"))
    parser.add_argument("--local-skill-id", default=os.getenv("TEST_LOCAL_SKILL_ID"))
    parser.add_argument("--request-download", action="store_true")
    parser.add_argument("--download-current-version", default=os.getenv("TEST_DOWNLOAD_CURRENT_VERSION"))
    parser.add_argument("--analytics-token", default=os.getenv("TEST_MANAGER_API_TOKEN"))
    args = parser.parse_args()

    print(f"[SEQ] Sequence logging: {'ENABLED' if ENABLE_SEQUENCE_LOGGING else 'DISABLED'}")
    print(f"[STATS] Log frequency: Every {LOG_SEQUENCE_EVERY_N_PACKETS} packets")

    def parse_cards(spec, fallback_uid):
        cards = []
        for item in (spec or "").split(","):
            item = item.strip()
            if not item:
                continue
            label, uid = (item.split(":", 1) + [item])[:2] if ":" in item else (item, item)
            cards.append((label.strip(), uid.strip()))
        if not cards and fallback_uid:
            cards.append((fallback_uid, fallback_uid))
        return cards

    client = TestClient(device_mac=args.device_mac)
    client.rfid_cards = parse_cards(args.cards, args.rfid_uid)
    try:
        if args.mode == "voice":
            client.run_test()
        elif args.mode == "imagine":
            client.run_imagine_test(use_ota=args.ota)
        else:
            if not args.rfid_uid:
                raise SystemExit("--rfid-uid is required in --mode rfid")
            client.run_rfid_test(
                rfid_uid=args.rfid_uid,
                local_version=args.local_version,
                local_content_hash=args.local_content_hash,
                local_skill_id=args.local_skill_id,
                request_download=args.request_download,
                download_current_version=args.download_current_version,
                analytics_token=args.analytics_token,
            )
    except KeyboardInterrupt:
        logger.info("Manual interruption detected. Cleaning up...")
        client.cleanup()
