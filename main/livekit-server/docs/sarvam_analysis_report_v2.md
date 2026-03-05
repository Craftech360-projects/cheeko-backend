# Sarvam AI - Latency Benchmark Report

**Date:** February 26, 2026
**Product:** Cheeko (AI Voice Companion for Children)

---

## Models Tested

| Component | Provider | Model | Protocol |
|-----------|----------|-------|----------|
| STT | Sarvam AI | saaras:v3 | WebSocket Streaming |
| LLM | Groq | openai/gpt-oss-20b | REST API |
| TTS | Sarvam AI | bulbul:v3-beta | WebSocket Streaming |

---

## 1. STT Latency (Sarvam saaras:v3)

Time from user stops speaking to final transcript received.

| Language | Samples | Avg | P50 | P95 |
|----------|---------|-----|-----|-----|
| kn-IN | - | - | - | - |

> Data will populate after testing with the updated collector.

---

## 2. LLM Latency (Groq)

Time to first token (TTFT).

| Model | Samples | TTFT Avg | TTFT P50 | TTFT P95 | Tok/s |
|-------|---------|----------|----------|----------|-------|
| openai/gpt-oss-20b | 22 | 2.404s | 2.477s | 2.646s | 47.5 |
| llama-3.3-70b-versatile | 1 | 2.861s | 2.861s | 2.861s | 73.9 |

---

## 3. TTS Latency (Sarvam bulbul:v3-beta)

Time to first byte (TTFB) - how long before audio starts playing.

| Speaker | Language | Samples | Avg | P50 | P95 | Min | Max |
|---------|----------|---------|-----|-----|-----|-----|-----|
| ishita | kn-IN | 20 | 1.485s | 1.153s | 3.290s | 0.329s | 3.290s |

---

## 4. Combined Turn Latency (STT + LLM + TTS)

Full conversational turn: user stops speaking to agent starts speaking.

| STT | LLM | TTS | Language | Turns | E2E Avg | E2E P50 | E2E P95 |
|-----|-----|-----|----------|-------|---------|---------|---------|
| saaras:v3 | openai/gpt-oss-20b | bulbul:v3-beta | kn-IN | - | - | - | - |

> Turn-level breakdown (STT / LLM / TTS split) will populate after testing with the updated collector.

### Estimated breakdown (from individual metrics):

| Stage | P50 |
|-------|-----|
| STT (saaras:v3) | ~streaming (near 0) |
| LLM TTFT (gpt-oss-20b) | 2.477s |
| TTS TTFB (bulbul:v3-beta, ishita) | 1.153s |
| **Estimated total** | **~3.6s** |

---

## Test Configurations

To test different models/languages, update `config.yaml`:

```yaml
sarvam:
  stt:
    model: "saaras:v3"
    language: "kn-IN"     # Change to: hi-IN, ta-IN, te-IN, en-IN
  tts:
    model: "bulbul:v3-beta"
    speaker: "ishita"     # Change to: shubh, ritu, simran, meera
    target_language_code: "kn-IN"
```

Then restart: `pm2 restart cheeko-sarvam-agent`

Each test session automatically logs to `logs/sarvam_metrics.jsonl`.
Run `python scripts/analyze_sarvam_metrics.py` to see updated numbers.

---

*Data source: logs/sarvam_metrics.jsonl*
