# Line Art Generator API

WebSocket API that accepts audio or text input, generates a line art image using AI, and returns a raw 1-bit monochrome bitmap ready for embedded displays.

## How It Works

```
Device/Browser                          Server (this project)
     |                                       |
     |── ws://SERVER_IP:8000/ws ────────────>|
     |                                       |
     |── audio (binary frame) ─────────────>|── Groq Whisper API (STT)
     |   OR text (JSON frame)                |── HuggingFace FLUX.1 (image gen)
     |                                       |── Pillow (resize + 1-bit convert)
     |                                       |
     |<──── JSON: transcription + image ─────|
     |                                       |
```

## Prerequisites

- Python 3.12+
- A [HuggingFace API token](https://huggingface.co/settings/tokens) with "Inference Providers" permission
- A [Groq API key](https://console.groq.com/keys) (free tier)

## Setup

```bash
cd C:\Users\Acer\line_art

# Create virtual environment (skip if env/ already exists)
python -m venv env

# Activate
env\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Running the Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0
```

The server starts on port 8000 and listens on all network interfaces.

### Verify

- Server logs should show: `Server ready. Using Groq Whisper API for STT.`
- Open `http://127.0.0.1:8000/static/index.html` in a browser to test

### Find Your Server IP

```bash
ipconfig
```

Look for `IPv4 Address` under `Wireless LAN adapter Wi-Fi` (e.g., `192.168.1.168`).

## Device Connection

Devices connect to a single WebSocket endpoint:

```
ws://<SERVER_IP>:8000/ws
```

Example: `ws://192.168.1.168:8000/ws`

No authentication required. The device and server must be on the same network.

## WebSocket Protocol

### Sending to Server

**Option A: Audio (binary frame)**

Send raw WAV audio as a binary WebSocket frame.

| Parameter       | Value          |
|-----------------|----------------|
| Format          | WAV            |
| Sample rate     | 16000 Hz       |
| Channels        | 1 (mono)       |
| Bit depth       | 16-bit PCM     |
| Max size        | 10 MB          |

**Option B: Text (JSON text frame)**

```json
{"type": "text_input", "text": "cat"}
```

### Receiving from Server

All responses are JSON text frames. Parse the `"type"` field:

**Progress (informational):**
```json
{"type": "progress", "stage": "stt", "message": "Transcribing audio..."}
{"type": "progress", "stage": "generating", "message": "Generating line art for 'cat'..."}
```

**Transcription (audio input only):**
```json
{"type": "transcription", "text": "cat"}
```

**Result:**
```json
{
  "type": "result",
  "image": "data:image/png;base64,...",
  "prompt_used": "simple black and white line art drawing of cat...",
  "raw_mono": "<base64 encoded raw bitmap>",
  "width": 384,
  "height": 384
}
```

**Error:**
```json
{"type": "error", "stage": "stt", "message": "Transcription failed: ..."}
```

## Raw Bitmap Format (`raw_mono` field)

The `raw_mono` field is a base64-encoded raw 1-bit monochrome bitmap. After base64 decoding:

| Property     | Value                                |
|--------------|--------------------------------------|
| Width        | 384 pixels (always)                  |
| Height       | Variable (preserved aspect ratio)    |
| Color depth  | 1-bit (black = 1, white = 0)         |
| Bit order    | MSB first (leftmost pixel = bit 7)   |
| Row order    | Top-down                             |
| Bytes/row    | 48 (384 / 8)                         |
| Padding      | None                                 |
| Header       | None                                 |
| Compression  | None                                 |

Total size = `height * 48` bytes.

### Example: Reading pixel (x, y)

```c
uint8_t byte = raw_data[y * 48 + x / 8];
bool is_black = (byte >> (7 - (x % 8))) & 1;
```

## Project Structure

```
line_art/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI app, WebSocket endpoint
│   ├── stt.py           # Groq Whisper API for speech-to-text
│   ├── image_gen.py     # HuggingFace FLUX.1 + 1-bit conversion
│   └── models.py        # Pydantic message schemas
├── static/
│   └── index.html       # Browser test client
├── requirements.txt
└── README.md
```

## Server-Side APIs

These are called by the server only. The device does NOT need any API keys.

| Service         | Provider                          | Purpose                    |
|-----------------|-----------------------------------|----------------------------|
| Speech-to-Text  | Groq (`whisper-large-v3`)         | Transcribes audio to text  |
| Image Generation| HuggingFace (`FLUX.1-schnell`)    | Generates line art from text|
| Image Conversion| Local (Pillow)                    | Resizes + converts to 1-bit|

## Message Flow

```
DEVICE                                SERVER
  |                                      |
  |──── Connect ws://IP:8000/ws ───────>|
  |                                      |
  |──── Binary: WAV audio ────────────>|
  |                                      |
  |<──── {"type":"progress",             |
  |       "stage":"stt"} ──────────────|
  |                                      |
  |<──── {"type":"transcription",        |
  |       "text":"cat"} ──────────────|
  |                                      |
  |<──── {"type":"progress",             |
  |       "stage":"generating"} ───────|
  |                                      |
  |<──── {"type":"result",               |
  |       "raw_mono":"...",              |
  |       "width":384,                   |
  |       "height":384} ──────────────|
  |                                      |
  |  [base64 decode raw_mono]            |
  |  [render 1-bit bitmap on display]    |
  |                                      |
```
