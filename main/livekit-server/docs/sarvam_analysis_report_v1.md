# Sarvam AI STT/TTS Integration Analysis Report

**Version:** 1.0 (Preliminary)
**Date:** February 25, 2026
**Prepared by:** Cheeko Engineering Team
**Product:** Cheeko - AI Companion for Children
**Testing Period:** February 24-25, 2026

---

## 1. Executive Summary

Cheeko is a voice-first AI companion for children (ages 3-16) running on ESP32 hardware devices. We integrated Sarvam AI's speech models into our LiveKit-based real-time voice pipeline to serve Indian language users, starting with **Kannada (kn-IN)**.

### Models Tested
| Component | Model | Version |
|-----------|-------|---------|
| STT | Sarvam Saaras | v3 |
| TTS | Sarvam Bulbul | v3-beta |
| LLM | Groq (Llama 3.3 70B) | - |
| Plugin | livekit-plugins-sarvam | 1.4.3 |

### High-Level Findings

**What works well:**
- STT (saaras:v3) streaming transcription is stable and handles Kannada speech reliably
- STT WebSocket connections are maintained without drops
- Integration with LiveKit agents framework is clean via the official plugin

**Critical issues found:**
- **TTS WebSocket instability** - Sarvam TTS server closes WebSocket connections immediately after establishment, causing retries and adding 5-10s latency to every response
- **TTS language validation** - TTS rejects text that doesn't contain characters from the target language, but the LLM sometimes generates English responses even with a Kannada system prompt, causing complete TTS failures
- **End-to-end latency** - Currently 5-11s from user speech to agent response (target: <2s), primarily due to TTS connection issues

### What We Need from Sarvam Going Forward
1. **Fix TTS WebSocket streaming stability** - This is the #1 blocker for production deployment
2. **Graceful language fallback in TTS** - Handle mixed-language or English text without hard failures
3. **Server-side latency headers** - Return processing time metadata in API responses for monitoring
4. **Children's voice optimization** - STT tuning for ages 3-16 (higher pitch, simpler vocabulary)
5. **Dedicated support channel** - For real-time debugging during integration

---

## 2. Pipeline Architecture Overview

### System Architecture

```
ESP32 Device (Child's Toy)
    │
    │  MQTT / UDP (Opus-encoded audio, 16kHz mono)
    ▼
┌─────────────────────┐
│   MQTT Gateway      │  Node.js - Protocol bridge
│   (mqtt-gateway)    │  Decodes Opus → PCM, manages sessions
└────────┬────────────┘
         │  WebSocket (LiveKit protocol)
         ▼
┌─────────────────────┐
│   LiveKit Cloud     │  Real-time media routing
│   (SFU)             │  Room management, participant tracking
└────────┬────────────┘
         │  WebSocket (LiveKit SDK)
         ▼
┌──────────────────────────────────────────────────┐
│   LiveKit Agent Worker (Python)                   │
│                                                   │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │ Sarvam   │  │  Groq    │  │ Sarvam   │      │
│   │ STT      │→ │  LLM     │→ │ TTS      │      │
│   │saaras:v3 │  │llama-3.3 │  │bulbul:v3 │      │
│   │ (kn-IN)  │  │  -70b    │  │  -beta   │      │
│   └──────────┘  └──────────┘  └──────────┘      │
│                                                   │
│   VAD → STT → EOU → LLM → TTS → Audio Output    │
└──────────────────────────────────────────────────┘
```

### Per-Component Latency Breakdown (Observed)

| Stage | Description | Observed Latency | Notes |
|-------|-------------|-----------------|-------|
| VAD | Voice Activity Detection | ~50ms | Silero VAD, runs locally |
| STT | Sarvam saaras:v3 streaming | 1-2s | WebSocket streaming, stable |
| EOU | End-of-Utterance decision | ~300ms | Includes transcription finalization |
| LLM | Groq Llama 3.3 70B | 0.5-2s | TTFT varies by prompt length |
| TTS | Sarvam bulbul:v3-beta | 2-8s | **Highly variable due to WebSocket drops** |
| Network | ESP32 ↔ Server round-trip | ~100ms | DigitalOcean SGP1 region |
| **Total** | **End-to-end** | **5-11s** | **Target: <2s** |

