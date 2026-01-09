import json
import time
import uuid
import threading
import socket
import struct
import logging
import pyaudio
import keyboard
from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional, Tuple, Callable
import requests
import paho.mqtt.client as mqtt_client
from paho.mqtt.enums import CallbackAPIVersion
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from queue import Queue, Empty
import opuslib
import asyncio
import numpy as np

# LiveKit SDK imports (optional - for direct connection mode)
try:
    from livekit import rtc
    LIVEKIT_AVAILABLE = True
except ImportError:
    LIVEKIT_AVAILABLE = False
    rtc = None

# --- Configuration ---

SERVER_IP = "192.168.1.2"
OTA_PORT = 8002
MQTT_BROKER_HOST = "192.168.1.2"


MQTT_BROKER_PORT = 1883
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
    secret_key = "test-signature-key-12345"
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


# ============================================================================
# ESP32-Style LiveKit Classes
# ============================================================================

class LiveKitFailureReason(Enum):
    """
    Structured failure reasons matching ESP32 SDK.
    Provides clear error categorization for LiveKit connection failures.
    """
    NONE = 0
    UNREACHABLE = 1
    BAD_TOKEN = 2
    UNAUTHORIZED = 3
    DUPLICATE_IDENTITY = 4
    PING_TIMEOUT = 5
    CONNECTION_TIMEOUT = 6
    RTC_ERROR = 7
    OTHER = 99


class LiveKitError(Exception):
    """
    ESP32-style structured error with failure reason.
    """
    def __init__(self, reason: LiveKitFailureReason, message: str):
        self.reason = reason
        super().__init__(f"[{reason.name}] {message}")


@dataclass
class LiveKitRoomOptions:
    """
    ESP32-style declarative room configuration.
    All media and event handling options are specified upfront.
    """
    # Publish options
    publish_audio: bool = True
    audio_sample_rate: int = 16000
    audio_channels: int = 1
    
    # Subscribe options
    subscribe_audio: bool = True
    auto_subscribe: bool = True  # Automatically subscribe to remote tracks
    
    # Event callbacks (ESP32-style)
    on_state_changed: Optional[Callable[[str], None]] = None
    on_participant_connected: Optional[Callable[[any, str], None]] = None  # (participant, kind)
    on_participant_disconnected: Optional[Callable[[any], None]] = None
    on_track_subscribed: Optional[Callable[[any, any], None]] = None  # (track, participant)
    on_data_received: Optional[Callable[[dict], None]] = None


