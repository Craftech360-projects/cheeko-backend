const { AccessToken } = require("livekit-server-sdk");

function createToken(apiKey, apiSecret, roomName, identity, ttlSeconds = 3600) {
    const at = new AccessToken(apiKey, apiSecret, { 
        identity,
        ttl: ttlSeconds
    });

    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: false,
    });

    return at.toJwt();
}

// Example usage
if (require.main === module) {
    const API_KEY = process.env.LIVEKIT_API_KEY || "YOUR_API_KEY";
    const API_SECRET = process.env.LIVEKIT_API_SECRET || "YOUR_API_SECRET";
    const ROOM = "test-room";
    const IDENTITY = "js-bot";

    const token = createToken(API_KEY, API_SECRET, ROOM, IDENTITY);
    console.log(token);
}

module.exports = { createToken };