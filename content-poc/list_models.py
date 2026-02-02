import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Listing available models...")
try:
    for m in client.models.list(config={'page_size': 100}):
        # Filter for image generation support if possible, or just print all interesting ones
        if 'image' in m.name or 'imagen' in m.name or 'flash' in m.name:
            print(f"- {m.name} (Supported actions: {m.supported_actions})")
except Exception as e:
    print(f"Error listing: {e}")
