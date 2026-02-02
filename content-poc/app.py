import streamlit as st
import os
import json
import re
import time
from dotenv import load_dotenv
from crewai import Crew, Process

from agents import ContentAgents
from tasks import ContentTasks
from generators import generate_audio, generate_image, init_clients

# Load env variables
load_dotenv()

st.set_page_config(page_title="Cheeko Content Factory", layout="wide")

def main():
    st.title("🧸 Cheeko Content Factory POC")
    st.markdown("Generate 10-step audio guides with Multi-Agent AI.")

    # ---------------- Sidebar Config ----------------
    with st.sidebar:
        st.header("Configuration")
        api_key_status = "✅ Set" if os.getenv("GEMINI_API_KEY") else "❌ Missing"
        st.write(f"Gemini API: {api_key_status}")
        
        eleven_status = "✅ Set" if os.getenv("ELEVENLABS_API_KEY") else "❌ Missing"
        st.write(f"ElevenLabs API: {eleven_status}")
        
        # Content Type Selector
        content_type = st.selectbox(
            "Content Type", 
            ["Story", "Routine", "Learning", "Song/Rhyme", "Meditation"]
        )
        
        eleven_model = st.selectbox(
            "Voice Model",
            ["eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_flash_v2"]
        )
        
        # Voice Map
        voices = {
            "Gigi (Child - American)": "jBpfuIE2acCO8z3wKNLl",
            "Mimi (Child - Australian)": "zrHiDhphv9ZnVXBqCLjz", 
            "Rachel (Default)": "21m00Tcm4TlvDq8ikWAM",
            "Nicole (Soft & Calm)": "piTKgcLEGmPE4e6mEKli",
            "Bella (Soft)": "EXAVITQu4vr4xnSDxMaL"
        }
        
        selected_voice_name = st.selectbox("Voice Character", list(voices.keys()), index=0)
        selected_voice_id = voices[selected_voice_name]
        
        with st.expander("🗣️ Audio Expression Settings"):
            stability = st.slider("Stability (Lower = More Expressive)", 0.0, 1.0, 0.5, 0.05)
            style = st.slider("Style Exaggeration", 0.0, 1.0, 0.5, 0.05)
            similarity = st.slider("Similarity Boost (Voice Cloning)", 0.0, 1.0, 0.8, 0.05)
            
            voice_settings = {
                "stability": stability,
                "similarity_boost": similarity,
                "style": style,
                "use_speaker_boost": True
            }

        # Display Mode Config
        st.markdown("### 🖥️ Display Settings")
        esp32_mode = st.checkbox("Optimize for ESP32 Display (150x150 px, Pixel Art)", value=False)

        # History / Load Previous
        st.markdown("---")
        st.subheader("📂 History")
        output_root = "output"
        os.makedirs(output_root, exist_ok=True)
        previous_projects = [d for d in os.listdir(output_root) if os.path.isdir(os.path.join(output_root, d))]
        
        selected_history = st.selectbox("Load Previous Project", ["(New Generation)"] + previous_projects)
    
    # ---------------- Load History Logic ----------------
    # We update the 'topic' variable based on history selection, or keep it manageable
    # We must ensure 'topic' is available for the rest of the script.
    
    # ---------------- Load History Logic ----------------
    if selected_history != "(New Generation)":
        history_dir = os.path.join(output_root, selected_history)
        plan_path = os.path.join(history_dir, "plan.json")
        
        # Load the plan into session state if it exists
        if os.path.exists(plan_path):
             with open(plan_path, "r") as f:
                st.session_state['raw_result'] = f.read()
             # Update session state topic to match history
             st.session_state['topic'] = selected_history.replace("_", " ")
        else:
            st.sidebar.error("No plan.json found in this folder.")
    
    # Ensure topic is initialized
    if 'topic' not in st.session_state:
        st.session_state['topic'] = "Bedtime Routine"

    # ---------------- Main Content Area ----------------
    st.markdown("---")
    
    # Topic Input (bound to session state)
    topic = st.text_input("Topic", value=st.session_state['topic'], key="topic_input")
    # Sync back to persistence (optional, but good for flows)
    st.session_state['topic'] = topic
    
    col_gen, col_redo = st.columns(2)
    with col_gen:
        generate_btn = st.button("🚀 Generate New Plan")
    with col_redo:
        if 'raw_result' in st.session_state:
            redo_btn = st.button("🔄 Redo Plan")
        else:
            redo_btn = False

    # ---------------- Handle Plan Generation ----------------
    if generate_btn or redo_btn:
        if not os.getenv("GEMINI_API_KEY"):
            st.error("Please set GEMINI_API_KEY in .env")
            return

        with st.spinner(f"🤖 Agents working on your {content_type}..."):
            # Init Agents & Tasks
            agents = ContentAgents()
            tasks = ContentTasks()

            planner = agents.planner_agent()
            writer = agents.writer_agent()
            visualizer = agents.visualizer_agent()

            # Determine Visual Style
            visual_style = "Pixel Art" if esp32_mode else "Watercolor"

            # Pass content_type to the plan task for variety
            plan_task = tasks.plan_task(planner, topic, content_type)
            write_task = tasks.write_task(writer, plan_task, content_type)
            # Pass visual style
            visualize_task = tasks.visualize_task(visualizer, write_task, visual_style)

            crew = Crew(
                agents=[planner, writer, visualizer],
                tasks=[plan_task, write_task, visualize_task],
                verbose=True,
                process=Process.sequential
            )

            result = crew.kickoff()
            st.session_state['raw_result'] = result
            # Rerun to refresh view immediately
            st.rerun()

    # ---------------- Display Results & Asset Gen ----------------
    if 'raw_result' in st.session_state:
        st.subheader(f"📝 Plan Output: {topic}")
        
        content_data = None
        raw_text = st.session_state['raw_result']
        
        # Parsing Logic
        if hasattr(raw_text, 'raw'): raw_text = raw_text.raw  # CrewAI output object
        
        json_match = re.search(r'\[.*\]', str(raw_text), re.DOTALL)
        if json_match:
            try:
                content_data = json.loads(json_match.group(0))
            except json.JSONDecodeError:
                st.warning("JSON Parse Error. Showing raw text.")
                st.text(raw_text)
        else:
            try:
                 content_data = json.loads(str(raw_text))
            except:
                 st.text(raw_text)

        if content_data:
            # Setup Output Directory
            # If we're viewing a history item, use that exact folder name
            # Otherwise, use the topic from the text input
            if selected_history != "(New Generation)":
                dir_name = selected_history  # Use exact history folder name
            else:
                dir_name = topic.replace(" ", "_").strip()
                if not dir_name: dir_name = "Untitled_Project"
                
            output_dir = os.path.join("output", dir_name)
            os.makedirs(output_dir, exist_ok=True)
            
            # Auto-Save Plan
            with open(os.path.join(output_dir, "plan.json"), "w") as f:
                json.dump(content_data, f, indent=2)

            # Global Actions
            st.info(f"✅ Previewing {len(content_data)} steps. Output Folder: `{output_dir}`")
            
            if st.button("✨ Generate ALL Assets (Audio + Images)"):
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                for i, item in enumerate(content_data):
                    step = item.get('step')
                    text = item.get('text')
                    prompt = item.get('image_prompt')
                    
                    status_text.text(f"Processing Step {step}/{len(content_data)}...")
                    
                    # Generate Both
                    generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings)
                    generate_image(prompt, step, output_dir, esp32_mode)
                    
                    progress_bar.progress((i + 1) / len(content_data))
                
                status_text.success("🎉 All assets generated!")
                st.success("Assets Saved. Refreshing view...")
                time.sleep(1)
                st.rerun() # Refresh to show the new files
            
            st.markdown("---")

            # Display Table of Steps
            for item in content_data:
                step = item.get('step')
                text = item.get('text')
                prompt = item.get('image_prompt')
                
                # Check for existing generated files
                audio_file = os.path.join(output_dir, f"step_{step}_audio.mp3")
                
                # Check for pixel or normal image based on current mode preference, OR fallback to whatever exists
                img_suffix = "_pixel" if esp32_mode else ""
                
                # Priority search list
                possible_images = [
                    f"step_{step}_image{img_suffix}.jpg", # Exact match for current mode (jpg)
                    f"step_{step}_image{img_suffix}.png", # Exact match for current mode (png)
                    f"step_{step}_image_pixel.jpg",       # Pixel fallback
                    f"step_{step}_image_pixel.png",
                    f"step_{step}_image.jpg",             # Standard fallback
                    f"step_{step}_image.png"
                ]
                
                found_image = None
                for img_name in possible_images:
                    p = os.path.join(output_dir, img_name)
                    if os.path.exists(p):
                        found_image = p
                        break
                
                with st.expander(f"Step {step}: {text[:60]}...", expanded=True):
                    col1, col2 = st.columns([2, 1])
                    with col1:
                        st.markdown(f"**Text:**\n{text}")
                        st.caption(f"**Visual Prompt:** {prompt}")
                    
                    with col2:
                        c1, c2 = st.columns(2)
                        with c1:
                            if os.path.exists(audio_file):
                                st.audio(audio_file)
                                if st.button("🔄 Regen Audio", key=f"aud_{step}"):
                                    path = generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings)
                                    st.rerun()
                            else:
                                if st.button(f"🔊 Audio", key=f"aud_{step}"):
                                    path = generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings)
                                    if path: st.rerun()
                        with c2:
                            if found_image:
                                st.image(found_image)
                                if st.button("🔄 Regen Image", key=f"img_{step}"):
                                    with st.spinner("Drawing..."):
                                        img_path = generate_image(prompt, step, output_dir, esp32_mode)
                                        st.rerun()
                            else:
                                if st.button(f"🖼️ Image", key=f"img_{step}"):
                                    with st.spinner("Drawing..."):
                                        img_path = generate_image(prompt, step, output_dir, esp32_mode)
                                        if img_path: 
                                            st.rerun()
                                        else:
                                            st.error("Failed")

if __name__ == "__main__":
    init_clients()
    main()
