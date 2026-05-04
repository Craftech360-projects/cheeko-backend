import streamlit as st
import os
import json
import re
import time
from dotenv import load_dotenv
from crewai import Crew, Process

from agents import ContentAgents
from tasks import ContentTasks
from generators import generate_audio, generate_audio_fish, generate_image, init_clients
from categories import CATEGORIES, get_category_names, get_card_categories, get_general_categories

# Load env variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

def sanitize_dirname(name, max_len=80):
    """Create a safe, short Windows folder name."""
    safe = re.sub(r'[<>:"/\\|?*]', '', str(name)).replace(" ", "_").strip(" ._")
    safe = re.sub(r"_+", "_", safe)
    if not safe:
        return "Untitled_Project"
    return safe[:max_len]

st.set_page_config(page_title="Cheeko Content Factory", layout="wide")

# Fox reference image path
FOX_REF_PATH = os.path.join(os.path.dirname(__file__), "assets", "fox_reference.png")

# ---- Custom CSS ----
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700&family=Comic+Neue:wght@300;400;700&display=swap');

/* Global font */
html, body, [class*="css"] {
    font-family: 'Comic Neue', cursive, sans-serif;
}
h1, h2, h3, h4 {
    font-family: 'Baloo 2', cursive, sans-serif !important;
}

/* Category card grid */
.category-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin: 10px 0;
}
.category-card {
    border: 2px solid #E2E8F0;
    border-radius: 12px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
    background: white;
}
.category-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.category-card.selected {
    border-width: 3px;
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}
.category-card h4 {
    margin: 0 0 4px 0;
    font-size: 14px;
}
.category-card p {
    margin: 0;
    font-size: 11px;
    color: #64748B;
}
.category-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    color: white;
    margin-top: 6px;
}

/* Step cards */
.step-card {
    background: white;
    border-radius: 12px;
    border: 1px solid #E2E8F0;
    padding: 16px;
    margin-bottom: 12px;
}

