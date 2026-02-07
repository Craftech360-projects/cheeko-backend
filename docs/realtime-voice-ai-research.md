# Real-Time Voice AI Models Research (2026)

> Research findings for Cheeko voice assistant: Qwen3-Omni, Gemini Live, OpenAI Realtime, and self-hosting options.

---

## TL;DR

| Recommendation | Use Case |
|----------------|----------|
| **Gemini Live API** | Cheapest hosted option, has free tier, LiveKit plugin exists |
| **Qwen2.5-Omni-7B (self-hosted)** | Best for unlimited usage, runs on single 16-24GB GPU |
| **DashScope Qwen3-Omni** | Best quality Qwen, cheap, works from India |
| **OpenAI Realtime** | Best quality overall, but 6x more expensive |

---

## 1. Available Real-Time Voice Models

### Models with Voice Input + Voice Output

| Model | Provider | Voice In | Voice Out | Notes |
|-------|----------|----------|-----------|-------|
| **Qwen3-Omni-30B-A3B** | Alibaba | Yes | Yes | MoE architecture, 30B params (3B active) |
| **Qwen2.5-Omni-7B** | Alibaba | Yes | Yes | Smaller, easier to self-host |
| **GPT-4o Realtime** | OpenAI | Yes | Yes | Best quality, most expensive |
| **Gemini 2.5 Flash Native Audio** | Google | Yes | Yes | Cheapest, has free tier |

### Qwen3-Omni Specifications

- **Architecture**: MoE (Mixture of Experts) - 30B total, ~3B active
- **Latency**: ~234ms first-packet (cold start)
- **Languages**: 10+ languages supported
- **Modalities**: Text, Audio, Image, Video input → Text + Audio output
- **License**: Open-source (Apache 2.0)

---

## 2. Hosted API Providers

### Providers WITH Audio Output Support

| Provider | Endpoint | Audio Out | Notes |
|----------|----------|-----------|-------|
| **Alibaba DashScope** | `dashscope-intl.aliyuncs.com` | Yes | Only provider with full Qwen audio output |
| **OpenAI** | `api.openai.com` | Yes | Realtime API |
| **Google** | `generativelanguage.googleapis.com` | Yes | Gemini Live API |

### Providers WITHOUT Audio Output (Text Only)

| Provider | Audio In | Audio Out | Why |
|----------|----------|-----------|-----|
| **Fireworks AI** | Yes | No | Text-only output, ignores modalities param |
| **SiliconFlow** | Yes | No | Text-only output |
| **Together AI** | Yes | No | Text-only output |
| **HuggingFace Inference** | Yes | No | Text-only output |

---

## 3. Pricing Comparison

### Cost Per Minute of Voice Conversation

| Platform | Model | Cost/min | Free Tier | India Access |
|----------|-------|----------|-----------|--------------|
| **Gemini** | 2.5 Flash Native Audio | **~$0.04** | Yes | Yes |
| **DashScope** | Qwen3-Omni-Flash | ~$0.05 | 1M tokens (90 days) | Yes (Singapore) |
| **ElevenLabs** | Conversational AI | ~$0.08-0.10 | Limited | Yes |
| **OpenAI** | gpt-realtime | ~$0.30 | No | Yes |

### Detailed Token Pricing

#### Gemini 2.5 Flash Native Audio
| Type | Free Tier | Paid (per 1M tokens) |
|------|-----------|---------------------|
| Text Input | Free | $0.50 |
| Audio/Video Input | Free | $3.00 |
| Text Output | Free | $2.00 |
| Audio Output | Free | $12.00 |

#### DashScope Qwen3-Omni-Flash
| Type | Cost (per 1M tokens) |
|------|---------------------|
| Audio Input | $3.81 |
| Audio+Text Output | $15.11 |

#### OpenAI Realtime
| Type | Cost |
|------|------|
| Audio Input | $0.06/min |
| Audio Output | $0.24/min |
| **Total** | **$0.30/min** |

### Monthly Cost Estimate (1000 minutes)

| Option | Monthly Cost |
|--------|-------------|
| Self-host (own GPU) | **$0** (electricity only) |
| Self-host (rented GPU) | ~$12 |
| Gemini Live API | ~$40 |
| DashScope | ~$50 |
| OpenAI Realtime | ~$300 |

---

## 4. Self-Hosting Options

### Qwen2.5-Omni-7B (Recommended for Self-Hosting)

Best balance of quality and resource requirements.

#### Hardware Requirements

| GPU | Quantization | VRAM Needed | Works? |
|-----|-------------|-------------|--------|
| RTX 3080 (10GB) | INT4 (AWQ) | ~5GB | Yes |
| RTX 4060 Ti (16GB) | INT8 | ~9GB | Yes |
| RTX 4090 (24GB) | BF16 (full) | ~16GB | Yes |
| RTX 3080 (10GB) | BF16 (full) | ~16GB | No |

