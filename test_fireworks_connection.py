import requests
import json
import base64

API_KEY = "fw_5erSsWgEzAM1vs8dEva1ff"
MODEL = "accounts/craftech360/deployments/v52xgvfh"
# MODEL = "accounts/fireworks/models/qwen3-omni-30b-a3b-instruct"
URL = "https://api.fireworks.ai/inference/v1/chat/completions"

# Minimal valid WAV header (for a very short silence) or just random bytes if we only care about routing
# 44 bytes header + minimal data
# Using a dummy b64 string that looks like a WAV (RIFF...) might be safer if validation happens early
# But to be quick, let's just use a string and see if we get 400 or Path Not Found
audio_b64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" 

payload = {
    "model": MODEL,
    "max_tokens": 1024,
    "messages": [{
        "role": "user",
        "content": "Say hello to the world!"
    }],
    "modalities": ["audio"], 
    "audio": {"voice": "cherry", "format": "wav"}, 
    "stream": True 
}

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

print(f"\nTesting URL with AUDIO payload (Streaming): {URL}")
try:
    response = requests.post(URL, headers=headers, json=payload, timeout=30, stream=True)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code != 200:
        print(f"Error Response: {response.text}")
    
    audio_chunks = []
    text_content = ""
    chunk_count = 0
    
    for line in response.iter_lines():
        if line:
            decoded_line = line.decode('utf-8')
            if decoded_line.startswith("data: "):
                data_str = decoded_line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    delta = chunk['choices'][0]['delta']
                    
                    if chunk_count < 3:
                        print(f"DEBUG: Chunk {chunk_count}: {json.dumps(delta)}")
                    chunk_count += 1

                    
                    if 'content' in delta and delta['content']:
                        text_content += delta['content']
                        print(f"Text chunk: {delta['content']}")
                        
                    if 'audio' in delta and 'data' in delta['audio']:
                        audio_chunks.append(delta['audio']['data'])
                        print(".", end="", flush=True) # visual indicator
                        
                except Exception as e:
                    print(f"Error parsing chunk: {e}")
                    
    print(f"\n\nFull Text: {text_content}")
    print(f"Received {len(audio_chunks)} audio chunks.")
    
except Exception as e:
    print(f"Error: {e}")
