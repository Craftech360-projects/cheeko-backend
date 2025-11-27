# Dockerfile for LiveKit Server Simple on Cerebrium
# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.11.6
FROM python:${PYTHON_VERSION}-slim

# Keeps Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

# Create a non-privileged user that the app will run under.
ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/home/appuser" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

# Install system dependencies for audio processing and compilation
RUN apt-get update && \
    apt-get install -y \
    bash \
    gcc \
    g++ \
    python3-dev \
    libasound2-dev \
    portaudio19-dev \
    libffi-dev \
    libssl-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Switch to non-root user
USER appuser

RUN mkdir -p /home/appuser/.cache
RUN chown -R appuser /home/appuser/.cache

WORKDIR /home/appuser

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN python -m pip install --user --no-cache-dir -r requirements.txt

# Copy pyproject.toml and install its dependencies
COPY pyproject.toml .
RUN python -m pip install --user --no-cache-dir \
    'livekit-agents[openai,turn-detector,silero,cartesia,deepgram]~=1.2' \
    'livekit-plugins-noise-cancellation~=0.2' \
    'livekit-plugins-groq' \
    'livekit.plugins.deepgram' \
    'livekit-plugins-elevenlabs' \
    'python-dotenv' \
    'paho-mqtt' \
    'aiohttp' \
    'pydub' \
    'edge-tts==7.0.2' \
    'gtts' \
    'pyttsx3' \
    'mem0ai' \
    'jinja2' \
    'pytz' \
    'qdrant-client>=1.7.0' \
    'sentence-transformers>=2.2.0' \
    'uvicorn[standard]'

# Copy the entire application (including start.sh, main.py, media_api, etc.)
COPY . .

# Temporarily become root to fix ownership and ensure start.sh is executable
USER root
RUN apt-get update && apt-get install -y dos2unix && \
    dos2unix /home/appuser/start.sh && \
    chown -R appuser:appuser /home/appuser && \
    chmod +x /home/appuser/start.sh && \
    rm -rf /var/lib/apt/lists/*

# Back to app user
USER appuser

# Ensure that any dependent models are downloaded at build-time
RUN python main.py download-files || echo "No download-files command available"

# Expose healthcheck / main service port and media_api port
EXPOSE 8081 8003

# Run the start script which launches both main.py and media_api
CMD ["bash", "start.sh"]
