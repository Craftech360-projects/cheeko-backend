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
    st.title("🧸 Cheeko Content Factory")
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
            [ "Routine", "Learning","Story",  "Meditation","Song/Rhyme"]
        )
        
        eleven_model = st.selectbox(
            "Voice Model",
            ["eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_flash_v2"]
        )
        
        # Voice Map
        voices = {
            "Mimi (Child - Australian)": "zrHiDhphv9ZnVXBqCLjz",
            "Cheeko (Default - Kid Friendly)": "mHX7OoPk2G45VMAuinIt",
            "Gigi (Child - American)": "jBpfuIE2acCO8z3wKNLl",
            "Rachel": "21m00Tcm4TlvDq8ikWAM",
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
        esp32_mode = st.checkbox("Optimize for ESP32 Display (150x150 px, Pixel Art)", value=True)

        # History / Load Previous
        st.markdown("---")
        st.subheader("📂 History")
        output_root = "output"
        os.makedirs(output_root, exist_ok=True)
        previous_projects = [d for d in os.listdir(output_root) if os.path.isdir(os.path.join(output_root, d))]
        
        # Use a callback to handle history loading explicitly
        def on_history_change():
            current_selection = st.session_state.history_selector
            if current_selection != "(New Generation)":
                history_dir = os.path.join("output", current_selection)
                plan_path = os.path.join(history_dir, "plan.json")
                if os.path.exists(plan_path):
                    with open(plan_path, "r") as f:
                        st.session_state['raw_result'] = f.read()
                    # Update active topic
                    st.session_state['topic'] = current_selection.replace("_", " ")
                else:
                    st.toast("No plan.json found in this folder.", icon="⚠️")
            else:
                # Optional: Reset only if you want "New" to be blank? 
                # Or keep the last topic. Let's keep it safe and not auto-clear 
                # unless we want a fresh start.
                pass

        selected_history = st.selectbox(
            "Load Previous Project", 
            ["(New Generation)"] + previous_projects,
            key="history_selector",
            on_change=on_history_change
        )
    
    # Ensure topic is initialized
    if 'topic' not in st.session_state:
        st.session_state['topic'] = "Bedtime Routine"

    # ---------------- Main Content Area ----------------
    st.markdown("---")
    
    # Topic Input (bound to session state)
    topic = st.text_input("Topic", key="topic") # Direct binding to session_state['topic']
    
    col_gen, col_redo = st.columns(2)
    with col_gen:
        generate_btn = st.button("🚀 Generate New Plan")
    with col_redo:
        if 'raw_result' in st.session_state:
            redo_btn = st.button("🔄 Redo Plan")
        else:
            redo_btn = False

    # ---------------- Handle Plan Generation ----------------
    # ---------------- Handle Plan Generation ----------------
    # Initialize confirmation state
    if 'confirm_gen' not in st.session_state:
        st.session_state.confirm_gen = False
    
    # Trigger confirmation on button click
    if generate_btn:
        st.session_state.confirm_gen = True
        
    start_generation = False
    
    # Show Confirmation Dialog
    if st.session_state.confirm_gen:
        st.markdown("---")
        # Calc target dir
        target_dir_name = topic.replace(" ", "_").strip()
        if not target_dir_name: target_dir_name = "Untitled_Project"
        target_path = os.path.join("output", target_dir_name)
        
        st.write(f"**Target Folder:** `{target_path}`")
        
        if os.path.exists(target_path):
            # Check if it has content
            files = os.listdir(target_path)
            num_files = len(files)
            
            if num_files > 0:
                st.warning(f"⚠️ Folder **`{target_dir_name}`** already exists and contains `{num_files}` files!")
                st.write("Generating a new plan will replace the contents of this folder.")
                confirm_label = "✅ Yes, Overwrite & Generate"
            else:
                st.info(f"ℹ️ Folder **`{target_dir_name}`** exists but is empty.")
                confirm_label = "✅ Use Empty Folder & Generate"
        else:
            st.success(f"✨ Ready to create new project: **`{target_dir_name}`**")
            confirm_label = "✅ Create & Generate"
            
        c1, c2 = st.columns([1,2])
        if c1.button(confirm_label, key="confirm_btn"):
            st.session_state.confirm_gen = False
            start_generation = True
        if c2.button("❌ Cancel", key="cancel_btn"):
            st.session_state.confirm_gen = False
            st.rerun()

    # Redo skips confirmation (user already viewing it) or we can enable it. 
    # Let's say Redo is "Try again on same topic", so just run it.
    if redo_btn:
        start_generation = True

    if start_generation:
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
        # Use session state topic as source of truth for display
        display_topic = st.session_state.get('topic', 'Unknown Topic')
        st.subheader(f"📝 Plan Output: {display_topic}")
        
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
            # CRITICAL FIX: ALWAYS derive directory from current TOPIC. 
            # If we loaded history, 'topic' was updated to history name.
            # If user typed new topic, 'topic' is the new topic.
            # We NEVER rely on the dropdown value directly here, only the active topic variable.
            
            dir_name = display_topic.replace(" ", "_").strip()
            if not dir_name: dir_name = "Untitled_Project"
                
            output_dir = os.path.join("output", dir_name)
            os.makedirs(output_dir, exist_ok=True)
            
            # Auto-Save Plan
            with open(os.path.join(output_dir, "plan.json"), "w") as f:
                json.dump(content_data, f, indent=2)

            # Global Actions
            st.info(f"✅ Previewing {len(content_data)} steps. Output Folder: `{output_dir}`")
            
            # --- EDITABLE PLAN SECTION ---
            st.subheader("✏️ Edit Plan Before Generation")
            st.caption("You can edit the Text, Image Prompts, and Sound Effects below. Changes are auto-saved to plan.json.")
            
            # Use data_editor to allow editing
            edited_data = st.data_editor(
                content_data,
                column_config={
                    "step": st.column_config.NumberColumn("Step", width="small", disabled=True),
                    "text": st.column_config.TextColumn("Voice Script", width="large"),
                    "image_prompt": st.column_config.TextColumn("Image Prompt", width="large"),
                    "sound_effect": st.column_config.TextColumn("SFX Instructions", width="small"),
                },
                use_container_width=True, 
                num_rows="dynamic",
                key="plan_editor"
            )
            
            # Update content_data reference to the edited version
            content_data = edited_data
            
            # Auto-Save Plan (Overwriting the previous save with edited version)
            with open(os.path.join(output_dir, "plan.json"), "w") as f:
                json.dump(content_data, f, indent=2)

            if st.button("✨ Generate ALL Assets (Audio + Images)"):
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                for i, item in enumerate(content_data):
                    # Progress bar logic existing...
                    step = item.get('step')
                    text = item.get('text')
                    prompt = item.get('image_prompt')
                    sound_effect = item.get('sound_effect')  # Get sound effect description
                    
                    status_text.text(f"Processing Step {step}/{len(content_data)}...")
                    
                    # Generate Both (with sound effects)
                    generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings, sound_effect)
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
                sound_effect = item.get('sound_effect', '')  # Get sound effect, default to empty
                
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
                                    path = generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings, sound_effect)
                                    st.rerun()
                            else:
                                if st.button(f"🔊 Audio", key=f"aud_{step}"):
                                    path = generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings, sound_effect)
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

    # ---------------- Export to Cloud ----------------
    st.sidebar.markdown("---")
    st.sidebar.subheader("☁️ Cloud Upload")
    
    # Check for secrets
    api_secret = os.getenv("MANAGER_API_SECRET", "da11d988-f105-4e71-b095-da62ada82189")
    api_url = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy") # Use actual backend port/context

    # Determine default pack name from topic
    display_topic = st.session_state.get('topic', 'Unknown Topic')
    pack_name_input = st.sidebar.text_input("Content Pack Name", value=display_topic)

    if st.sidebar.button("📤 Upload to Cheeko Cloud"):
        # Determine output dir again
        dir_name = display_topic.replace(" ", "_").strip()
        if not dir_name: dir_name = "Untitled_Project"
        export_dir = os.path.join("output", dir_name)
        
        if not os.path.exists(export_dir):
            st.sidebar.error("Project folder not found!")
        else:
            with st.sidebar.status("Uploading content...", expanded=True) as status:
                st.write("🔌 Connecting to Manager API...")
                from exporters import ManagerAPIClient
                client = ManagerAPIClient(api_url, api_secret)
                
                # Map generic types to API types
                api_content_type = 'rfidcontent' # Default to new bucket
                
                if content_type in ["Song/Rhyme"]:
                    api_content_type = 'music'
                elif content_type in ["Story"]:
                    api_content_type = 'story'
                
                # Routine, Learning, Meditation -> 'rfidcontent'
                
                st.write(f"📂 Processing: {display_topic} (Type: {api_content_type})")
                pack_code = client.export_project(export_dir, display_topic, api_content_type, pack_name=pack_name_input)
                
                if pack_code:
                    status.update(label="✅ Upload Complete!", state="complete", expanded=True)
                    st.sidebar.success(f"Pack Created: **{pack_code}**")
                    st.sidebar.info("You can now assign this card in the Admin Panel.")
                else:
                    status.update(label="❌ Upload Failed", state="error")
                    st.sidebar.error("Check console logs for details.")

if __name__ == "__main__":
    init_clients()
    main()
