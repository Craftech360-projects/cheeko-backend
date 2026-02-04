# OpenClaw Service

OpenClaw integration service for Cheeko ESP32 Server. Enables proactive AI behaviors, parent notifications via WhatsApp/Telegram, and extended automation capabilities.

## Features

- ✅ **WhatsApp Integration** - Send messages to parents via WhatsApp
- ✅ **Message Routing** - Multi-platform message delivery
- ✅ **REST API** - Simple API for message sending
- 🚧 **Task Scheduling** - Proactive reminders (coming soon)
- 🚧 **Telegram Integration** - Alternative messaging platform (coming soon)

## Quick Start

### 1. Install Dependencies

```bash
cd main/openclaw-service
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Enable WhatsApp

Set in `.env`:
```
WHATSAPP_ENABLED=true
```

### 4. Start Service

```bash
npm run dev
```

### 5. Scan QR Code

On first run, scan the QR code with WhatsApp mobile app to authenticate.

## API Endpoints

### Send Message

```bash
POST /api/message/send
Content-Type: application/json

{
  "platform": "whatsapp",
  "recipient": "+1234567890",
  "message": "Hello from Cheeko!"
}
```

### Send to Parent

```bash
POST /api/message/send-to-parent
Content-Type: application/json

{
  "deviceMac": "AA:BB:CC:DD:EE:FF",
  "message": "Rahul completed 3 stories today! 🎉"
}
```

### Check Status

```bash
GET /api/message/status
```

## Integration with Cheeko

### From LiveKit Agent

The LiveKit agent can trigger WhatsApp messages via function calls:

```python
# In cheeko_worker.py
async def send_whatsapp_message(recipient: str, message: str):
    """Send WhatsApp message via OpenClaw service"""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            'http://localhost:8003/api/message/send',
            json={
                'platform': 'whatsapp',
                'recipient': recipient,
                'message': message
            }
        ) as response:
            return await response.json()
```

### From Manager API

```javascript
// In manager-api-node
const axios = require('axios');

async function notifyParent(deviceMac, message) {
  const response = await axios.post(
    'http://localhost:8003/api/message/send-to-parent',
    {
      deviceMac,
      message
    }
  );
  return response.data;
}
```

## Voice Command Example

**Child says:** "Send a message to Mom saying I finished my homework"

**Flow:**
1. LiveKit agent hears the voice command
2. Agent calls OpenClaw API: `POST /api/message/send-to-parent`
3. OpenClaw looks up Mom's WhatsApp number from device MAC
4. WhatsApp message sent to Mom
5. Agent confirms: "Message sent to Mom!"

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 8003 |
| `WHATSAPP_ENABLED` | Enable WhatsApp | false |
| `MANAGER_API_URL` | Manager API URL | http://localhost:8002/toy |
| `MANAGER_API_SECRET` | Service secret | - |

See `.env.example` for full configuration options.

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run in production mode
npm start

# Run tests
npm test

# Lint code
npm run lint
```

## Architecture

```
openclaw-service/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   └── message.routes.js    # Message API endpoints
│   │   └── server.js                # Express server
│   ├── core/
│   │   └── message-router.js        # Multi-platform routing
│   ├── integrations/
│   │   └── whatsapp.integration.js  # WhatsApp client
│   ├── config/
│   │   ├── openclaw.config.js       # Main config
│   │   └── integrations.config.js   # Integration config
│   └── utils/
│       └── logger.js                # Winston logger
├── memory/                           # Persistent storage
└── logs/                             # Log files
```

## Troubleshooting

### WhatsApp QR Code Not Showing

1. Check `WHATSAPP_ENABLED=true` in `.env`
2. Delete `memory/whatsapp-session` folder
3. Restart service

### Message Not Sending

1. Check WhatsApp status: `GET /api/message/status`
2. Verify phone number format: `+1234567890`
3. Check logs: `tail -f logs/combined.log`

## Security

- Rate limiting enabled (100 requests per 15 minutes)
- Service-to-service authentication required
- WhatsApp session stored locally
- No message content stored

## Next Steps

- [ ] Add Telegram integration
- [ ] Implement task scheduler for proactive reminders
- [ ] Add parent contact management in Manager API
- [ ] Create admin UI for integration settings
- [ ] Add LiveKit agent function tools

## License

MIT
