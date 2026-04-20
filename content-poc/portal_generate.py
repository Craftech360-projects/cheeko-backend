import argparse
import json
import math
import os
import random
import re
import struct
import wave
from pathlib import Path


def sanitize_text(value):
    return re.sub(r"\s+", " ", (value or "").strip())


def fallback_plan(topic, description, generation_mode, step_count):
    base_intro = description or f"A child-friendly {generation_mode.lower()} about {topic}."
    items = []

    for step in range(1, step_count + 1):
        if step == 1:
            text = f"[excited] Hi there, I am Cheeko! Today we are exploring {topic}. {base_intro}"
            prompt = f"Cheeko the fox warmly greeting the child while introducing {topic}, cozy full scene, expressive pose, bright storybook environment, complete detailed background"
            sfx = "gentle bell chime"
        elif step == step_count:
            text = f"[warmly] And that is our {topic} journey for today. Thank you for spending time with Cheeko, my friend."
            prompt = f"Cheeko the fox waving goodbye after a {topic} adventure, comforting full scene, golden light, detailed background environment"
            sfx = "soft sparkle"
        else:
            beat = [
                "discovering something new",
                "trying a playful challenge",
                "learning a gentle lesson",
                "sharing a happy moment",
                "finding a calm solution",
                "celebrating a small win"
            ][(step - 2) % 6]
            text = f"[curious] Step {step}: Cheeko is {beat} about {topic}, helping the child imagine what happens next."
            prompt = f"Cheeko the fox {beat} in a {topic} themed scene, expressive emotion, full environment, vivid details across foreground and background"
            sfx = random.choice(["soft wind", "playful giggle", "tiny drum tap", "gentle page turn", "forest birds"])

        items.append({
            "step": step,
            "text": sanitize_text(text),
            "sound_effect": sfx,
            "image_prompt": sanitize_text(prompt)
        })

    return items


def write_placeholder_wav(file_path, text):
    sample_rate = 22050
    duration = max(2.0, min(6.0, len(text) / 35.0))
    frequency = 440.0
    amplitude = 0.25
    nframes = int(sample_rate * duration)

    with wave.open(str(file_path), "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        for i in range(nframes):
            value = int(32767 * amplitude * math.sin(2 * math.pi * frequency * (i / sample_rate)))
            wav_file.writeframesraw(struct.pack("<h", value))


def write_placeholder_png(file_path, title, subtitle):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        # Minimal valid 1x1 PNG fallback
        file_path.write_bytes(
            bytes.fromhex(
                "89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE0000000C49444154789C63606060000000040001F61738550000000049454E44AE426082"
            )
        )
        return

    image = Image.new("RGB", (1024, 1024), color=(245, 235, 214))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((80, 80, 944, 944), radius=40, fill=(255, 252, 244), outline=(219, 157, 87), width=8)
    draw.ellipse((110, 120, 330, 340), fill=(255, 171, 92), outline=(120, 78, 31), width=6)
    draw.ellipse((180, 180, 205, 205), fill=(50, 35, 23))
    draw.ellipse((235, 180, 260, 205), fill=(50, 35, 23))
    draw.polygon([(215, 210), (230, 235), (245, 210)], fill=(120, 78, 31))
    draw.arc((170, 220, 270, 280), start=10, end=170, fill=(120, 78, 31), width=5)
    draw.text((120, 410), title[:64], fill=(64, 46, 24))
    draw.text((120, 470), subtitle[:220], fill=(102, 84, 63))
    image.save(file_path, format="PNG")


def generate_assets(plan_items, output_dir):
    provider = os.getenv("CREATOR_PORTAL_TTS_PROVIDER", "placeholder").lower()

    for item in plan_items:
        step = item["step"]
        text = item["text"]
        prompt = item["image_prompt"]
        audio_ready = False
        image_ready = False

        try:
            from generators import generate_audio, generate_audio_fish, generate_image

            if provider == "fish":
                audio_ready = bool(generate_audio_fish(text, step, str(output_dir)))
            elif provider == "elevenlabs":
                audio_ready = bool(generate_audio(text, step, str(output_dir), sound_effect_description=item.get("sound_effect")))
            else:
                audio_ready = False

            image_ready = bool(generate_image(prompt, step, str(output_dir), esp32_mode=True))
        except Exception:
            audio_ready = False
            image_ready = False

        if not audio_ready:
            write_placeholder_wav(output_dir / f"step_{step}_audio.wav", text)
        if not image_ready:
            write_placeholder_png(output_dir / f"step_{step}_image_pixel.png", f"Step {step}", text)


def try_ai_plan(topic, generation_mode):
    try:
        from crewai import Crew, Process
        from agents import ContentAgents
        from tasks import ContentTasks

        agents = ContentAgents()
        tasks = ContentTasks()

        planner = agents.planner_agent()
        writer = agents.writer_agent()
        visualizer = agents.visualizer_agent()

        plan_task = tasks.plan_task(planner, topic, generation_mode)
        write_task = tasks.write_task(writer, plan_task, generation_mode)
        visualize_task = tasks.visualize_task(visualizer, write_task, "Pixel Art", generation_mode)

        crew = Crew(
            agents=[planner, writer, visualizer],
            tasks=[plan_task, write_task, visualize_task],
            verbose=False,
            process=Process.sequential
        )

        result = crew.kickoff()
        raw = getattr(result, "raw", result)
        match = re.search(r"\[.*\]", str(raw), re.DOTALL)
        if not match:
            return None

        parsed = json.loads(match.group(0))
        if isinstance(parsed, list) and parsed:
            return parsed
    except Exception:
        return None

    return None


def main():
    parser = argparse.ArgumentParser(description="Generate creator-portal content draft assets.")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--content-type", required=True)
    parser.add_argument("--generation-mode", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--step-count", type=int, default=10)
    parser.add_argument("--esp32-mode", action="store_true")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    plan_items = try_ai_plan(args.topic, args.generation_mode)
    if not plan_items:
        plan_items = fallback_plan(args.topic, args.description, args.generation_mode, args.step_count)

    with open(output_dir / "plan.json", "w", encoding="utf-8") as handle:
        json.dump(plan_items, handle, indent=2, ensure_ascii=False)

    generate_assets(plan_items, output_dir)

    print(json.dumps({
        "topic": args.topic,
        "contentType": args.content_type,
        "generationMode": args.generation_mode,
        "language": args.language,
        "outputDir": str(output_dir),
        "itemCount": len(plan_items)
    }))


if __name__ == "__main__":
    main()
