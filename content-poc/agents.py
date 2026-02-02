from crewai import Agent
import os

# Disable CrewAI Telemetry to avoid thread signal issues in Streamlit
os.environ["CREWAI_TELEMETRY_OPT_OUT"] = "true"

# Set the API key for LiteLLM
os.environ["GEMINI_API_KEY"] = os.getenv("GEMINI_API_KEY", "")
# Using Gemini 2.5 Flash as requested (available since mid-2025)
MODEL_NAME = 'gemini/gemini-2.5-flash'

class ContentAgents:
    def planner_agent(self):
        return Agent(
            role='Content Planner',
            goal='Plan engaging, calm, and child-friendly content scripts',
            backstory='You are an expert in child psychology and storytelling. You know how to pace a story to help children relax.',
            verbose=True,
            allow_delegation=False,
            llm=MODEL_NAME
        )

    def writer_agent(self):
        return Agent(
            role='Script Writer',
            goal='Write the actual spoken words for a 10-step audio guide',
            backstory='You are a gentle storyteller. You write simple, rhythmic, and soothing sentences perfect for a slow TTS voice.',
            verbose=True,
            allow_delegation=False,
            llm=MODEL_NAME
        )

    def visualizer_agent(self):
        return Agent(
            role='Visual Prompt Engineer',
            goal='Create consistent, beautiful image generation prompts for each step',
            backstory='You represent the "Art Director". You ensure every image prompt has a consistent style (e.g., "Software watercolor, storybook style") and matches the script step.',
            verbose=True,
            allow_delegation=False,
            llm=MODEL_NAME
        )