### Deployment Environment

| Component | Details |
|-----------|---------|
| Cloud Provider | DigitalOcean |
| Region | SGP1 (Singapore) |
| Server | 4 vCPU, 8GB RAM, Ubuntu 22.04 |
| Python | 3.10 |
| LiveKit Agents SDK | Latest (installed via pip) |
| livekit-plugins-sarvam | 1.4.3 |
| Process Manager | PM2 |
| Audio Format | 16kHz, mono, PCM (from Opus) |

---

## 3. Reliability & Stability

### 3.1 STT (saaras:v3) - Stable

| Metric | Observation |
|--------|-------------|
| WebSocket Connection | Stable, no drops observed |
| Streaming Transcription | Works reliably for Kannada |
| Reconnection Handling | Not tested (no disconnects occurred) |
| Error Rate | 0% during testing |

**STT is the most stable component in the Sarvam integration.**

### 3.2 TTS (bulbul:v3-beta) - Unstable

This is the primary issue. Detailed observations from production logs:

#### WebSocket Connection Failures

**Pattern observed:** The TTS WebSocket connects successfully, then the server immediately closes the connection before any audio can be generated.

```
Sarvam TTS WebSocket connected (state: CONNECTED)
Sarvam TTS WebSocket connection closed by server (code=1000)
```

This happens on the **first attempt** of most TTS requests. The LiveKit framework retries, and the second or third attempt usually succeeds, but this adds 3-5 seconds of latency per turn.

| Metric | Value |
|--------|-------|
| First-attempt connection success rate | ~30-40% (estimated) |
| Typical retries needed | 1-2 |
| Latency added per retry | ~2-3s |
| Total TTS latency (with retries) | 5-8s |
| Total TTS latency (no retries) | 2-3s |

#### Language Validation Failures

The TTS API returns an error when the input text doesn't contain characters from the target language:

```
Error: Text must contain at least one character from the allowed languages.
```

This occurs when the LLM generates English text despite a Kannada system prompt. In a children's voice product, code-switching between English and the native language is extremely common and expected.

**Impact:** Complete turn failure - the child hears nothing in response.

**Current workaround:** We set the greeting instruction in Kannada script to force Kannada output, but this doesn't prevent English responses during free conversation.

**Requested fix:** The TTS should either:
1. Transliterate English text to the target language script before synthesis
2. Fall back to an English voice if the target language characters are missing
3. Handle code-mixed text (e.g., "ನಾನು happy ಇದ್ದೇನೆ") gracefully

### 3.3 SDK/API Integration Notes

| Aspect | Assessment |
|--------|------------|
| livekit-plugins-sarvam installation | Smooth, pip install works |
| API key configuration | Simple, via env var or constructor |
| STT streaming integration | Clean, follows LiveKit patterns |
| TTS streaming integration | API is clean, but server-side instability undermines it |
| Error messages | Clear and descriptive |
| Documentation | Adequate for basic usage, lacks troubleshooting guides |

### 3.4 Workarounds Currently in Place

1. **Greeting instruction in Kannada** - Force the LLM to respond in Kannada by writing the greeting instruction in Kannada script
2. **Greeting catchup mechanism** - Handle race condition where device signals readiness before the agent is initialized
3. **LiveKit framework auto-retry** - The framework retries TTS on WebSocket failures (3 attempts), masking some instability but adding latency

---

## 4. Use Case Specific Observations

### Product Context

Cheeko is an AI companion toy for children ages 3-16. The device is an ESP32-based hardware product that children interact with through voice. Key characteristics of our use case:

