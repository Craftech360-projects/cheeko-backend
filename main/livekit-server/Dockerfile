# Dockerfile.cloudrun - Optimized for Google Cloud Run asia-south1
# Key differences from Cerebrium:
# - Uses PORT env var for health checks
# - Runs agent in dev mode with health server
# - No CPU throttling required (set via gcloud deploy flag)
# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.11.6
FROM python:${PYTHON_VERSION}-slim

# Prevent Python from buffering stdout/stderr (crucial for Cloud Run logs)
ENV PYTHONUNBUFFERED=1

# Cloud Run will pass the PORT env var, default to 8080 for health checks
ENV PORT=8080

WORKDIR /app

# Install system dependencies for audio processing and compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    bash \
    gcc \
    g++ \
    python3-dev \
    libasound2-dev \
    portaudio19-dev \
    libffi-dev \
    libssl-dev \
    ffmpeg \
    dos2unix \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install LiveKit agents with Google plugin (required for Gemini)
RUN pip install --no-cache-dir \
    'livekit-agents[openai,turn-detector,silero]~=1.2' \
    'livekit-plugins-google' \
    'google-genai' \
    'livekit-plugins-noise-cancellation~=0.2' \
    'livekit-plugins-groq' \
    'livekit-plugins-deepgram' \
    'livekit-plugins-elevenlabs' \
    'python-dotenv' \
    'aiohttp' \
    'pydub' \
    'edge-tts==7.0.2' \
    'gtts' \
    'pyttsx3' \
    'mem0ai==1.0.0' \
    'jinja2' \
    'pytz' \
    'qdrant-client>=1.7.0' \
    'sentence-transformers>=2.2.0' \
    'uvicorn[standard]' \
    'fastapi>=0.104.0'

# Copy the entire application
COPY . .

# Ensure start script is executable
RUN dos2unix /app/start-cloudrun.sh 2>/dev/null || true && \
    chmod +x /app/start-cloudrun.sh

# Download any required model files at build-time
RUN python main.py download-files 2>/dev/null || echo "No download-files command available"

# Expose the health check port (Cloud Run requirement)
EXPOSE 8080

# Run the Cloud Run start script
CMD ["bash", "start-cloudrun.sh"]
