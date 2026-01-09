
const { RoomServiceClient } = require('livekit-server-sdk');
const dotenv = require('dotenv');
const path = require('path');

// Load .env from mqtt-gateway
dotenv.config({ path: 'd:\\cheeko\\cheeko-backend\\main\\mqtt-gateway\\.env' });

const url = process.env.LIVEKIT_URL || 'http://localhost:7880';
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

const roomService = new RoomServiceClient(url, apiKey, apiSecret);

async function checkRooms() {
    try {
        console.log(`Checking LiveKit rooms at ${url}...`);
        const rooms = await roomService.listRooms();
        console.log(`Found ${rooms.length} rooms:`);

        for (const room of rooms) {
            console.log(`- Room: ${room.name} (${room.numParticipants} participants)`);
            const participants = await roomService.listParticipants(room.name);
            for (const p of participants) {
                console.log(`  - Participant: ${p.identity} (state: ${p.state})`);
            }
        }
    } catch (err) {
        console.error('Failed to list rooms:', err.message);
    }
}

checkRooms();