- **Real-time voice interaction** - Children expect immediate responses (sub-2s)
- **Indian languages** - Starting with Kannada, expanding to Hindi, Tamil, Telugu
- **Children's speech patterns** - Higher pitch, simpler vocabulary, frequent code-switching with English
- **Noisy environments** - Home/classroom background noise
- **Long sessions** - Children may talk for 15-30 minutes continuously
- **Emotional context** - Excitement, questions, storytelling require natural prosody

### Where Sarvam Helped

1. **Kannada STT accuracy** - saaras:v3 handles Kannada speech well, including children's pronunciation. This is significantly better than generic multilingual STT models for Indian languages.

2. **Natural Kannada TTS voice** - When bulbul:v3-beta works (no WebSocket drops), the voice quality is good - natural sounding, appropriate for a children's companion.

3. **Indian language first** - Unlike Google/Azure/AWS, Sarvam's models are purpose-built for Indian languages, which aligns with our market focus.

### Where Sarvam Hurt

1. **Latency kills the experience** - A child asking "ಏನು ಮಾಡ್ತಿದ್ದೀಯಾ?" (What are you doing?) and waiting 8-11 seconds for a response is unacceptable. Children lose interest in 2-3 seconds. The TTS WebSocket instability is the primary cause.

2. **Code-switching failures** - Indian children frequently mix English and their native language. When the LLM outputs "That's a great question! ..." in English, the TTS crashes entirely. The child hears silence.

3. **No fallback mechanism** - When TTS fails, there's no way to gracefully degrade (e.g., play a pre-recorded "I didn't catch that" message). The error propagates up and the turn is lost.

4. **Greeting latency** - The first TTS call (greeting) took 25 seconds originally due to initialization + WebSocket establishment. We optimized this to ~8 seconds, but it's still too slow for a "hello" message.

---

## 5. Issues & Feature Requests

### Critical Issues (Blocking Production)

| # | Issue | Severity | Details |
|---|-------|----------|---------|
| 1 | **TTS WebSocket drops** | P0 | Server closes connections immediately after establishment. Adds 3-5s latency per turn due to retries. This is the #1 blocker. |
| 2 | **TTS language validation** | P1 | Hard failure on English/mixed text. Needs graceful handling for code-switched content. |

### Important Issues (Affecting Quality)

| # | Issue | Severity | Details |
|---|-------|----------|---------|
| 3 | **TTS first-call latency** | P1 | First TTS call in a session takes significantly longer than subsequent calls. Impacts greeting experience. |
| 4 | **No server-side metrics** | P2 | API responses don't include processing time headers. We can't distinguish network latency from model inference time. |
| 5 | **No connection pooling** | P2 | Each TTS request establishes a new WebSocket connection. Connection reuse would reduce latency. |

### Feature Requests

| # | Request | Priority | Rationale |
|---|---------|----------|-----------|
| 1 | **Code-mixed TTS support** | High | "ನಾನು happy ಇದ್ದೇನೆ" should synthesize naturally mixing Kannada and English |
| 2 | **Children's voice option** | High | A younger-sounding voice would better fit a children's companion product |
| 3 | **Warm connection / keep-alive** | High | Allow persistent WebSocket connections across multiple TTS requests in a session |
| 4 | **Server-side latency headers** | Medium | `X-Processing-Time` or equivalent in API responses |
| 5 | **SSML support** | Medium | For controlling prosody, pauses, and emphasis in storytelling mode |
| 6 | **Emotion/expression control** | Low | Ability to convey excitement, surprise, sadness for interactive storytelling |

---

## 6. Metrics Collection Infrastructure (Now Active)

We have now instrumented our pipeline to collect detailed per-turn metrics for ongoing analysis. This data will feed into Report v2 with statistical benchmarks.

### What We're Collecting

**Per conversation turn:**
- STT: audio_duration, processing_duration, streamed flag
- TTS: time-to-first-byte (TTFB), total duration, audio duration, character count, Real-Time Factor (RTF), cancellation rate
- LLM: time-to-first-token (TTFT), total duration, token counts, tokens/second
- EOU: transcription_delay, end-of-utterance delay
- VAD: idle time, inference duration
- Errors: type, message, timestamp

