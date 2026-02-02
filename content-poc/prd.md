Content Generation POC (Python + CrewAI + Streamlit)
Goal Description
Create a standalone Python Proof-of-Concept (POC) with a Streamlit Dashboard to visualize and control the content generation process. This allows you to verify quality interactively without digging through folders.

Tech Stack
UI: streamlit (Simple web dashboard)
Orchestration: crewai
LLM: langchain_google_genai (Gemini Pro)
TTS: elevenlabs
Image: google-generative-ai (Gemini Image)
Workflow (Dashboard)
Input: User enters topic (e.g., "Bedtime Habit") in Streamlit sidebar.
Phase 1: Scripting (Visualized)
Show "Planner" output (Outline).
Show "Writer" output (Draft).
Show "Visualizer" output (Image Prompts).
Phase 2: Asset Production
Click "Generate Assets" button.
Audio: Play generated MP3s directly in the browser.
Images: Display generated PNGs next to the text steps.
Save: Button to "Approve & Save" (saves to output/ folder).
Architecture (d:\cheeko\cheeko-backend\content-poc\)
Files
requirements.txt: Added streamlit.
app.py: [NEW] Streamlit Dashboard entry point.
agents.py
: CrewAI Agent definitions.
tasks.py: CrewAI Task definitions.
generators.py: Asset generation logic.
utils.py: Helper functions.
Verification
Run streamlit run app.py.
Open browser (localhost:8501).
Enter topic -> Watch agents work -> Play audio/View images.

