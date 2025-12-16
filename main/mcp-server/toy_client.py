"""
Toy MQTT Client - Simulates an ESP32 device to test MCP tool calls

This client subscribes to MQTT topics and displays commands received
from the MCP Server -> MQTT Gateway -> MQTT Broker flow.

Supports:
- LED/Light control on devices/p2p/{device_id}
- Car control on esp32/car_control

Usage:
    python toy_client.py [device_id]

Example:
    python toy_client.py                     # Uses default device ID
    python toy_client.py aa:bb:cc:dd:ee:ff   # Custom device ID
"""

import os
import sys
import json
import logging
from datetime import datetime
from dotenv import load_dotenv

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("Error: paho-mqtt not installed. Run: pip install paho-mqtt")
    sys.exit(1)

# Load environment variables
load_dotenv()

# Configuration
MQTT_HOST = os.getenv("EMQX_HOST", "192.168.1.99")
MQTT_PORT = int(os.getenv("EMQX_PORT", "1883"))
DEFAULT_DEVICE_ID = os.getenv("DEFAULT_DEVICE_ID", "84:1f:e8:16:e5:4c")
CAR_CONTROL_TOPIC = "esp32/car_control"

# Setup logging with colors
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("toy-client")


class ToyESP32Client:
    """Simulates an ESP32 device listening for MQTT commands."""

    def __init__(self, device_id: str):
        self.device_id = device_id
        self.device_topic = f"devices/p2p/{device_id}"
        self.car_topic = CAR_CONTROL_TOPIC
        self.client = mqtt.Client(client_id=f"toy-{device_id[:8]}")

        # Set callbacks
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect

        # Device state
        self.led_on = False
        self.led_color = "#FFFFFF"
        self.brightness = 100
        self.volume = 50

        # Car state
        self.car_moving = False
        self.car_direction = "stopped"

    def on_connect(self, client, userdata, flags, rc):
        """Called when connected to MQTT broker."""
        if rc == 0:
            print(f"""
╔══════════════════════════════════════════════════════════════╗
║        🎮 TOY ESP32 CLIENT CONNECTED                         ║
╠══════════════════════════════════════════════════════════════╣
║  Device ID: {self.device_id:<43}  ║
║  MQTT Broker: {MQTT_HOST}:{MQTT_PORT:<36}  ║
╠══════════════════════════════════════════════════════════════╣
║  📡 Subscribed Topics:                                       ║
║     💡 {self.device_topic:<52} ║
║     🚗 {self.car_topic:<52} ║
╠══════════════════════════════════════════════════════════════╣
║  Waiting for commands from voice assistant...                ║
║  Try saying:                                                 ║
║     "Turn on the light on my toy"                            ║
║     "Move the car forward"                                   ║
║     "Turn the car left"                                      ║
╚══════════════════════════════════════════════════════════════╝
""")
            # Subscribe to device topic and car control topic
            client.subscribe(self.device_topic)
            client.subscribe(self.car_topic)
            logger.info(f"✅ Subscribed to: {self.device_topic}")
            logger.info(f"✅ Subscribed to: {self.car_topic}")
        else:
            logger.error(f"❌ Connection failed with code: {rc}")

    def on_disconnect(self, client, userdata, rc):
        """Called when disconnected from MQTT broker."""
        logger.warning(f"⚠️  Disconnected from broker (rc={rc})")

    def on_message(self, client, userdata, msg):
        """Called when a message is received."""
        try:
            payload = json.loads(msg.payload.decode())

            # Route to appropriate handler based on topic
            if msg.topic == self.car_topic:
                self.handle_car_command(payload)
            else:
                self.handle_command(payload)
        except json.JSONDecodeError:
            logger.error(f"❌ Invalid JSON: {msg.payload}")
        except Exception as e:
            logger.error(f"❌ Error processing message: {e}")

    def handle_command(self, payload: dict):
        """Process incoming command and update device state."""
        action = payload.get("action", "unknown")
        value = payload.get("value")
        duration = payload.get("duration")
        speed = payload.get("speed")
        count = payload.get("count")
        timestamp = payload.get("timestamp", 0)

        # Format timestamp
        if timestamp:
            ts = datetime.fromtimestamp(timestamp / 1000).strftime("%H:%M:%S")
        else:
            ts = datetime.now().strftime("%H:%M:%S")

        print(f"\n{'='*60}")
        print(f"📨 COMMAND RECEIVED at {ts}")
        print(f"{'='*60}")
        print(f"   Action:   {action}")
        print(f"   Value:    {value}")
        if duration:
            print(f"   Duration: {duration}ms ({duration/1000}s)")
        if speed:
            print(f"   Speed:    {speed}ms interval")
        if count:
            print(f"   Count:    {count} times")
        print(f"{'='*60}")

        # Handle different actions
        if action == "led_on":
            self.led_on = True
            if duration:
                print(f"   💡 LED: ON (will turn off in {duration/1000}s)")
            else:
                print("   💡 LED: ON")
            self.show_led_visual()

        elif action == "led_off":
            self.led_on = False
            print("   💡 LED: OFF")
            print("   ⚫ [ OFF ]")

        elif action == "led_brightness":
            self.brightness = value or 100
            print(f"   🔆 Brightness: {self.brightness}%")
            self.show_brightness_bar()

        elif action == "led_color":
            self.led_color = value or "#FFFFFF"
            print(f"   🎨 Color: {self.led_color}")
            self.show_color_visual()

        elif action == "set_volume":
            self.volume = value or 50
            print(f"   🔊 Volume: {self.volume}%")
            self.show_volume_bar()

        elif action == "led_blink":
            blink_info = []
            if count:
                blink_info.append(f"{count} times")
            if speed:
                speed_name = "fast" if speed <= 200 else "slow" if speed >= 800 else "medium"
                blink_info.append(f"{speed_name} ({speed}ms)")
            if duration:
                blink_info.append(f"for {duration/1000}s")

            info_str = " - " + ", ".join(blink_info) if blink_info else ""
            print(f"   ✨ LED: BLINKING{info_str}")
            print("   🔴 [ BLINK ] 💡 💡 💡")

        elif action == "led_fade_in":
            duration_str = f" over {duration/1000}s" if duration else ""
            print(f"   🌅 LED: FADE IN{duration_str}")
            print("   ░░░░████████████████████ (fading in...)")

        elif action == "led_fade_out":
            duration_str = f" over {duration/1000}s" if duration else ""
            print(f"   🌆 LED: FADE OUT{duration_str}")
            print("   ████████████████████░░░░ (fading out...)")

        else:
            print(f"   ❓ Unknown action: {action}")

        print()

    def show_led_visual(self):
        """Show LED state visually."""
        if self.led_on:
            print(f"   🟢 [ ON ] Color: {self.led_color} Brightness: {self.brightness}%")
        else:
            print("   ⚫ [ OFF ]")

    def show_brightness_bar(self):
        """Show brightness as a bar."""
        filled = int(self.brightness / 5)
        bar = "█" * filled + "░" * (20 - filled)
        print(f"   [{bar}] {self.brightness}%")

    def show_volume_bar(self):
        """Show volume as a bar."""
        filled = int(self.volume / 5)
        bar = "█" * filled + "░" * (20 - filled)
        print(f"   [{bar}] {self.volume}%")

    def show_color_visual(self):
        """Show color name based on hex."""
        color_names = {
            "#FF0000": "🔴 RED",
            "#00FF00": "🟢 GREEN",
            "#0000FF": "🔵 BLUE",
            "#FFFF00": "🟡 YELLOW",
            "#FF00FF": "🟣 PURPLE",
            "#FFFFFF": "⚪ WHITE",
            "#00FFFF": "🔵 CYAN",
            "#FF8000": "🟠 ORANGE"
        }
        color_name = color_names.get(self.led_color.upper(), f"🎨 {self.led_color}")
        print(f"   {color_name}")

    def handle_car_command(self, payload: dict):
        """Process incoming car control command."""
        cmd = payload.get("cmd", "unknown")
        ts = datetime.now().strftime("%H:%M:%S")

        print(f"\n{'='*60}")
        print(f"🚗 CAR COMMAND RECEIVED at {ts}")
        print(f"{'='*60}")
        print(f"   Command: {cmd}")
        print(f"{'='*60}")

        # Car ASCII art for different directions
        car_visuals = {
            "forward": """
       ⬆️  FORWARD
      ┌─────┐
      │ 🚗  │
      └─────┘
        ║║
        ▼▼
   Moving forward...""",
            "backward": """
       ⬇️  BACKWARD
        ▲▲
        ║║
      ┌─────┐
      │ 🚗  │
      └─────┘
   Reversing...""",
            "left": """
       ⬅️  LEFT
    ◄══╗
       ║  ┌─────┐
       ╚══│ 🚗  │
          └─────┘
   Turning left...""",
            "right": """
       ➡️  RIGHT
          ╔══►
  ┌─────┐ ║
  │ 🚗  │══╝
  └─────┘
   Turning right...""",
            "stop": """
       🛑 STOP
      ┌─────┐
      │ 🚗  │
      └─────┘
       ████
   Car stopped.""",
        }

        # Update car state
        if cmd == "stop":
            self.car_moving = False
            self.car_direction = "stopped"
        else:
            self.car_moving = True
            self.car_direction = cmd

        # Show visual
        visual = car_visuals.get(cmd.lower(), f"   ❓ Unknown command: {cmd}")
        print(visual)
        print()

    def connect(self):
        """Connect to MQTT broker."""
        logger.info(f"🔌 Connecting to MQTT broker at {MQTT_HOST}:{MQTT_PORT}...")
        try:
            self.client.connect(MQTT_HOST, MQTT_PORT, 60)
        except Exception as e:
            logger.error(f"❌ Failed to connect: {e}")
            sys.exit(1)

    def run(self):
        """Start the client loop."""
        self.connect()
        try:
            self.client.loop_forever()
        except KeyboardInterrupt:
            print("\n\n👋 Toy client shutting down...")
            self.client.disconnect()


def main():
    # Get device ID from command line or use default
    if len(sys.argv) > 1:
        device_id = sys.argv[1]
    else:
        device_id = DEFAULT_DEVICE_ID

    print(f"""
┌──────────────────────────────────────────────────────────────┐
│         🧸 TOY ESP32 MQTT CLIENT + 🚗 CAR SIMULATOR          │
│                                                              │
│  This simulates ESP32 devices to test the MCP tool flow:     │
│                                                              │
│  Voice -> LiveKit -> MCP Server -> MQTT Gateway -> HERE      │
│                                                              │
│  Supports:                                                   │
│    💡 LED/Light control (devices/p2p/{{device_id}})           │
│    🚗 Car control (esp32/car_control)                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
""")

    # Create and run client
    client = ToyESP32Client(device_id)
    client.run()


if __name__ == "__main__":
    main()