#### Quick Setup

```bash
# Install vLLM-Omni
pip install vllm-omni

# Serve with audio output enabled
VLLM_USE_MODELSCOPE=true vllm serve Qwen/Qwen2.5-Omni-7B \
  --port 8801 \
  --dtype bfloat16 \
  --max-model-len 32768
```

### Qwen3-Omni-30B-A3B (Higher Quality)

MoE architecture - 30B params but only 3B active.

#### Hardware Requirements

| GPU | Quantization | VRAM Needed | Works? |
|-----|-------------|-------------|--------|
| RTX 4090 (24GB) | Q4_K_M | ~19GB | Tight |
| 2x RTX 4090 | BF16 | ~40GB | Comfortable |
| A100 (80GB) | BF16 | ~60GB | Production-grade |
| 8x H100 (80GB each) | BF16 | Full | Flagship deployment |

---

## 5. India-Specific Options

### Global APIs Available in India

| Platform | Works from India | Notes |
|----------|-----------------|-------|
| OpenAI | Yes | Global API |
| Google Gemini | Yes | Google AI Studio |
| DashScope | Yes | Singapore endpoint |
| ElevenLabs | Yes | Global |

### India-Focused Providers

| Provider | Languages | Features |
|----------|-----------|----------|
| **Sarvam AI** | 11 Indian languages | Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi, Odia, English |
| **Reverie** | Regional languages | On-prem option, noise resilience |

---

## 6. Integration with LiveKit (Cheeko)

### Available LiveKit Plugins

| Model | Plugin Available | Docs |
|-------|-----------------|------|
| Gemini Live | Yes | [docs.livekit.io/agents/plugins/gemini](https://docs.livekit.io/agents/models/realtime/plugins/gemini/) |
| OpenAI Realtime | Yes | [docs.livekit.io/agents/plugins/openai](https://docs.livekit.io/agents/models/realtime/plugins/openai/) |
| Qwen (via OpenAI-compatible) | Manual | Use OpenAI plugin with custom base_url |

---

## 7. Code Examples

### DashScope Qwen3-Omni (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_DASHSCOPE_API_KEY",
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

# IMPORTANT: stream=True is REQUIRED for audio output
completion = client.chat.completions.create(
    model="qwen3-omni-flash",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Hello!"},
            {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}}
        ]
    }],
    modalities=["text", "audio"],
    audio={"voice": "Cherry", "format": "wav"},
    stream=True,
)

# Collect audio chunks from stream
for chunk in completion:
    if chunk.choices[0].delta.audio:
        audio_data = chunk.choices[0].delta.audio.get('data')
```

### Available Voices (DashScope)

Cherry, Ethan, Jennifer, Ryan, Katerina, plus 44 more including regional dialects (Shanghai, Beijing, Sichuan, Cantonese).

---

## 8. Key Findings

### Why Fireworks/SiliconFlow Don't Return Audio

These providers expose Qwen3-Omni as a **text-only output** model. They:
- Accept the `modalities: ["text", "audio"]` parameter
- Silently ignore it
- Return only text responses

Only **DashScope** implements the full Thinker+Talker pipeline for audio output.

### Streaming Requirement

DashScope **requires** `stream=True` for audio output. Non-streaming requests return text only.

---

## 9. Recommendations for Cheeko

### Short-term (Testing/Development)
Use **Gemini Live API** with free tier - already has LiveKit plugin.

### Medium-term (Production)
Use **DashScope Qwen3-Omni** - cheap, good quality, works from India.

### Long-term (Scale)
Self-host **Qwen2.5-Omni-7B** on dedicated GPU - zero per-token cost.

---

## Resources

- [Qwen3-Omni GitHub](https://github.com/QwenLM/Qwen3-Omni)
- [Qwen2.5-Omni GitHub](https://github.com/QwenLM/Qwen2.5-Omni)
- [DashScope Qwen-Omni Docs](https://www.alibabacloud.com/help/en/model-studio/qwen-omni)
- [DashScope API Key](https://modelstudio.console.alibabacloud.com/?tab=model#/api-key)
- [Gemini Live API Docs](https://ai.google.dev/gemini-api/docs/live)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [vLLM-Omni Docs](https://docs.vllm.ai/projects/vllm-omni/en/latest/)
- [LiveKit Gemini Plugin](https://docs.livekit.io/agents/models/realtime/plugins/gemini/)
- [Sarvam AI](https://www.sarvam.ai/apis/text-to-speech)

---

*Last updated: February 2026*
