import asyncio
import soundfile as sf
from livekit import rtc
from livekit_token_util import create_token

WAVE_PATH = "audio.wav"   # 16-bit PCM, 48000 Hz recommended
URL = "wss://cheekotest-cw0h23qc.livekit.cloud"
API_KEY = "APIH7cPNdCWbjXf"
API_SECRET = "RyfUil3IY1k1eKtOOnbSi0n06p4cTkayOeUVOJVewhXD"
ROOM = "test-room"
IDENTITY = "python-bot"

async def stream_wav():
    token = create_token(API_KEY, API_SECRET, ROOM, IDENTITY)
    print(f"Generated token, connecting to {URL}...")

    # Force relay (TURN) mode to bypass NAT/firewall
    room = rtc.Room()
    await room.connect(url=URL, token=token)
    print("Connected to room:", room.name)

    # create audio source and local audio track
    audio_src = rtc.AudioSource(48000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("python-audio", audio_src)
    await room.local_participant.publish_track(track)
    print("Published audio track")

    # read file and push frames (10ms frames => 480 samples at 48kHz)
    data, sr = sf.read(WAVE_PATH, dtype="int16")
    if sr != 48000:
        raise ValueError("Audio must be 48000 Hz (resample beforehand).")
    # ensure mono
    if data.ndim > 1:
        data = data[:, 0]

    frame_samples = 480
    idx = 0
    while idx + frame_samples <= len(data):
        frame = data[idx: idx + frame_samples].tobytes()
        audio_frame = rtc.AudioFrame(
            data=frame,
            sample_rate=48000,
            num_channels=1,
            samples_per_channel=frame_samples,
        )
        await audio_src.capture_frame(audio_frame)
        idx += frame_samples
        await asyncio.sleep(0.01)  # 10ms
    print("Finished streaming")

if __name__ == "__main__":
    asyncio.run(stream_wav())