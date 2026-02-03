# 🧸 Cheeko Content Factory (POC)

**Version:** 1.0.0  
**Stack:** Python (Streamlit), CrewAI, ElevenLabs, Google Gemini, Node.js Integration

## 📋 Overview
The **Cheeko Content Factory** is an internal tool designed to automate the creation of rich, interactive content for the Cheeko educational device. It uses a **Multi-Agent AI System** to generate coherent stories, educational routines, and songs, and then automatically produces production-ready assets (audio & images).

Finally, it integrates directly with the **Cheeko Manager API** to upload these assets to the cloud (S3) and register them as "Content Packs" for RFID cards.

---

## ✨ Key Features

### 1. Multi-Agent Generation (CrewAI)
We use three specialized AI agents working in sequence:
*   **Planner Agent**: Research and structures the content (e.g., breaks a "Bedtime Routine" into 6 distinct steps).
*   **Writer Agent**: Writes kid-friendly scripts for each step, including stage directions for sound effects.
*   **Visualizer Agent**: Generates precise image prompts (Pixel Art or Watercolor style) for each step.

### 2. Asset Generation Pipeline
*   **Audio**: Uses **ElevenLabs** for high-quality Text-to-Speech.
    *   *Features*: Voice cloning resilience, custom stability settings, and automatic SFX mixing (e.g., adding "rain sounds" behind the voice).
*   **Images**: Uses **Google Gemini (Imagen 3)** to generate visuals.
    *   *Hardware Modes*: Supports "ESP32 Mode" (Pixel Art, 240x240) vs "High Res" (Watercolor).

### 3. Cloud Integration (Exporters)
*   Connects to the `manager-api-node` backend.
*   Authenticates via a Service Secret (Headless Admin).
*   Uploads assets to specific S3 folders (`music/`, `stories/`, `rfidcontent/`) based on content type.
*   Creates a `Content Pack` entry in the Postgres database automatically.

---

## 🏗️ Architecture

| File | Purpose |
| :--- | :--- |
| `app.py` | **Entry Point**. Streamlit UI, Session State management, and main workflow logic. |
| `agents.py` | Defines the CrewAI Agents (Planner, Writer, Visualizer) and LLM config. |
| `tasks.py` | Defines the specific Tasks assigned to agents (includes prompt engineering). |
| `generators.py` | Wrapper functions for ElevenLabs API (TTS+SFX) and Gemini API (Image Gen). |
| `exporters.py` | **Backend Client**. Handles HTTP requests to the Node.js API (Upload & Create Pack). |
| `requirements.txt` | Python dependencies. |

---

## 🚀 Setup & Installation

### Prerequisites
*   Python 3.10 or higher.
*   FFmpeg installed (required by `pydub` for audio mixing).
*   Running instance of `manager-api-node` (for uploads).

### 1. Install Dependencies
```bash
cd content-poc
python -m venv venv
# Windows
.\venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Environment Variables (.env)
Create a `.env` file in the `content-poc` folder:

```ini
# AI Services
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key

# Backend Integration
MANAGER_API_URL=http://localhost:8002/toy
MANAGER_API_SECRET=da11d988-f105-4e71-b095-da62ada82189
```

### 3. Run the App
```bash
streamlit run app.py
```
Access the UI at `http://localhost:8501`.

---

## 📖 Usage Guide

### Step 1: Generate Content Plan
1.  Enter a **Topic** (e.g., "Potty Training", "Learn to Count").
2.  Select **Content Type** (Routine, Story, Song, etc.).
3.  Click **"Generate New Plan"**.
4.  The agents will produce a step-by-step breakdown (Text + Image Prompts).

### Step 2: Generate Assets
1.  Review the generated plan.
2.  Click **"🔊 Generate All Audio"** to create TTS files for every step.
3.  Click **"🖼️ Draw All Images"** to generate visuals.
4.  Use the individual "Regen" buttons to fix specific steps if needed.

### Step 3: Upload to Cloud
1.  Expand the sidebar.
2.  (Optional) Rename your pack in the **"Content Pack Name"** field.
3.  Click **"📤 Upload to Cheeko Cloud"**.
4.  The system will:
    *   Upload files to AWS S3.
    *   Register the pack in the database.
    *   Return a **Pack Code** (e.g., `GEN_POTTY_8821`).
    *   *Note: Routines/Learning go to `rfidcontent/` folder, Stories to `stories/`, Songs to `music/`.*

---

## 🛠️ Developer Notes

### Adding New Content Types
If you add a new type in `app.py` (sidebar), ensure you map it correctly in `app.py` before calling `export_project`.
*   **Music**: Maps to S3 `music/`, DB `music`.
*   **Story**: Maps to S3 `stories/`, DB `story`.
*   **Other**: Maps to S3 `rfidcontent/`, DB `rfidcontent`.

### Troubleshooting
*   **400 Bad Request**: Typically means the Content Type mapping is wrong or the Backend API rejects the type.
*   **ffmpeg not found**: Ensure `ffmpeg` is in your system PATH.