/* Fox preview */
.fox-preview {
    border: 2px dashed #C7D2FE;
    border-radius: 12px;
    padding: 8px;
    text-align: center;
    background: #F5F3FF;
}
</style>
""", unsafe_allow_html=True)


def render_category_info(category_name):
    """Show selected category details."""
    cat = CATEGORIES.get(category_name)
    if not cat:
        return
    col1, col2 = st.columns([3, 1])
    with col1:
        st.markdown(f"**{cat['cognitive_goal']}**")
        st.caption(cat['description'])
    with col2:
        st.metric("Steps", cat['step_count'])


def main():
    st.title("Cheeko Content Factory")
    st.markdown("Generate audio stories & guides with AI - featuring Cheeko the Fox!")

    # ---- Sidebar ----
    with st.sidebar:
        st.header("Settings")

        # API status
        api_ok = os.getenv("GEMINI_API_KEY")
        eleven_ok = os.getenv("ELEVENLABS_API_KEY")
        col_a, col_b = st.columns(2)
        with col_a:
            st.write(f"Gemini: {'Set' if api_ok else 'Missing'}")
        with col_b:
            st.write(f"ElevenLabs: {'Set' if eleven_ok else 'Missing'}")

        st.markdown("---")

        # Fox Preview
        st.subheader("Cheeko the Fox")
        if os.path.exists(FOX_REF_PATH):
            st.image(FOX_REF_PATH, width='stretch')
            st.caption("Reference character for all images")
        else:
            st.markdown('<div class="fox-preview">No fox image yet.<br>Add <code>assets/fox_reference.png</code></div>', unsafe_allow_html=True)

        st.markdown("---")

        # Voice Settings
        st.subheader("Voice")
        tts_provider = st.selectbox(
            "TTS Provider",
            ["Fish Audio", "ElevenLabs"],
            help="Fish Audio: cheaper, supports (emotion) tags. ElevenLabs: [emotion] tags on v3."
        )

        if tts_provider == "Fish Audio":
            fish_ok = os.getenv("FISH_AUDIO_API_KEY")
            st.write(f"Fish Audio: {'Set' if fish_ok else 'Missing API Key'}")

            fish_voices = {
                "Paula (Professional Female)": "c2623f0c075b4492ac367989aee1576f",
            }
            selected_fish_voice_name = st.selectbox("Fish Voice", list(fish_voices.keys()), index=0)
            selected_fish_voice_id = fish_voices[selected_fish_voice_name]

            # Placeholders for ElevenLabs vars (not used but needed by code)
            eleven_model = None
            selected_voice_id = None
            voice_settings = None
        else:
            eleven_model = st.selectbox(
                "Voice Model",
                ["eleven_v3", "eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_flash_v2"],
                help="v3 supports emotion tags like [whispers], [excited], [laughs]. v2 models use SSML breaks."
            )

            voices = {
                "Mimi (Child - Australian)": "zrHiDhphv9ZnVXBqCLjz",
                "Cheeko (Default - Kid Friendly)": "mHX7OoPk2G45VMAuinIt",
                "Gigi (Child - American)": "jBpfuIE2acCO8z3wKNLl",
                "Rachel": "21m00Tcm4TlvDq8ikWAM",
                "Nicole (Soft & Calm)": "piTKgcLEGmPE4e6mEKli",
                "Bella (Soft)": "EXAVITQu4vr4xnSDxMaL",
                "Suhana Very Young & Joyful Narrator":"9vP6R7VVxNwGIGLnpl17"


            }
            selected_voice_name = st.selectbox("Voice Character", list(voices.keys()), index=0)
            selected_voice_id = voices[selected_voice_name]
            selected_fish_voice_id = None

            with st.expander("Expression Settings"):
                stability = st.slider("Stability", 0.0, 1.0, 0.5, 0.05)
                style = st.slider("Style Exaggeration", 0.0, 1.0, 0.5, 0.05)
                similarity = st.slider("Similarity Boost", 0.0, 1.0, 0.8, 0.05)
                voice_settings = {
                    "stability": stability,
                    "similarity_boost": similarity,
                    "style": style,
                    "use_speaker_boost": True
                }

        st.markdown("---")

        # Display Settings
        st.subheader("Display")
        esp32_mode = st.checkbox("ESP32 Mode (240x296 px, Pixel Art + .bin)", value=True)

        st.markdown("---")

        # History
        st.subheader("History")
        output_root = "output"
        os.makedirs(output_root, exist_ok=True)
        previous_projects = [d for d in os.listdir(output_root) if os.path.isdir(os.path.join(output_root, d))]

        def on_history_change():
            current_selection = st.session_state.history_selector
            if current_selection != "(New Generation)":
                history_dir = os.path.join("output", current_selection)
                plan_path = os.path.join(history_dir, "plan.json")
                if os.path.exists(plan_path):
                    with open(plan_path, "r") as f:
                        st.session_state['raw_result'] = f.read()
                    st.session_state['topic'] = current_selection.replace("_", " ")
                else:
                    st.toast("No plan.json found in this folder.")

        selected_history = st.selectbox(
            "Load Previous Project",
            ["(New Generation)"] + previous_projects,
            key="history_selector",
            on_change=on_history_change
        )

        if selected_history != "(New Generation)":
            if st.button(f"Delete '{selected_history}'", type="primary"):
                import shutil
                del_path = os.path.join("output", selected_history)
                try:
                    shutil.rmtree(del_path)
                    st.toast(f"Deleted {selected_history}")
                    if 'raw_result' in st.session_state:
                        del st.session_state['raw_result']
                    time.sleep(0.5)
                    st.rerun()
                except Exception as e:
                    st.error(f"Error deleting: {e}")

    # ---- Main Content ----
    st.markdown("---")

    # Category Selector - Visual Cards
    st.subheader("Select Category")

    # Card categories row
    card_cats = get_card_categories()
    general_cats = get_general_categories()
    all_cats = card_cats + general_cats

    # Initialize category in session state
    if 'selected_category' not in st.session_state:
        st.session_state['selected_category'] = "Story Cards"

    # Card Categories
    st.markdown("**Card Categories**")
    cols = st.columns(len(card_cats))
    for i, cat_name in enumerate(card_cats):
        cat = CATEGORIES[cat_name]
        with cols[i]:
            is_selected = st.session_state['selected_category'] == cat_name
            btn_type = "primary" if is_selected else "secondary"
            if st.button(
                cat_name,
                key=f"cat_{cat_name}",
                type=btn_type,
                width='stretch'
            ):
                st.session_state['selected_category'] = cat_name
                st.rerun()

    # General Types
    st.markdown("**General Types**")
    cols2 = st.columns(len(general_cats))
    for i, cat_name in enumerate(general_cats):
        cat = CATEGORIES[cat_name]
        with cols2[i]:
            is_selected = st.session_state['selected_category'] == cat_name
            btn_type = "primary" if is_selected else "secondary"
            if st.button(
                cat_name,
                key=f"cat_{cat_name}",
                type=btn_type,
                width='stretch'
            ):
                st.session_state['selected_category'] = cat_name
                st.rerun()

    # Show selected category info
    content_type = st.session_state['selected_category']
    render_category_info(content_type)

    st.markdown("---")

    # Topic Input
    if 'topic' not in st.session_state:
        st.session_state['topic'] = "Bedtime Routine"

    topic = st.text_input("Topic", key="topic")

    col_gen, col_redo = st.columns(2)
    with col_gen:
        generate_btn = st.button("Generate New Plan", type="primary")
    with col_redo:
        if 'raw_result' in st.session_state:
            redo_btn = st.button("Redo Plan")
        else:
            redo_btn = False

    # ---- Handle Plan Generation ----
    if 'confirm_gen' not in st.session_state:
        st.session_state.confirm_gen = False

    if generate_btn:
        st.session_state.confirm_gen = True

    start_generation = False

    if st.session_state.confirm_gen:
        st.markdown("---")
        target_dir_name = sanitize_dirname(topic)
        if not target_dir_name:
            target_dir_name = "Untitled_Project"
        target_path = os.path.join("output", target_dir_name)

        st.write(f"**Target Folder:** `{target_path}`")

        if os.path.exists(target_path):
            files = os.listdir(target_path)
            num_files = len(files)
            if num_files > 0:
                st.warning(f"Folder **`{target_dir_name}`** already exists with `{num_files}` files. Will overwrite.")
                confirm_label = "Yes, Overwrite & Generate"
            else:
                st.info(f"Folder **`{target_dir_name}`** exists but is empty.")
                confirm_label = "Use Empty Folder & Generate"
        else:
            st.success(f"Ready to create new project: **`{target_dir_name}`**")
            confirm_label = "Create & Generate"

        c1, c2 = st.columns([1, 2])
        if c1.button(confirm_label, key="confirm_btn"):
            st.session_state.confirm_gen = False
            start_generation = True
        if c2.button("Cancel", key="cancel_btn"):
            st.session_state.confirm_gen = False
            st.rerun()

    if redo_btn:
        start_generation = True

    if start_generation:
        if not os.getenv("GEMINI_API_KEY"):
            st.error("Please set GEMINI_API_KEY in .env")
            return

        cat = CATEGORIES.get(content_type, CATEGORIES["Story Cards"])

        with st.spinner(f"Agents working on your {content_type}: {topic}..."):
            agents = ContentAgents()
            tasks = ContentTasks()

            planner = agents.planner_agent()
            writer = agents.writer_agent()
            visualizer = agents.visualizer_agent()

            visual_style = "Pixel Art" if esp32_mode else "Watercolor"

            plan_task = tasks.plan_task(planner, topic, content_type)
            write_task = tasks.write_task(writer, plan_task, content_type)
            visualize_task = tasks.visualize_task(visualizer, write_task, visual_style, content_type)

            crew = Crew(
                agents=[planner, writer, visualizer],
                tasks=[plan_task, write_task, visualize_task],
                verbose=True,
                process=Process.sequential
            )

            result = crew.kickoff()
            st.session_state['raw_result'] = result
            st.rerun()

    # ---- Display Results & Asset Gen ----
    if 'raw_result' in st.session_state:
        display_topic = st.session_state.get('topic', 'Unknown Topic')
        st.subheader(f"Plan: {display_topic}")

        content_data = None
        raw_text = st.session_state['raw_result']

        if hasattr(raw_text, 'raw'):
            raw_text = raw_text.raw

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
            except Exception:
                st.text(raw_text)

        if content_data:
            dir_name = sanitize_dirname(display_topic)
            if not dir_name:
                dir_name = "Untitled_Project"

            output_dir = os.path.join("output", dir_name)
            os.makedirs(output_dir, exist_ok=True)

            # Auto-Save Plan
            with open(os.path.join(output_dir, "plan.json"), "w") as f:
                json.dump(content_data, f, indent=2)

            st.info(f"Previewing {len(content_data)} steps. Output: `{output_dir}`")

            # Editable Plan
            st.subheader("Edit Plan Before Generation")
            st.caption("Edit the script, image prompts, and sound effects below. Click 'Save Edits' when done.")

            # Store edits in session state
            if 'edited_plan' not in st.session_state:
                st.session_state['edited_plan'] = content_data

            # Reset edited plan if content_data changed (new generation)
            if len(st.session_state['edited_plan']) != len(content_data):
                st.session_state['edited_plan'] = content_data

            for idx, item in enumerate(content_data):
                step = item.get('step', idx + 1)
                with st.expander(f"Step {step}", expanded=False):
                    new_text = st.text_area(
                        "Voice Script",
                        value=item.get('text', ''),
                        height=80,
                        key=f"edit_text_{step}"
                    )
                    new_prompt = st.text_area(
                        "Image Prompt",
                        value=item.get('image_prompt', ''),
                        height=80,
                        key=f"edit_prompt_{step}"
                    )
                    new_sfx = st.text_input(
                        "Sound Effect",
                        value=item.get('sound_effect', ''),
                        key=f"edit_sfx_{step}"
                    )
                    # Update in-memory
                    content_data[idx]['text'] = new_text
                    content_data[idx]['image_prompt'] = new_prompt
                    content_data[idx]['sound_effect'] = new_sfx

            if st.button("Save Edits", type="primary"):
                with open(os.path.join(output_dir, "plan.json"), "w") as f:
                    json.dump(content_data, f, indent=2)
                st.session_state['edited_plan'] = content_data
                st.toast("Plan saved!")

            # Always keep plan.json in sync
            with open(os.path.join(output_dir, "plan.json"), "w") as f:
                json.dump(content_data, f, indent=2)

            # Asset generation buttons
            btn_col1, btn_col2, btn_col3 = st.columns(3)
            with btn_col1:
                gen_all_btn = st.button("Generate ALL Assets", type="primary")
            with btn_col2:
                gen_images_btn = st.button("Generate Images Only")
            with btn_col3:
                gen_audio_btn = st.button("Generate Audio Only")

            if gen_all_btn or gen_images_btn or gen_audio_btn:
                progress_bar = st.progress(0)
                status_text = st.empty()

                fox_ref = FOX_REF_PATH if os.path.exists(FOX_REF_PATH) else None

                for i, item in enumerate(content_data):
                    step = item.get('step')
                    text = item.get('text')
                    prompt = item.get('image_prompt')
                    sound_effect = item.get('sound_effect')

                    status_text.text(f"Processing Step {step}/{len(content_data)}...")

                    if gen_all_btn or gen_audio_btn:
                        if tts_provider == "Fish Audio":
                            generate_audio_fish(text, step, output_dir, selected_fish_voice_id)
                        else:
                            generate_audio(text, step, output_dir, eleven_model, selected_voice_id, voice_settings, sound_effect)
                    if gen_all_btn or gen_images_btn:
                        generate_image(prompt, step, output_dir, esp32_mode, fox_reference_path=fox_ref)

                    progress_bar.progress((i + 1) / len(content_data))

                label = "All assets" if gen_all_btn else ("Images" if gen_images_btn else "Audio")
                status_text.success(f"{label} generated!")
                st.success("Assets saved. Refreshing...")
                time.sleep(1)
                st.rerun()

            st.markdown("---")

            # Display Steps
            fox_ref = FOX_REF_PATH if os.path.exists(FOX_REF_PATH) else None

            for item in content_data:
                step = item.get('step')
                text = item.get('text')
                prompt = item.get('image_prompt')
                sound_effect = item.get('sound_effect', '')

                audio_file = os.path.join(output_dir, f"step_{step}_audio.mp3")

                img_suffix = "_pixel" if esp32_mode else ""
                possible_images = [
                    f"step_{step}_image{img_suffix}.png",
                    f"step_{step}_image{img_suffix}.jpg",
                    f"step_{step}_image_pixel.png",
                    f"step_{step}_image_pixel.jpg",
                    f"step_{step}_image.png",
                    f"step_{step}_image.jpg"
                ]

                found_image = None
                for img_name in possible_images:
                    p = os.path.join(output_dir, img_name)
                    if os.path.exists(p):
                        found_image = p
                        break

                with st.expander(f"Step {step}: {text[:60]}..." if text and len(text) > 60 else f"Step {step}: {text}", expanded=True):
                    col1, col2 = st.columns([2, 1])
                    with col1:
                        st.markdown(f"**Script:**\n{text}")
                        if prompt:
                            st.caption(f"**Image Prompt:** {prompt}")
                        if sound_effect:
                            st.caption(f"**SFX:** {sound_effect}")

                    with col2:
                        # Audio
                        def _gen_audio_step(t, s, d):
                            if tts_provider == "Fish Audio":
                                return generate_audio_fish(t, s, d, selected_fish_voice_id)
                            else:
                                return generate_audio(t, s, d, eleven_model, selected_voice_id, voice_settings, sound_effect)

                        if os.path.exists(audio_file):
                            st.audio(audio_file)
                            if st.button("Regen Audio", key=f"aud_{step}"):
                                _gen_audio_step(text, step, output_dir)
                                st.rerun()
                        else:
                            if st.button(f"Generate Audio", key=f"aud_{step}"):
                                path = _gen_audio_step(text, step, output_dir)
                                if path:
                                    st.rerun()

                        # Image
                        if found_image:
                            st.image(found_image)
                            if st.button("Regen Image", key=f"img_{step}"):
                                with st.spinner("Drawing..."):
                                    generate_image(prompt, step, output_dir, esp32_mode, fox_reference_path=fox_ref)
                                    st.rerun()
                        else:
                            if st.button(f"Generate Image", key=f"img_{step}"):
                                with st.spinner("Drawing..."):
                                    img_path = generate_image(prompt, step, output_dir, esp32_mode, fox_reference_path=fox_ref)
                                    if img_path:
                                        st.rerun()
                                    else:
                                        st.error("Failed to generate image")

    # ---- Export to Cloud ----
    st.sidebar.markdown("---")
    st.sidebar.subheader("Cloud Upload")

    api_secret = os.getenv("MANAGER_API_SECRET", "da11d988-f105-4e71-b095-da62ada82189")
    api_url = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy")

    display_topic = st.session_state.get('topic', 'Unknown Topic')
    pack_name_input = st.sidebar.text_input("Content Pack Name", value=display_topic)

    if st.sidebar.button("Upload to Cheeko Cloud"):
        dir_name = sanitize_dirname(display_topic)
        if not dir_name:
            dir_name = "Untitled_Project"
        export_dir = os.path.join("output", dir_name)

        if not os.path.exists(export_dir):
            st.sidebar.error("Project folder not found!")
        else:
            with st.sidebar.status("Uploading content...", expanded=True) as status:
                st.write("Connecting to Manager API...")
                from exporters import ManagerAPIClient
                client = ManagerAPIClient(api_url, api_secret)

                api_content_type = 'rfidcontent'
                if content_type in ["Song/Rhyme"]:
                    api_content_type = 'music'
                elif content_type in ["Story Cards", "Granny Stories"]:
                    api_content_type = 'story'

                st.write(f"Processing: {display_topic} (Type: {api_content_type})")
                pack_code = client.export_project(export_dir, display_topic, api_content_type, pack_name=pack_name_input)

                if pack_code:
                    status.update(label="Upload Complete!", state="complete", expanded=True)
                    st.sidebar.success(f"Pack Created: **{pack_code}**")
                    st.sidebar.info("You can now assign this card in the Admin Panel.")
                else:
                    status.update(label="Upload Failed", state="error")
                    st.sidebar.error("Check console logs for details.")


if __name__ == "__main__":
    init_clients()
    main()
