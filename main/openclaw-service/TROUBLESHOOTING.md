# OpenClaw Service - Startup Troubleshooting Guide

## What You're Seeing

The encrypted text after scanning the QR code is **NORMAL**. It's WhatsApp's authentication data being saved to `memory/whatsapp-session/`.

The server restarting is also **NORMAL** in development mode because `nodemon` auto-restarts when files change.

---

## Current Issue

The service appears to have stopped or crashed after the restart. Let's diagnose:

### Step 1: Check if the service is running

Open a new terminal and run:

```bash
cd main/openclaw-service
npm run dev
```

Watch for any errors in the output.

### Step 2: Check the logs

```bash
# In the openclaw-service directory
cat logs/combined.log
# or
tail -f logs/combined.log
```

Look for error messages.

---

## Common Issues After QR Scan

### Issue 1: Port Already in Use

**Symptom:** Error: `EADDRINUSE: address already in use :::8003`

**Solution:**
```bash
# Windows - Kill process on port 8003
netstat -ano | findstr :8003
taskkill /PID <PID> /F

# Then restart
npm run dev
```

### Issue 2: WhatsApp Session Corrupted

**Symptom:** Service crashes after QR scan

**Solution:**
```bash
# Delete the session and re-scan
rm -rf memory/whatsapp-session
npm run dev
# Scan QR code again
```

### Issue 3: Missing Dependencies

**Symptom:** Module not found errors

**Solution:**
```bash
npm install
npm run dev
```

---

## Manual Test Steps

### 1. Start the service (if not running)

```bash
cd main/openclaw-service
npm run dev
```

### 2. Wait for "WhatsApp client ready!" message

You should see:
```
[WHATSAPP] ✅ WhatsApp client ready!
✅ OpenClaw Service running on port 8003
```

### 3. Test health endpoint

In a new terminal:
```bash
curl http://localhost:8003/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "openclaw-service",
  "timestamp": "2026-02-03T10:30:00.000Z"
}
```

### 4. Check WhatsApp status

```bash
curl http://localhost:8003/api/message/status
```

Expected response:
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

### 5. Send a test message

```bash
curl -X POST http://localhost:8003/api/message/send \
  -H "Content-Type: application/json" \
  -d "{\"platform\":\"whatsapp\",\"recipient\":\"+YOUR_PHONE_NUMBER\",\"message\":\"Test from Cheeko!\"}"
```

Replace `+YOUR_PHONE_NUMBER` with your actual WhatsApp number.

---

## What to Do Now

1. **Check if the service is still running**
   - Look at the terminal where you ran `npm run dev`
   - Is it showing errors or is it running?

2. **If it crashed:**
   - Share the error message
   - Check `logs/combined.log` for details

3. **If it's running:**
   - Test the health endpoint: `curl http://localhost:8003/health`
   - Test the status endpoint: `curl http://localhost:8003/api/message/status`

4. **If everything works:**
   - Try sending a test message to your own WhatsApp number
   - Then test with voice command via Cheeko

---

## Expected Behavior After QR Scan

1. ✅ QR code appears
2. ✅ You scan it with WhatsApp mobile
3. ✅ You see encrypted session data (NORMAL)
4. ✅ Service restarts (NORMAL in dev mode)
5. ✅ You see "WhatsApp client ready!"
6. ✅ Service is running on port 8003
7. ✅ Health check works
8. ✅ Status shows `"ready": true`

---

## Next Steps

**Please share:**
1. What you see in the terminal where `npm run dev` is running
2. Any error messages
3. Output of `curl http://localhost:8003/health`

This will help me diagnose the issue!
