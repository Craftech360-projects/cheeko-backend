import os
import requests
from elevenlabs.client import ElevenLabs
from elevenlabs import save
from google import genai
from google.genai import types
from datetime import datetime
from PIL import Image
import io

# Initialize clients
def init_clients():
    # New SDK handles auth via env var GOOGLE_API_KEY usually, or we pass it
    pass

def generate_sound_effect(description, step_number, output_dir):
    """
    Generate a sound effect using ElevenLabs Sound Effects API.
    Returns the filepath of the generated sound effect, or None if failed.
    """
    try:
        client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
        
        print(f"Generating sound effect for step {step_number}: {description}")
        
        # ElevenLabs Sound Effects API
        # Note: This uses the sound-generation endpoint
        result = client.text_to_sound_effects.convert(
            text=description,
            duration_seconds=3.0,  # Short ambient sound
            prompt_influence=0.5   # How closely to follow the prompt
        )
        
        # Save the sound effect
        audio_bytes = b"".join(result)
        filename = f"step_{step_number}_sfx.mp3"
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, "wb") as f:
            f.write(audio_bytes)
        
        return filepath
    except Exception as e:
        print(f"Error generating sound effect for step {step_number}: {e}")
        print("Continuing without sound effect...")
        return None

def generate_audio(text, step_number, output_dir, model_id="eleven_turbo_v2_5", voice_id="mHX7OoPk2G45VMAuinIt", settings=None, sound_effect_description=None):
    """
    Generate audio using ElevenLabs.
    settings: dict with 'stability', 'similarity_boost', 'style', 'use_speaker_boost'
    sound_effect_description: Optional description for background sound effect
    """
    try:
        client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
        
        # Default "Expressive" settings if none provided
        if not settings:
            settings = {
                "stability": 0.5,       # Lower = More expressive/dramatic
                "similarity_boost": 0.8,
                "style": 0.5,           # Higher = More exaggeration
                "use_speaker_boost": True
            }

        # Using the new SDK pattern for text-to-speech
        audio_generator = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            voice_settings=settings
        )
        
        # The new SDK returns a generator of bytes
        audio_bytes = b"".join(audio_generator)
        
        filename = f"step_{step_number}_audio.mp3"
        filepath = os.path.join(output_dir, filename)
        
        # Save voice-only version first
        voice_only_path = os.path.join(output_dir, f"step_{step_number}_voice_only.mp3")
        with open(voice_only_path, "wb") as f:
            f.write(audio_bytes)
        
        # If sound effect is requested, generate and mix
        if sound_effect_description:
            sfx_path = generate_sound_effect(sound_effect_description, step_number, output_dir)
            
            if sfx_path:
                try:
                    from pydub import AudioSegment
                    
                    # Load both audio files
                    voice = AudioSegment.from_mp3(voice_only_path)
                    sfx = AudioSegment.from_mp3(sfx_path)
                    
                    # Make sound effect quieter (background)
                    sfx = sfx - 15  # Reduce volume by 15dB
                    
                    # Loop or trim sfx to match voice duration
                    if len(sfx) < len(voice):
                        # Loop the sound effect
                        loops_needed = (len(voice) // len(sfx)) + 1
                        sfx = sfx * loops_needed
                    
                    # Trim to voice length
                    sfx = sfx[:len(voice)]
                    
                    # Mix: overlay sound effect under voice
                    mixed = voice.overlay(sfx)
                    
                    # Export mixed audio
                    mixed.export(filepath, format="mp3")
                    print(f"Mixed voice + sound effect for step {step_number}")
                    
                except ImportError:
                    print("pydub not installed. Saving voice-only. Install with: pip install pydub")
                    # Just use voice-only
                    with open(filepath, "wb") as f:
                        f.write(audio_bytes)
                except Exception as mix_error:
                    print(f"Error mixing audio: {mix_error}. Using voice-only.")
                    with open(filepath, "wb") as f:
                        f.write(audio_bytes)
            else:
                # No sfx generated, use voice only
                with open(filepath, "wb") as f:
                    f.write(audio_bytes)
        else:
            # No sound effect requested
            with open(filepath, "wb") as f:
                f.write(audio_bytes)
            
        return filepath
    except Exception as e:
        print(f"Error generating audio for step {step_number}: {e}")
        return None

def generate_image(prompt, step_number, output_dir, esp32_mode=False):
    """
    Generate image using Gemini (Nano Banana / Imagen 3) or Pollinations fallback.
    If esp32_mode is True:
    - Appends 'pixel art' to prompt
    - Resizes to 150x150
    - Ensures < 20KB size
    """
    try:
        # Use new Google GenAI SDK
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        
        if esp32_mode:
            prompt = f"{prompt}, pixel art, 8-bit style, simple, high contrast, cartoon"
            filename_suffix = "_pixel"
        else:
            filename_suffix = ""
        
        # Helper for saving
        def save_and_process_image(image_data, path, is_bytes=True):
            # Open image
            if is_bytes:
                img = Image.open(io.BytesIO(image_data))
            else:
                img = Image.open(image_data) # Path or other object
            
            if esp32_mode:
                # Resize to 150x150
                img = img.resize((150, 150), Image.Resampling.NEAREST)
                # Overwrite filename to be .jpg for better size control if needed, or keep png
                # Let's save as optimized JPEG for strict size control
                path = path.replace(".png", ".jpg")
                img = img.convert("RGB")
                img.save(path, "JPEG", quality=85, optimize=True)
            else:
                if is_bytes:
                    with open(path, "wb") as f:
                        f.write(image_data)
                else:
                    img.save(path)
            
            return path

        print(f"Generating image with Gemini 2.5... (ESP32 Mode: {esp32_mode})")
        
        target_model = "gemini-2.5-flash-image" 
        
        try:
            # User's suggested pattern:
            response = client.models.generate_content(
                model=target_model,
                contents=[prompt],
                # config removed as it caused 400 error for image gen
            )
            
            # Parse response parts
            for part in response.parts:
                if part.inline_data:
                    # Bytes provided directly
                    filename = f"step_{step_number}_image{filename_suffix}.png"
                    filepath = os.path.join(output_dir, filename)
                    
                    return save_and_process_image(part.inline_data.data, filepath, is_bytes=True)
                    
        except Exception as api_err:
             print(f"Gemini Image Gen Error: {api_err}")
             # Will fall through to Pollinations
             
        # FALLBACK: Pollinations.ai (Free, reliable, good for POC)
        print("Falling back to Pollinations.ai...")
        # Clean prompt for URL
        safe_prompt = requests.utils.quote(prompt[:300]) 
        # Add slight enhancement for style
        style_suffix = "&model=pixel" if esp32_mode else ""
        poll_url = f"https://image.pollinations.ai/prompt/{safe_prompt}?width=1024&height=1024&seed={step_number}&nologo=true{style_suffix}"
        
        r_poll = requests.get(poll_url)
        if r_poll.status_code == 200:
            filename = f"step_{step_number}_image{filename_suffix}.jpg"
            filepath = os.path.join(output_dir, filename)
            return save_and_process_image(r_poll.content, filepath, is_bytes=True)
            
        return None

    except Exception as e:
        print(f"Error generating image for step {step_number}: {e}")
        return None
