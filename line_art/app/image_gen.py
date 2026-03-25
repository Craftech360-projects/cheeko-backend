import base64
import io
import logging

import httpx
from PIL import Image

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = (
    "simple black and white line art drawing of {subject}, "
    "minimal style, clean lines, white background, no shading, outline only"
)

HF_API_URL = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"
TARGET_WIDTH = 384


def build_prompt(subject: str) -> str:
    return PROMPT_TEMPLATE.format(subject=subject.strip())


async def generate_with_huggingface(prompt: str, api_token: str | None = None) -> bytes:
    headers = {}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(HF_API_URL, headers=headers, json={"inputs": prompt})
        resp.raise_for_status()
        return resp.content


def to_raw_mono(image_bytes: bytes) -> tuple[bytes, bytes]:
    """Convert image to 384px wide 1-bit monochrome raw bitmap.

    Returns (png_bytes_for_preview, raw_mono_bytes).

    Raw format:
      - 1-bit: black=1, white=0
      - MSB first (leftmost pixel = bit 7)
      - Top-down row order
      - 48 bytes per row (384 / 8), no padding
      - No header, no compression
    """
    img = Image.open(io.BytesIO(image_bytes))

    # Resize to 384px wide, preserve aspect ratio
    w, h = img.size
    new_h = int(h * TARGET_WIDTH / w)
    img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)

    # Convert to 1-bit monochrome (Pillow "1" mode uses 0=black, 255=white)
    img_mono = img.convert("1")

    # Generate PNG preview
    png_buf = io.BytesIO()
    img_mono.save(png_buf, format="PNG")
    png_bytes = png_buf.getvalue()

    # Pack into raw bytes: black=1, white=0, MSB first
    pixels = img_mono.load()
    raw = bytearray()
    for y in range(new_h):
        for x_byte in range(TARGET_WIDTH // 8):
            byte = 0
            for bit in range(8):
                x = x_byte * 8 + bit
                # Pillow "1" mode: 0 = black, 255 = white
                # Firmware wants: 1 = black, 0 = white
                if pixels[x, y] == 0:
                    byte |= (0x80 >> bit)
            raw.append(byte)

    return png_bytes, bytes(raw)


async def generate_line_art(subject: str, hf_token: str | None = None) -> tuple[str, str, str, int]:
    """Generate line art image.

    Returns (base64_image_uri, prompt_used, base64_raw_mono, height).
    """
    prompt = build_prompt(subject)

    image_bytes = await generate_with_huggingface(prompt, hf_token)

    png_bytes, raw_bytes = to_raw_mono(image_bytes)
    image_b64 = base64.b64encode(png_bytes).decode()
    raw_b64 = base64.b64encode(raw_bytes).decode()
    height = len(raw_bytes) // 48  # 48 bytes per row

    return f"data:image/png;base64,{image_b64}", prompt, raw_b64, height