class LiveKitAudioClient:
    """
    ESP32-style LiveKit Audio Client for direct WebRTC connection.
    Event-driven architecture with declarative configuration.
    """

    def __init__(self, url: str, token: str, room_name: str, audio_playback_queue: Queue, audio_params: dict = None, options: Optional[LiveKitRoomOptions] = None):
        if not LIVEKIT_AVAILABLE:
            raise RuntimeError("LiveKit SDK not available. Install with: pip install livekit livekit-rtc")

        # Use provided options or create default
        self.options = options or LiveKitRoomOptions()
        
        self.url = url
        self.token = token
        self.room_name = room_name
        self.audio_playback_queue = audio_playback_queue
        self.audio_params = audio_params or {"sample_rate": 24000, "channels": 1}  # Default from gateway
        self.room = None  # Will be initialized in the async loop
        
        # ESP32-style failure tracking
        self.failure_reason = LiveKitFailureReason.NONE
        
        # Audio configuration from options
        self.audio_source = rtc.AudioSource(
            self.options.audio_sample_rate, 
            self.options.audio_channels
        )
        self.audio_stream = None
        self.connected = False
        self.stop_event = threading.Event()
        self._loop = None
        self._thread = None

        # Audio decoder for received Opus frames
        try:
            self.decoder = opuslib.Decoder(24000, 1)  # 24kHz mono for output
        except Exception as e:
            logger.error(f"[LIVEKIT] Failed to create Opus decoder: {e}")
            self.decoder = None

        logger.info(f"[LIVEKIT] Initialized ESP32-style client for room: {room_name}")

    def start(self):
        """Start the LiveKit connection in a separate thread."""
        self._thread = threading.Thread(target=self._run_async, daemon=True)
        self._thread.start()

    def _run_async(self):
        """Run the async event loop in a thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._connect_and_run())
        except Exception as e:
            logger.error(f"[LIVEKIT] Error in async loop: {e}")
        finally:
            self._loop.close()

    async def _connect_and_run(self):
        """ESP32-style connect with automatic setup and error handling."""
        try:
            # Create room in the correct loop
            self.room = rtc.Room()
            
            # Register event listeners
            self.room.on("track_subscribed", self._on_track_subscribed)
            self.room.on("data_received", self._on_data_received)
            self.room.on("participant_connected", self._on_participant_connected)
            self.room.on("participant_disconnected", self._on_participant_disconnected)
            self.room.on("disconnected", self._on_disconnected)

            # Connect to LiveKit room
            logger.info(f"[LIVEKIT] Connecting to {self.url}...")
            await self.room.connect(self.url, self.token)
            self.connected = True
            local_id = self.room.local_participant.identity if self.room.local_participant else "None"
            logger.info(f"[LIVEKIT] Connected to room: {self.room.name} as {local_id}")

            # ESP32-style duplicate identity detection
            if local_id in self.room.remote_participants:
                self.failure_reason = LiveKitFailureReason.DUPLICATE_IDENTITY
                raise LiveKitError(
                    LiveKitFailureReason.DUPLICATE_IDENTITY,
                    f"Duplicate identity detected: {local_id}"
                )

            # ESP32-style: Force global subscription if enabled
            if self.options.subscribe_audio and self.options.auto_subscribe:
                # Subscribe to all existing remote participants' tracks
                for participant in self.room.remote_participants.values():
                    for pub in participant.track_publications.values():
                        pub.set_subscribed(True)
                logger.info("[LIVEKIT] Auto-subscribe enabled for all existing tracks")

            # ESP32-style: Auto-publish audio if configured
            if self.options.publish_audio:
                try:
                    await self._auto_publish_audio()
                except Exception as pub_err:
                    logger.error(f"[LIVEKIT] Auto-publish failed: {pub_err}")
                    # Continue anyway - we can still receive audio

            # Check for already present participants
            for p in self.room.remote_participants.values():
                kind = self._get_participant_kind(p)
                logger.info(f"[LIVEKIT] Existing participant: {p.identity} (kind: {kind})")
                
                # Trigger callback if provided
                if self.options.on_participant_connected:
                    self.options.on_participant_connected(p, kind)

            # Keep connection alive (event-driven, no polling)
            logger.info("[LIVEKIT] Connection established - waiting for events...")
            while not self.stop_event.is_set():
                await asyncio.sleep(1)

        except LiveKitError as lk_err:
            logger.error(f"[LIVEKIT] LiveKit error: {lk_err}")
            self.failure_reason = lk_err.reason
        except Exception as e:
            logger.error(f"[LIVEKIT] Connection error: {e}")
            self.failure_reason = LiveKitFailureReason.OTHER
        finally:
            # Only disconnect if we actually connected
            if self.connected:
                try:
                    await self.room.disconnect()
                except Exception as disc_err:
                    logger.warning(f"[LIVEKIT] Disconnect error: {disc_err}")
                finally:
                    self.connected = False
                    logger.info("[LIVEKIT] Disconnected")

    async def _auto_publish_audio(self):
        """ESP32-style automatic audio track publishing."""
        try:
            logger.info("[LIVEKIT] Auto-publishing audio track...")
            track = rtc.LocalAudioTrack.create_audio_track("microphone", self.audio_source)
            
            publish_options = rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_MICROPHONE
            )
            
            await self.room.local_participant.publish_track(track, publish_options)
            logger.info("[LIVEKIT] Audio track published successfully")
        except Exception as e:
            logger.error(f"[LIVEKIT] Failed to publish audio: {e}")
            raise

    def _get_participant_kind(self, participant) -> str:
        """
        ESP32-style participant kind detection.
        Returns: "AGENT", "GATEWAY", or "STANDARD"
        """
        identity = participant.identity.lower()
        
        if "agent" in identity:
            return "AGENT"
        elif "gateway" in identity:
            return "GATEWAY"
        else:
            return "STANDARD"

    def get_failure_reason(self) -> LiveKitFailureReason:
        """ESP32-style failure reason getter."""
        return self.failure_reason

    def _on_track_subscribed(self, track, publication, participant):
        """ESP32-style track subscription handler."""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            logger.info(f"[LIVEKIT] Subscribed to audio from: {participant.identity}")
            # Create AudioStream with the sample rate from audio_params (24kHz from gateway)
            self.audio_stream = rtc.AudioStream(
                track,
                sample_rate=self.audio_params["sample_rate"],
                num_channels=self.audio_params["channels"]
            )
            # Start receiving audio in a separate task
            asyncio.create_task(self._receive_audio())
            
            # Trigger user callback if provided
            if self.options.on_track_subscribed:
                self.options.on_track_subscribed(track, participant)

    def _on_participant_connected(self, participant):
        """ESP32-style participant connection handler with auto-subscribe."""
        kind = self._get_participant_kind(participant)
        logger.info(f"[LIVEKIT] Participant connected: {participant.identity} (kind: {kind})")
        
        # ESP32-style: Auto-subscribe to all tracks from this participant
        if self.options.auto_subscribe:
            for pub in participant.track_publications.values():
                pub.set_subscribed(True)
        
        # Trigger user callback if provided
        if self.options.on_participant_connected:
            self.options.on_participant_connected(participant, kind)

    def _on_participant_disconnected(self, participant):
        """ESP32-style participant disconnection handler."""
        kind = self._get_participant_kind(participant)
        logger.info(f"[LIVEKIT] Participant disconnected: {participant.identity} (kind: {kind})")
        
        # Trigger user callback if provided
        if self.options.on_participant_disconnected:
            self.options.on_participant_disconnected(participant)
    
    def _on_disconnected(self):
        """Handle room disconnection."""
        logger.info("[LIVEKIT] Disconnected from room")
        self.connected = False

    def _on_data_received(self, data_packet):
        """ESP32-style data message handler."""
        try:
            payload = json.loads(data_packet.data.decode('utf-8'))
            msg_type = payload.get('type', 'unknown')
            logger.info(f"[LIVEKIT] Data received: {msg_type}")

            # Trigger user callback if provided
            if self.options.on_data_received:
                self.options.on_data_received(payload)
            
            # Handle agent state changes directly (backward compatibility)
            if msg_type == 'agent_state_changed':
                state = payload.get('state', '')
                logger.info(f"[LIVEKIT] Agent state: {state}")
                if state == 'listening':
                    # Agent is listening - start recording immediately!
                    logger.info("[LIVEKIT] Agent is listening - enabling microphone")
                    stop_recording_event.clear()
                    start_recording_event.set()

            # Forward to MQTT message queue for processing by TestClient (backward compatibility)
            mqtt_message_queue.put(payload)
        except Exception as e:
            logger.error(f"[LIVEKIT] Error processing data: {e}")

    async def _send_audio_async(self, pcm_data: bytes):
        """Async method to capture audio frame to LiveKit AudioSource."""
        try:
            # Convert PCM bytes to numpy array
            audio_array = np.frombuffer(pcm_data, dtype=np.int16)
            
            # Create AudioFrame and capture it
            frame = rtc.AudioFrame(
                data=audio_array.tobytes(),
                sample_rate=self.options.audio_sample_rate,
                num_channels=self.options.audio_channels,
                samples_per_channel=len(audio_array) // self.options.audio_channels
            )
            
            await self.audio_source.capture_frame(frame)
        except Exception as e:
            logger.error(f"[LIVEKIT] Error capturing audio frame: {e}")

    def send_audio(self, pcm_data: bytes):
        """
        Thread-safe method to send audio from recording thread to LiveKit.
        Schedules the async audio capture on the event loop.
        """
        if not self._loop or not self.connected:
            return
        
        try:
            # Schedule the async operation on the event loop
            asyncio.run_coroutine_threadsafe(
                self._send_audio_async(pcm_data),
                self._loop
            )
        except Exception as e:
            logger.error(f"[LIVEKIT] Failed to schedule audio send: {e}")

    async def _send_data_async(self, data: dict):
        """Async method to send data message to LiveKit room."""
        if not self.connected or not self.room or not self.room.local_participant:
            return
        try:
            payload = json.dumps(data).encode('utf-8')
            await self.room.local_participant.publish_data(payload, reliable=True)
            logger.info(f"[LIVEKIT] Sent data message: {data.get('type', 'unknown')}")
        except Exception as e:
            logger.error(f"[LIVEKIT] Error sending data: {e}")

    def send_data(self, data: dict):
        """Thread-safe method to send data message."""
        if not self._loop or not self.connected:
            return
        
        try:
            asyncio.run_coroutine_threadsafe(
                self._send_data_async(data),
                self._loop
            )
        except Exception as e:
            logger.error(f"[LIVEKIT] Failed to schedule data send: {e}")

    async def _receive_audio(self):
        """Receive and queue audio frames from the agent."""
        logger.info("[LIVEKIT] Started receiving audio stream")
        frame_count = 0
        try:
            async for event in self.audio_stream:
                if self.stop_event.is_set():
                    break

                frame = event.frame  # Extract AudioFrame from AudioFrameEvent
                frame_count += 1
                if frame_count == 1:
                    logger.info(f"[LIVEKIT] First audio frame received! sample_rate={frame.sample_rate}, channels={frame.num_channels}")
                elif frame_count % 100 == 0:
                    logger.info(f"[LIVEKIT] Received {frame_count} audio frames")

                # Convert AudioFrame to PCM bytes
                pcm_data = frame.data.tobytes()

                # Queue for playback
                self.audio_playback_queue.put(pcm_data)

        except Exception as e:
            logger.info(f"[LIVEKIT] Audio stream ended or error: {e}")
        finally:
            logger.info(f"[LIVEKIT] Audio stream task finished. Total frames: {frame_count}")

    def stop(self):
        """Stop the LiveKit connection."""
        logger.info("[LIVEKIT] Stopping...")
        self.stop_event.set()
        if self._loop and self.connected and self.room:
            try:
                # Schedule disconnection
                asyncio.run_coroutine_threadsafe(self.room.disconnect(), self._loop)
            except Exception as e:
                logger.warning(f"[LIVEKIT] Error during stop: {e}")
        
        if self._thread:
            self._thread.join(timeout=2)
        
        self.connected = False
        logger.info("[LIVEKIT] Stopped")


class TestClient:
    def __init__(self):
        self.mqtt_client = None
        # Generate a unique MAC address for this client instance
        self.device_mac_formatted = "00:16:3e:ac:b5:38"
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
        self.expected_sequence = 1  # Expected next sequence number
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

        # --- LiveKit direct connection ---
        self.livekit_client = None
        self.use_livekit_direct = False  # Will be set based on hello response

        logger.info(
            f"Client initialized with unique MAC: {self.device_mac_formatted}")

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

                # Only proceed with recording if we actually received audio
                if self.total_packets_received > 0:
                    # Clear the stop event to allow the recording thread to continue or start
                    stop_recording_event.clear()
                    # Set the start event to signal the recording thread to begin (if it was waiting)
                    start_recording_event.set()
                    logger.info(
                        "[MIC] Cleared stop_recording_event and set start_recording_event for next recording.")
                else:
                    logger.warning(
                        "[WARN] No audio packets received during TTS. Server may have an issue.")
                    # Try to trigger another conversation after a short delay
                    threading.Timer(2.0, self.retry_conversation).start()

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
        self.expected_sequence = 1
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

        # Calculate packet loss percentage
        if self.last_received_sequence > 0:
            expected_total = self.last_received_sequence
            loss_rate = (self.missing_packets / expected_total) * 100
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

    def send_hello_and_get_session(self) -> bool:
        """Sends 'hello' message and waits for session details."""
        logger.info("[STEP] STEP 3: Sending 'hello' and pinging UDP...")

        # Determine capabilities based on LiveKit SDK availability
        capabilities = ["udp"]  # Always support UDP fallback
        if LIVEKIT_AVAILABLE:
            capabilities.append("livekit_direct")
            logger.info("[LIVEKIT] LiveKit SDK available - requesting direct connection")

        # Use the client_id from our generated MQTT credentials
        hello_message = {
            "type": "hello",
            "version": 4,  # Bumped version for new protocol
            "transport": "mqtt",
            "capabilities": capabilities,  # NEW: Advertise client capabilities
            "audio_params": {
                "sample_rate": 16000,
                "channels": 1,
                "frame_duration": 20,
                "format": "opus"
            },
            "features": ["tts", "asr", "vad"]
        }
        self.mqtt_client.publish("device-server", json.dumps(hello_message))
        try:
            # Wait for specifically the 'hello' response, skip other messages like mode_update
            start_time = time.time()
            timeout_seconds = 30
            while time.time() - start_time < timeout_seconds:
                try:
                    remaining_time = timeout_seconds - (time.time() - start_time)
                    if remaining_time <= 0:
                        break
                    response = mqtt_message_queue.get(timeout=remaining_time)

                    # Skip non-hello messages (like mode_update that arrives before hello)
                    if response.get("type") != "hello":
                        logger.info(f"[INFO] Skipping non-hello message: {response.get('type')}")
                        continue

                    # Got the hello response
                    global udp_session_details
                    udp_session_details = response

                    # Check for LiveKit direct connection credentials
                    if "livekit" in response and LIVEKIT_AVAILABLE:
                        livekit_creds = response["livekit"]
                        logger.info(f"[LIVEKIT] Received LiveKit credentials for room: {livekit_creds.get('room_name')}")
                        try:
                            # Create ESP32-style options
                            options = LiveKitRoomOptions(
                                auto_subscribe=True,
                                publish_audio=True,
                                # Port backward compatibility for data messages
                                on_data_received=lambda p: mqtt_message_queue.put(p),
                                on_participant_connected=lambda p, k: logger.info(f"[LIVEKIT] {k} connected: {p.identity}")
                            )
                            
                            self.livekit_client = LiveKitAudioClient(
                                url=livekit_creds["url"],
                                token=livekit_creds["token"],
                                room_name=livekit_creds["room_name"],
                                audio_playback_queue=self.audio_playback_queue,
                                audio_params=response.get("audio_params", {"sample_rate": 24000, "channels": 1}),
                                options=options
                            )
                            self.livekit_client.start()
                            self.use_livekit_direct = True
                            logger.info("[LIVEKIT] Using direct LiveKit connection with ESP32-style options")
                            return True
                        except Exception as e:
                            logger.error(f"[LIVEKIT] Failed to setup LiveKit: {e}")
                            logger.info("[LIVEKIT] Falling back to UDP...")
                            self.use_livekit_direct = False

                    # Fallback to UDP connection
                    if "udp" in response:
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

                    logger.error(f"[ERROR] Hello response missing both livekit and udp credentials")
                    return False

                except Empty:
                    continue

            logger.error("[ERROR] Timed out waiting for 'hello' response.")
            return False
        except Exception as e:
            logger.error(f"[ERROR] Exception while waiting for hello: {e}")
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

                        logger.info(
                            f"[AUDIO] Buffering audio... {self.audio_playback_queue.qsize()}/{PLAYBACK_BUFFER_START_FRAMES}")
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

            # Only create Opus encoder for UDP mode (LiveKit handles encoding)
            encoder = None
            if not self.use_livekit_direct:
                try:
                    encoder = opuslib.Encoder(
                        RATE, CHANNELS, opuslib.APPLICATION_VOIP)
                except Exception as e:
                    logger.error(f"[ERROR] Failed to create Opus encoder: {e}")
                    return  # Exit thread if encoder fails

            stream = p.open(format=FORMAT, channels=CHANNELS, rate=RATE,
                            input=True, frames_per_buffer=SAMPLES_PER_FRAME)

            if self.use_livekit_direct:
                logger.info("[MIC] Microphone stream opened. Sending audio via LiveKit...")
            else:
                logger.info("[MIC] Microphone stream opened. Sending audio to server via UDP...")
                server_udp_addr = (
                    udp_session_details['udp']['server'], udp_session_details['udp']['port'])

            packets_sent = 0
            last_log_time = time.time()

            # Inner loop for the active recording session
            while not stop_threads.is_set() and not stop_recording_event.is_set() and self.session_active:
                try:
                    pcm_data = stream.read(
                        SAMPLES_PER_FRAME, exception_on_overflow=False)

                    if self.use_livekit_direct:
                        # Send PCM directly to LiveKit (it handles encoding)
                        if self.livekit_client and self.livekit_client.connected:
                            self.livekit_client.send_audio(pcm_data)
                            packets_sent += 1
                    else:
                        # UDP mode: Encode and encrypt
                        opus_data = encoder.encode(pcm_data, SAMPLES_PER_FRAME)
                        encrypted_packet = self.encrypt_packet(opus_data)

                        if encrypted_packet:
                            self.udp_socket.sendto(
                                encrypted_packet, server_udp_addr)
                            packets_sent += 1

                    if time.time() - last_log_time >= 1.0:
                        mode = "LiveKit" if self.use_livekit_direct else "UDP"
                        logger.info(
                            f"[UP]  Sent {packets_sent} audio packets via {mode} in the last second.")
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
        # Check if we have either LiveKit or UDP connection
        if not self.use_livekit_direct and not self.udp_socket:
            logger.error("[ERROR] No audio connection available (neither LiveKit nor UDP)")
            return False

        logger.info("[STEP] STEP 4: Starting all streaming audio threads...")
        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.clear()
        # Initially, clear both events. The server's initial TTS will set start_recording_event.
        start_recording_event.clear()
        stop_recording_event.clear()

        # Start playback thread (works for both modes - reads from audio_playback_queue)
        self.playback_thread = threading.Thread(
            target=self._playback_thread, daemon=True)
        self.playback_thread.start()

        # Only start UDP listener if not using LiveKit (LiveKit handles receiving in its own thread)
        if not self.use_livekit_direct:
            self.udp_listener_thread = threading.Thread(
                target=self.listen_for_udp_audio, daemon=True)
            self.udp_listener_thread.start()
        else:
            logger.info("[LIVEKIT] Skipping UDP listener - using LiveKit for audio")

        # Start recording thread (handles both modes)
        self.audio_recording_thread = threading.Thread(
            target=self._record_and_send_audio_thread, daemon=True)
        self.audio_recording_thread.start()

        if self.use_livekit_direct and self.livekit_client:
            # Direct mode: Client speaks first - enable recording immediately
            logger.info("[LIVEKIT] Client speaks first mode - enabling microphone immediately...")
            # Small delay to let LiveKit connection stabilize
            time.sleep(1.0)
            stop_recording_event.clear()
            start_recording_event.set()
            logger.info("[LIVEKIT] Microphone enabled - speak now!")
        else:
            # Gateway bridge mode: Send listen via MQTT
            listen_payload = {
                "type": "listen", "session_id": udp_session_details["session_id"], "state": "detect", "text": "hello baby"}
            self.mqtt_client.publish("device-server", json.dumps(listen_payload))
            logger.info("[MQTT] Sent listen message via MQTT")

        logger.info(
            "[WAIT] Test running. Press Spacebar to abort TTS or Ctrl+C to stop.")

        # Start a thread to monitor spacebar press
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

        # Stop LiveKit client if active
        if self.livekit_client:
            logger.info("[LIVEKIT] Stopping LiveKit client...")
            self.livekit_client.stop()
            self.livekit_client = None

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


if __name__ == "__main__":
    # You can control sequence logging from here
    print(
        f"[SEQ] Sequence logging: {'ENABLED' if ENABLE_SEQUENCE_LOGGING else 'DISABLED'}")
    print(f"[STATS] Log frequency: Every {LOG_SEQUENCE_EVERY_N_PACKETS} packets")

    client = TestClient()
    try:
        client.run_test()
    except KeyboardInterrupt:
        logger.info("Manual interruption detected. Cleaning up...")
        client.cleanup()
