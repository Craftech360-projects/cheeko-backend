import json
import time
import sys
import random

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("Error: paho-mqtt library not found.")
    print("Please install it by running: pip install paho-mqtt")
    sys.exit(1)

# Configuration
BROKER_HOST = "localhost"
BROKER_PORT = 1883
TOPIC = "internal/server-ingest"

# Device details - UPDATE THIS IF NEEDED
MAC_ADDRESS = "68_25_dd_bb_23_a4" 
CHARACTER_NAME = "Riddle Solver"  # Options: "Cheeko", "Math Tutor", "Riddle Solver", "Word Ladder"

# Construct the special payload acting as EMQX republish
# equivalent to: "sender_client_id":"GID_test@@@<MAC>@@@uuid"
client_id_simulated = f"GID_test@@@{MAC_ADDRESS}@@@uuid"

payload = {
    "sender_client_id": client_id_simulated,
    # Note: 'orginal_payload' is the expected key in the gateway (matching the typo in mqtt-gateway.js)
    "orginal_payload": {
        "type": "character-change",
        "characterName": CHARACTER_NAME
    }
}

def main():
    # Use a random client ID for this script's connection to the broker
    script_client_id = f"script-publisher-{random.randint(0, 1000)}"
    client = mqtt.Client(client_id=script_client_id)
    
    print(f"Connecting to MQTT Broker at {BROKER_HOST}:{BROKER_PORT}...")
    
    try:
        client.connect(BROKER_HOST, BROKER_PORT, 60)
        client.loop_start()
        
        time.sleep(0.5) # Wait for connection
        
        print(f"Publishing character change to '{CHARACTER_NAME}' for device {MAC_ADDRESS}...")
        message_json = json.dumps(payload)
        
        info = client.publish(TOPIC, message_json)
        info.wait_for_publish()
        
        print(f"✅ Message sent to topic '{TOPIC}'")
        print(f"Payload: {json.dumps(payload, indent=2)}")
        
        time.sleep(1) # Ensure message is flushed
        client.loop_stop()
        client.disconnect()
        
    except ConnectionRefusedError:
        print(f"❌ Error: Could not connect to MQTT broker at {BROKER_HOST}:{BROKER_PORT}")
        print("Make sure the MQTT broker (EMQX) is running.")
    except Exception as e:
        print(f"❌ An error occurred: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        CHARACTER_NAME = sys.argv[1]
        payload["orginal_payload"]["characterName"] = CHARACTER_NAME
        
    main()
