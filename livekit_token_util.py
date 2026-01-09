# server_token.py
from livekit.api import AccessToken, VideoGrants
from datetime import timedelta

def create_token(api_key: str, api_secret: str, room_name: str, identity: str) -> str:
    at = AccessToken(api_key, api_secret)
    at.identity = identity
    at.name = "python-audio-publisher"
    grants = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=False
    )
    at.with_grants(grants)
    # optional: set token expiry
    at.ttl = timedelta(hours=1)
    return at.to_jwt()

if __name__ == "__main__":
    # LiveKit Cloud credentials
    LIVEKIT_URL = "wss://cheekotest-cw0h23qc.livekit.cloud"
    API_KEY = "APIH7cPNdCWbjXf"
    API_SECRET = "RyfUil3IY1k1eKtOOnbSi0n06p4cTkayOeUVOJVewhXD"
    ROOM = "test-room"
    IDENTITY = "python-bot"

    token = create_token(API_KEY, API_SECRET, ROOM, IDENTITY)
    print(token)