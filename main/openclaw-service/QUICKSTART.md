# OpenClaw Integration - Quick Start Guide

## What You Just Built

You now have a **WhatsApp messaging system** integrated into Cheeko! Children can send WhatsApp messages to their parents using voice commands.

## How It Works

```
Child speaks → Cheeko AI → OpenClaw Service → WhatsApp → Parent's Phone
```

**Example:**
- **Child says:** "Send a message to Mom saying I finished my homework"
- **Cheeko:** Sends WhatsApp to Mom ✅
- **Mom receives:** "I finished my homework" on WhatsApp

---

## Setup Instructions

### Step 1: Install Dependencies

```bash
cd main/openclaw-service
npm install
```

### Step 2: Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit .env file
nano .env  # or use your favorite editor
```

**Required settings:**
```env
# Enable WhatsApp
WHATSAPP_ENABLED=true

# Manager API (for parent contact lookup)
MANAGER_API_URL=http://localhost:8002/toy
MANAGER_API_SECRET=your-service-secret-key
```

### Step 3: Start OpenClaw Service

```bash
npm run dev
```

### Step 4: Scan WhatsApp QR Code

On first run, a QR code will appear in the terminal. Scan it with WhatsApp mobile app to authenticate.

```
🔲🔲🔲🔲🔲🔲🔲
🔲       QR       🔲
🔲     CODE      🔲
🔲      HERE      🔲
🔲🔲🔲🔲🔲🔲🔲
```

### Step 5: Add Parent Contact to Database

You need to add parent contact information to the Manager API database. This will be done through the admin dashboard (future) or directly in the database:

**SQL Example:**
```sql
-- Add parent contact for a device
INSERT INTO device_parent_contact (device_mac, phone_number, preferred_platform)
VALUES ('AA:BB:CC:DD:EE:FF', '+1234567890', 'whatsapp');
```

### Step 6: Update LiveKit Agent Environment

Add OpenClaw service URL to LiveKit agent:

```bash
# In main/livekit-server/.env
OPENCLAW_SERVICE_URL=http://localhost:8003
```

### Step 7: Restart LiveKit Agent

```bash
cd main/livekit-server
python workers/cheeko_worker.py dev
```

---

## Testing

### Test 1: Health Check

```bash
curl http://localhost:8003/health
```

**Expected response:**
```json
{
  "status": "ok",
  "service": "openclaw-service",
  "timestamp": "2026-02-03T10:00:00.000Z"
}
```

### Test 2: Check WhatsApp Status

```bash
curl http://localhost:8003/api/message/status
```

**Expected response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "whatsapp": {
      "enabled": true,
      "ready": true
    }
  }
}
```

### Test 3: Send Test Message

```bash
curl -X POST http://localhost:8003/api/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "whatsapp",
    "recipient": "+1234567890",
    "message": "Test message from Cheeko OpenClaw!"
  }'
```

### Test 4: Voice Command (Real Test)

1. Connect ESP32 device to Cheeko
2. Say: **"Send a message to +1234567890 saying hello from Cheeko"**
3. Check if message arrives on WhatsApp

---

## Voice Command Examples

Once everything is set up, these voice commands will work:

### Send to Specific Number
- "Send a WhatsApp message to +1234567890 saying I'm ready"
- "Message +9876543210 that I finished my homework"

### Send to Parent (requires parent contact setup)
- "Tell Mom I'm hungry"
- "Message my dad that I'm ready to be picked up"
- "Send a message to my parent saying I love you"

---

## Troubleshooting

### WhatsApp QR Code Not Showing

**Problem:** QR code doesn't appear when starting service

**Solution:**
1. Check `WHATSAPP_ENABLED=true` in `.env`
2. Delete `memory/whatsapp-session` folder
3. Restart service: `npm run dev`

### WhatsApp Not Ready

**Problem:** Status shows `"ready": false`

**Solution:**
1. Check if QR code was scanned
2. Check WhatsApp mobile app is connected to internet
3. Check logs: `tail -f logs/combined.log`

### Message Not Sending

**Problem:** API returns error when sending message

**Solutions:**
- Verify phone number format: `+1234567890` (with country code)
- Check WhatsApp status: `GET /api/message/status`
- Check if recipient has WhatsApp installed
- Check logs for detailed error

### Parent Contact Not Found

**Problem:** "No parent contact found for device"

**Solution:**
Add parent contact to database (see Step 5 above)

### LiveKit Agent Can't Call OpenClaw

**Problem:** Agent says "Error sending message"

**Solutions:**
1. Check OpenClaw service is running: `curl http://localhost:8003/health`
2. Check `OPENCLAW_SERVICE_URL` in LiveKit agent `.env`
3. Check network connectivity between services

---

## Architecture

```
┌─────────────┐
│ ESP32 Device│ "Send message to Mom"
└──────┬──────┘
       │ Voice
       ▼
┌──────────────┐
│ LiveKit Agent│ Understands intent
└──────┬───────┘
       │ Function call
       ▼
┌──────────────┐
│OpenClaw API  │ Routes message
└──────┬───────┘
       │ WhatsApp API
       ▼
┌──────────────┐
│   WhatsApp   │ Delivers to parent
└──────────────┘
```

---

## What's Next?

### Phase 2 Features (Coming Soon)
- ✅ Telegram integration
- ✅ Scheduled reminders ("Remind me to brush teeth at 8 PM")
- ✅ Daily activity summaries (automatic parent notifications)
- ✅ Smart home integration

### Admin Dashboard
- Configure parent contacts via UI
- Manage scheduled tasks
- View message history
- Integration settings

---

## Security Notes

- ✅ WhatsApp session stored locally (not in cloud)
- ✅ Rate limiting enabled (100 requests per 15 minutes)
- ✅ Service-to-service authentication required
- ✅ No message content stored in logs
- ⚠️ Parent must approve contacts in production

---

## Support

**Logs Location:** `main/openclaw-service/logs/`

**Configuration:** `main/openclaw-service/.env`

**Documentation:** `main/openclaw-service/README.md`

---

## Success! 🎉

You've successfully integrated OpenClaw with Cheeko. Children can now send WhatsApp messages to their parents using voice commands!

**Try it now:**
1. Start OpenClaw service
2. Scan WhatsApp QR code
3. Start LiveKit agent
4. Say: "Send a message to [phone number] saying hello!"
