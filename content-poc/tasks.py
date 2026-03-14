from crewai import Task
from textwrap import dedent
from categories import CATEGORIES

class ContentTasks:
    def plan_task(self, agent, topic, content_type="Story"):
        style_instruction = ""
        is_story = content_type in ["Story Cards", "Granny Stories"]

        if content_type == "Routine":
            style_instruction = "Focus on a clear, step-by-step logical sequence. It should feel like a helpful guide, not just a story."
        elif content_type == "Song/Rhyme":
            style_instruction = "Focus on rhythm and rhyme scheme. Ensure the steps flow like verses."
        elif content_type == "Learning":
            style_instruction = "Focus on facts and discovery. Each step should be a small 'did you know' or observation."
        elif is_story:
            style_instruction = (
                "Focus on narrative arc, imagination, and storytelling. "
                "The story is NARRATED by Cheeko the Fox — a friendly fox character who tells the story to the child. "
                "The story should have OTHER CHARACTERS (animals, people, etc.) that Cheeko talks about and interacts with. "
                "Step 1 MUST be Cheeko's introduction: greeting the child and setting up the story. "
                "The LAST step MUST be Cheeko wrapping up with the MORAL of the story in a warm, friendly way. "
                "The middle steps should tell the actual story with a clear beginning, conflict/challenge, and resolution."
            )
        else:
            style_instruction = "Focus on narrative arc, imagination, and storytelling."

        return Task(
            description=dedent(f"""
                Create a detailed outline for a 10-step audio guide for children about: {topic}.
                Type/Style: {content_type}.

                Guidelines:
                - {style_instruction}
                - Simple language (ages 3-8).
                - Emotional arc suitable for the topic.

                The outline should just list the focus of each step.
            """),
            expected_output="A list of 10 steps with a brief description of the action/focus for each.",
            agent=agent
        )

    def write_task(self, agent, context_task, content_type="Story"):
        is_story = content_type in ["Story Cards", "Granny Stories"]

        # Distinct writing style based on type
        if content_type == "Routine":
            tone = "Encouraging, clear, and direct. Use phrases like 'Let's try...' or 'Now we...'. Slightly rhythmic but NOT rhyming poems. Conversational. Add gentle pauses with commas."
        elif content_type == "Song/Rhyme":
            tone = "Lyrical, rhyming (AABB or ABCB), and very rhythmic. It should be sung or chanted. Kid-friendly and playful."
        elif content_type == "Learning":
            tone = "Curious, excited, and educational. Ask questions and give answers. Speak slowly for kids to follow."
        elif content_type == "Meditation":
            tone = "Very slow, sensory, varying breath focus. Whisper-soft. Long pauses between phrases."
        else:
            tone = "Narrative, descriptive, and dreamy. Typical storybook language. Gentle pacing for children."

        story_rules = ""
        if is_story:
            story_rules = """
                STORY NARRATION RULES (CRITICAL):
                - Cheeko the Fox is the NARRATOR. He speaks directly to the child in first person.
                - Step 1 MUST start with Cheeko's introduction, like:
                  "Hi there! I am Cheeko, your friendly fox friend! Today, I have a wonderful story for you. Are you ready? Let's begin!"
                - Cheeko narrates what happens in the story. He describes other characters and their actions.
                  Example: "There was a little rabbit named Benny, who lived near a big oak tree. One day, Benny found something shiny on the ground..."
                - Cheeko should react to the story as he tells it:
                  "Oh no! Can you believe what happened next?" or "And guess what, my friend?"
                - The LAST step MUST have Cheeko deliver the MORAL of the story warmly:
                  "And that's the story, my friend! Do you know what we learned today? We learned that sharing makes everyone happy. Bye bye for now!"
                - The story MUST have other named characters (animals, children, etc.) — not just Cheeko alone.
            """

        # Get category-specific emotion config
        cat_config = CATEGORIES.get(content_type, {})
        emotion_tags = cat_config.get("emotion_tags", "[excited], [whispers], [pause], [curious]")
        speech_style = cat_config.get("speech_style", "Like a warm, friendly narrator — natural and engaging.")
        speech_example = cat_config.get("speech_example", "[excited] Hi there! Today we're going to have SO much fun! [pause] Are you ready?")

        return Task(
            description=dedent(f"""
                Using the plan provided, write the ACTUAL script for the 10 steps.
                Content Type: {content_type}
                Target Tone: {tone}
                {story_rules}
                - Total steps: 10.
                - Keep each step short (2-3 sentences for stories, 1-2 for others).
                - Ensure the language fits the Target Tone perfectly.
                - Make it KID-FRIENDLY: simple words, gentle pacing, add commas for natural pauses.
                - For EACH step, also suggest a SHORT sound effect description (e.g., "gentle bell chime", "soft rain", "playful giggle", "calm ocean waves").

                VOICE PERSONALITY & EMOTION (CRITICAL — this makes the audio feel HUMAN):

                Your voice personality for this category: {speech_style}

                Preferred emotion tags for this category: {emotion_tags}
                You MUST use these tags naturally throughout the script. Don't force them — place them where a real human would naturally change their tone.

                Pacing markers (use alongside tags to sound natural):
                - "..." (ellipsis) — natural thinking pauses, weight, hesitation
                - "—" (em dash) — short dramatic pauses mid-sentence
                - ALL CAPS — emphasis on ONE key word: "That's SO cool!" not "THAT'S SO COOL!"
                - "!" and "?" — convey genuine emotion, don't overuse

                REFERENCE EXAMPLE for this category (match this energy and feel):
                {speech_example}

                IMPORTANT RULES for natural human speech:
                - Vary the energy within each step — don't start every sentence the same way.
                - Use filler words naturally: "you know...", "well...", "hmm...", "okay so..."
                - React to the content as a real person would — surprise, wonder, empathy.
                - Don't put an emotion tag on EVERY sentence — let some sentences breathe naturally.
                - The script should sound like someone TALKING, not reading from a page.

                IMPORTANT: Output valid JSON format ONLY.
                Structure:
                [
                    {{ "step": 1, "text": "...", "sound_effect": "gentle bell chime" }},
                    ...
                ]
            """),
            expected_output="A valid JSON array containing 10 objects, each with 'step', 'text' (the spoken script with emotion tags embedded), and 'sound_effect' (brief description).",
            context=[context_task],
            agent=agent
        )

    def visualize_task(self, agent, context_task, visual_style="Watercolor", content_type="Story"):
        if visual_style == "Pixel Art":
            style_desc = "16-bit pixel art with rich colors, detailed shading, anti-aliased edges, vibrant palette, expressive characters"
        else:
            style_desc = "Soft watercolor, minimal, storybook style, warm pastel colors."

        is_story = content_type in ["Story Cards", "Granny Stories"]

        story_image_rules = ""
        if is_story:
            story_image_rules = """
                STORY NARRATOR IMAGE RULES (CRITICAL for Story Cards and Granny Stories):
                - Cheeko the Fox is the NARRATOR and must appear in EVERY image as a storyteller present in the scene.
                - If the story has OTHER CHARACTERS (rabbit, bird, bear, child, etc.), they MUST ALSO appear in the image alongside Cheeko.
                - Cheeko should be positioned as a narrator/observer IN the scene — watching, reacting, or gesturing toward the other characters and their actions.
                - Other characters should be performing the story action while Cheeko watches/reacts nearby.
                - Step 1 image: Cheeko waving or greeting warmly, setting the scene.
                - Last step image: Cheeko waving goodbye with a warm smile.

                STORY FEW-SHOT EXAMPLES:

                Example 1 (story about sharing): "the fox stands to the side with a warm smile, gesturing toward a small rabbit and a bear cub who are sharing a basket of berries between them, in a sunny forest clearing with wildflowers and tall oak trees, dappled golden sunlight filtering through the leaves"

                Example 2 (story about bravery): "the fox watches with a proud expression as a tiny mouse bravely crosses a wobbly log bridge over a sparkling stream, lush green riverbanks with colorful pebbles, soft afternoon sunlight with butterflies fluttering around"

                Example 3 (intro scene): "the fox waves cheerfully at the viewer with one paw raised, standing on a grassy hilltop with a storybook open at its feet, a magical golden sunset sky with fluffy clouds, a cozy village visible in the valley below"
            """

        return Task(
            description=dedent(f"""
                Based on the script, create an Image Generation Prompt for EACH of the 10 steps.

                CRITICAL RULES for image prompts:
                - EVERY image must be a COMPLETE SCENE with a fully detailed background environment.
                - The fox character (Cheeko) MUST appear in EVERY image, placed INSIDE the environment.
                - Give the fox EXPRESSIVE emotions matching the step (curious, excited, surprised, happy, sleepy, etc.)
                - ALWAYS describe the FULL BACKGROUND ENVIRONMENT in detail: ground/floor, sky/ceiling, surrounding objects, lighting, atmosphere, weather, time of day.
                - The background must fill the ENTIRE image - no empty space, no plain colors, no transparency.
                - Use wide shot or full scene framing so the environment is clearly visible around the characters.
                - DO NOT include any style keywords (no "pixel art", "retro", "8-bit" etc.) — style is handled separately.
                - DO NOT describe the fox's appearance — that is handled separately.
                - Each prompt should follow this structure: [characters + actions + emotions] + [ground/surface details] + [background environment] + [lighting/atmosphere/mood]
                {story_image_rules}
                GENERAL FEW-SHOT EXAMPLES:

                Example 1 (space topic): "the fox floats in space wearing a tiny astronaut helmet, arms spread wide with an amazed expression, Earth glowing blue and green in the background, surrounded by twinkling stars and distant galaxies, soft cosmic light illuminating the scene"

                Example 2 (bedtime topic): "the fox yawns sleepily while hugging a soft pillow, sitting on a cozy bed with a patchwork quilt, warm bedroom with a glowing nightlight on the wooden bedside table, moonlight streaming through a curtained window, shelves with storybooks on the wall"

                BAD example: "the fox holds a magnifying glass" (FAILS: no background, no other characters, no environment — produces empty/transparent background)

                - PRESERVE the 'text' and 'sound_effect' fields from the input exactly as they are.

                IMPORTANT: Output valid JSON format ONLY.
                Structure:
                [
                    {{ "step": 1, "text": "...", "sound_effect": "...", "image_prompt": "..." }},
                    ...
                ]
            """),
            expected_output="A valid JSON array containing 10 objects, each with 'step', 'text', 'sound_effect', and 'image_prompt'.",
            context=[context_task],
            agent=agent
        )