**Per session:**
- P50/P95/P99 percentiles for all latency metrics
- Total audio processed (STT) and generated (TTS)
- Error count and error types
- Session duration, turn count

**Output:** Structured JSONL at `logs/sarvam_metrics.jsonl` for analysis.

### What We Need for Report v2
- 50-100 test sessions with varied inputs (short commands, long sentences, code-mixed speech)
- Ground truth transcriptions for WER calculation
- MOS evaluation from 15-20 Kannada native speakers
- Comparison with Google STT/TTS on same test set (if available)

---

## 7. Partnership Ask / Next Steps

### Immediate Asks (This Week)

1. **Root cause analysis for TTS WebSocket drops** - Can Sarvam investigate why the server is closing connections immediately after establishment? We can provide timestamps and request IDs.

2. **Dedicated engineering contact** - For real-time debugging during our integration sprint. We're actively building and need fast turnaround on issues.

3. **TTS connection keep-alive** - Is there a way to maintain a persistent WebSocket connection for the duration of a session (~15-30 min)?

### Short-Term Asks (Next 2 Weeks)

4. **Code-mixed text handling** - Either transliteration or graceful fallback for English text sent to Kannada TTS.

5. **Server-side metrics API** - Processing time, queue depth, and model inference time exposed in API responses or a separate metrics endpoint.

6. **Test environment with guaranteed SLA** - Dedicated endpoint or higher rate limits for our testing phase.

### Medium-Term Asks (Next Quarter)

7. **Children's voice model** - A voice tuned for younger audiences (friendly, energetic, age-appropriate).

8. **Multi-language support expansion** - We plan to launch in Hindi, Tamil, and Telugu. Need to understand model readiness and quality for each.

9. **SSML and expression support** - For our storytelling and game modes where prosody control is critical.

### Business Discussion

10. **Pricing for scale** - We expect 10,000+ daily active devices in Year 1. Need volume pricing for both STT and TTS.

11. **SLA guarantees** - Uptime (target: 99.9%), latency P99 (target: <500ms for TTS TTFB), and error rate commitments.

12. **Co-development opportunity** - We have unique data on children's speech patterns in Indian languages. Open to a data partnership where we share anonymized usage patterns in exchange for model improvements.

---

## Appendix A: Test Environment Details

```
Server: DigitalOcean Droplet (SGP1)
  - 4 vCPU Intel, 8GB RAM
  - Ubuntu 22.04 LTS
  - Kernel: 5.15.0-170-generic

Software:
  - Python 3.10
  - LiveKit Agents SDK (latest)
  - livekit-plugins-sarvam 1.4.3
  - PM2 process manager

Network:
  - Server location: Singapore
  - MQTT Broker: Same server (localhost)
  - LiveKit Cloud: Managed (LiveKit hosted)
  - Sarvam API: api.sarvam.ai (WebSocket + REST)

Device:
  - ESP32-S3 with INMP441 microphone
  - Audio: 16kHz, mono, Opus encoded
  - Connection: Wi-Fi → MQTT → Gateway → LiveKit
```

## Appendix B: Log Evidence (TTS WebSocket Issue)

Typical TTS request showing WebSocket drop and retry:

```
[T+0.000s] TTS request initiated (text: "ಹೌದು, ಅದು ...")
[T+0.100s] Sarvam TTS WebSocket connecting...
[T+0.250s] Sarvam TTS WebSocket connected (state: CONNECTED)
[T+0.300s] Sarvam TTS WebSocket connection closed by server (code=1000)
[T+0.350s] Retrying TTS... (attempt 2/3)
[T+0.450s] Sarvam TTS WebSocket connecting...
[T+0.600s] Sarvam TTS WebSocket connected (state: CONNECTED)
[T+0.700s] Sending text chunk to TTS...
[T+2.800s] First audio frame received (TTFB: 2.1s from retry)
[T+5.200s] TTS synthesis complete (audio: 3.2s)
```

**Total latency from this single TTS call: 5.2s** (should be ~2.5s without the retry)
