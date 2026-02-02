from crewai import Task
from textwrap import dedent

class ContentTasks:
    def plan_task(self, agent, topic, content_type="Story"):
        style_instruction = ""
        if content_type == "Routine":
            style_instruction = "Focus on a clear, step-by-step logical sequence. It should feel like a helpful guide, not just a story."
        elif content_type == "Song/Rhyme":
            style_instruction = "Focus on rhythm and rhyme scheme. Ensure the steps flow like verses."
        elif content_type == "Learning":
            style_instruction = "Focus on facts and discovery. Each step should be a small 'did you know' or observation."
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
        # Distinct writing style based on type
        if content_type == "Routine":
            tone = "Encouraging, clear, and direct. Use phrases like 'Let's try...' or 'Now we...'. slightly rhythmic but NOT rhyming poems. Conversational."
        elif content_type == "Song/Rhyme":
            tone = "Lyrical, rhyming (AABB or ABCB), and very rhythmic. It should be sung or chanted."
        elif content_type == "Learning":
            tone = "Curious, excited, and educational. Ask questions and give answers."
        elif content_type == "Meditation":
            tone = "Very slow, sensory, varying breath focus. Whisper-soft."
        else:
            tone = "Narrative, descriptive, and dreamy. Typical storybook language."

        return Task(
            description=dedent(f"""
                Using the plan provided, write the ACTUAL script for the 10 steps.
                Content Type: {content_type}
                Target Tone: {tone}
                
                - Total steps: 10.
                - Keep each step short (1-2 sentences).
                - Ensure the language fits the Target Tone perfectly.
            """),
            expected_output="A step-by-step script (Step 1 to Step 10) with the exact text to be spoken.",
            context=[context_task],
            agent=agent
        )

    def visualize_task(self, agent, context_task, visual_style="Watercolor"):
        if visual_style == "Pixel Art":
            style_desc = "Retro 8-bit pixel art, simple shapes, vibrant but limited color palette, clear subjects, cartoon style. suitable for small low-res displays."
        else:
            style_desc = "Soft watercolor, minimal, storybook style, warm pastel colors."

        return Task(
            description=dedent(f"""
                Based on the script, create an Image Generation Prompt for EACH of the 10 steps.
                - Style Constraint: "{style_desc}".
                - The prompt should describe the visual scene matching the step.
                
                IMPORTANT: Output valid JSON format ONLY.
                Structure:
                [
                    {{ "step": 1, "text": "...", "image_prompt": "..." }},
                    ...
                ]
            """),
            expected_output="A valid JSON array containing 10 objects, each with 'step', 'text' (from the script), and 'image_prompt'.",
            context=[context_task],
            agent=agent
        )
