import json
import base64
import sounddevice as sd
from scipy.io.wavfile import write
import io
from pydub import AudioSegment
from pydub.playback import play
from openai import OpenAI

# --- CONFIG ---
# Get your API key from: https://modelstudio.console.alibabacloud.com/?tab=model#/api-key
API_KEY = "YOUR_DASHSCOPE_API_KEY"
BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
MODEL = "qwen3-omni-flash"

# Available voices: Cherry, Ethan, Jennifer, Ryan, Katerina, and 44 more
VOICE = "Cherry"

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

def record_and_chat():
    fs = 16000
    duration = 5

    print(f"\n🎤 Speaking now... ({duration}s)")
    recording = sd.rec(int(duration * fs), samplerate=fs, channels=1)
    sd.wait()

    # Convert recording to Base64
    buffer = io.BytesIO()
    write(buffer, fs, recording)
    audio_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    print("🤖 Thinking...")

    # DashScope REQUIRES streaming for audio output
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "Please respond to this audio using your voice."},
                {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}}
            ]
        }],
        modalities=["text", "audio"],
        audio={"voice": VOICE, "format": "wav"},
        stream=True,
        stream_options={"include_usage": True},
    )

    # Collect streamed audio chunks
    text_response = ""
    audio_chunks = []

    for chunk in completion:
        if not chunk.choices:
            continue

        delta = chunk.choices[0].delta

        # Collect text
        if hasattr(delta, 'content') and delta.content:
            text_response += delta.content

        # Collect audio chunks (base64 encoded)
        if hasattr(delta, 'audio') and delta.audio and delta.audio.get('data'):
            audio_chunks.append(delta.audio['data'])

    # Print text response
    if text_response:
        print(f"📝 AI Response: {text_response}")

    # Play audio response
    if audio_chunks:
        print("🔊 AI is replying...")
        full_audio_b64 = "".join(audio_chunks)
        audio_bytes = base64.b64decode(full_audio_b64)
        audio_seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format="wav")
        play(audio_seg)
    else:
        print("⚠️ No audio in response")

if __name__ == "__main__":
    while True:
        record_and_chat()
        cont = input("\nPress Enter to speak again (or 'q' to quit): ")
        if cont.lower() == 'q':
            break
