# Storyteller Agent - System Flow Diagram

## Overview
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        STORYTELLER SYSTEM (with RAG)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────┐                    ┌──────────────────────┐         │
│   │  PDF STORIES     │  ──────────────▶   │   SQLite DATABASE    │         │
│   │  (stories/*.pdf) │   upload_to_db.py  │   (stories.db)       │         │
│   └──────────────────┘         │          └──────────────────────┘         │
│                                │                     │                      │
│                                ▼                     │                      │
│                       ┌──────────────────┐           │                      │
│                       │   ChromaDB       │           │                      │
│                       │   (Vector DB)    │           │                      │
│                       │   for RAG        │           │                      │
│                       └──────────────────┘           │                      │
│                                │                     │                      │
│                                └─────────┬───────────┘                      │
│                                          ▼                                  │
│                               ┌──────────────────────┐                      │
│   ┌──────────────────┐        │   LIVEKIT AGENT      │                      │
│   │  CHILD (User)    │◀══════▶│   (main.py)          │                      │
│   │  via LiveKit     │ Voice  │   + Ultravox LLM     │                      │
│   └──────────────────┘        └──────────────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PART 1: PDF Upload Flow (upload_to_db.py)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PDF UPLOAD PROCESS                                  │
│                         python upload_to_db.py                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. SCAN STORIES FOLDER                                                     │
│     └── stories/*.pdf                                                       │
│         ├── "Rama and the Celestial Laughter Flower.pdf"                    │
│         └── "The Prince and the Star-Scepter.pdf"                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. FOR EACH PDF FILE                                                       │
│     ┌───────────────────────────────────────────────────────────────────┐   │
│     │  Check MD5 hash - skip if unchanged                               │   │
│     └───────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. PAGE-BY-PAGE EXTRACTION                                                 │
│     ┌───────────────────────────────────────────────────────────────────┐   │
│     │  FOR EACH PAGE:                                                   │   │
│     │                                                                   │   │
│     │  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐       │   │
│     │  │  PDF PAGE   │ ───▶ │   IMAGE     │ ───▶ │  GEMINI     │       │   │
│     │  │             │      │  (PyMuPDF)  │      │  VISION OCR │       │   │
│     │  │             │      │  2x zoom    │      │  (2.5-flash)│       │   │
│     │  └─────────────┘      └─────────────┘      └─────────────┘       │   │
│     │                                                   │               │   │
│     │                                                   ▼               │   │
│     │                                      ┌────────────────────────┐   │   │
│     │                                      │  EXTRACTED CONTENT     │   │   │
│     │                                      │  === PAGE 1 ===        │   │   │
│     │                                      │  [SCENE: description]  │   │   │
│     │                                      │  Story text...         │   │   │
│     │                                      └────────────────────────┘   │   │
│     │                                                                   │   │
│     │  ⏱️ 15 second delay between pages (rate limiting)                │   │
│     └───────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. SAVE TO DATABASES                                                       │
│                                                                             │
│     ┌─────────────────────────────┐     ┌─────────────────────────────┐    │
│     │  SQLite (stories.db)        │     │  ChromaDB (chroma_db/)      │    │
│     │  Full story content         │     │  Vector embeddings for RAG  │    │
│     │  ├── title                  │     │  ├── page content           │    │
│     │  ├── content (all pages)    │     │  ├── story_title            │    │
│     │  └── file_hash              │     │  └── page_num               │    │
│     └─────────────────────────────┘     └─────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────┐
                        │  ✅ UPLOAD DONE   │
                        │  Ready for agent  │
                        └───────────────────┘
```

---

## PART 2: Agent Flow (main.py)

```
                         python main.py dev
                                │
                                ▼
                    ┌───────────────────────┐
                    │     INITIALIZE        │
                    │  • Load stories.db    │
                    │  • Setup AudioController│
                    │  • Connect LiveKit    │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   CREATE ULTRAVOX     │
                    │   AGENT + TOOLS       │
                    │                       │
                    │  Tools:               │
                    │  • list_stories()     │
                    │  • start_story(name)  │
                    │  • get_next_page()    │
                    │  • set_mood(mood)     │
                    │  • ask_about_story()  │ ← RAG
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  WAIT FOR CHILD       │
                    └───────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONVERSATION LOOP                        │
│                                                             │
│   ┌─────────────┐      ┌─────────────┐      ┌───────────┐  │
│   │   AGENT     │      │   CHILD     │      │   TOOLS   │  │
│   │   GREETS    │ ───▶ │   PICKS     │ ───▶ │  FETCH    │  │
│   │             │      │   STORY     │      │  PAGE     │  │
│   └─────────────┘      └─────────────┘      └───────────┘  │
│                                                    │        │
│                                                    ▼        │
│                                            ┌───────────┐   │
│         ┌──────────────────────────────────│   AGENT   │   │
│         │                                  │   READS   │   │
│         │                                  │   PAGE    │   │
│         ▼                                  └───────────┘   │
│   ┌───────────┐     ┌───────────┐               │          │
│   │  "THE     │ NO  │ get_next  │◀──────────────┘          │
│   │   END"?   │────▶│  _page()  │                          │
│   └───────────┘     └───────────┘                          │
│         │ YES                                               │
│         ▼                                                   │
│   ┌───────────────┐                                        │
│   │ "Another      │                                        │
│   │  story?"      │ ─────▶ (loop back to CHILD PICKS)      │
│   └───────────────┘                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## PART 3: Background Music System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AUDIO CONTROLLER (audio_controller.py)                 │
└─────────────────────────────────────────────────────────────────────────────┘

    moods/
    ├── calm.mp3      ← peaceful, quiet scenes
    ├── happy.mp3     ← joyful, celebration
    ├── suspense.mp3  ← scary, tense moments
    └── sad.mp3       ← emotional scenes

    ┌─────────────────────────────────────────────────────────────────────┐
    │  set_mood("suspense") called                                        │
    │           │                                                         │
    │           ▼                                                         │
    │  ┌─────────────────┐                                               │
    │  │ Stop current    │                                               │
    │  │ music (if any)  │                                               │
    │  └─────────────────┘                                               │
    │           │                                                         │
    │           ▼                                                         │
    │  ┌─────────────────┐     ┌─────────────────┐                       │
    │  │ Load suspense   │ ──▶ │ Reduce volume   │                       │
    │  │ .mp3 with pydub │     │ to 5% (-26 dB)  │                       │
    │  └─────────────────┘     └─────────────────┘                       │
    │                                   │                                 │
    │                                   ▼                                 │
    │                          ┌─────────────────┐                       │
    │                          │ Stream to       │                       │
    │                          │ LiveKit room    │                       │
    │                          │ (48kHz stereo)  │                       │
    │                          └─────────────────┘                       │
    │                                   │                                 │
    │                                   ▼                                 │
    │                          ┌─────────────────┐                       │
    │                          │ Loop until      │                       │
    │                          │ mood changes    │                       │
    │                          └─────────────────┘                       │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## PART 4: RAG (Question Answering)

```
Child asks: "Who is the prince?"
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ask_about_story("Who is the prince?")                      │
│                │                                            │
│                ▼                                            │
│  ┌─────────────────────────────────────────┐               │
│  │  ChromaDB Vector Search                  │               │
│  │  query_texts=["Who is the prince?"]      │               │
│  │  where={"story_title": current_story}    │               │
│  └─────────────────────────────────────────┘               │
│                │                                            │
│                ▼                                            │
│  ┌─────────────────────────────────────────┐               │
│  │  Returns top 3 relevant pages            │               │
│  │  (semantic similarity search)            │               │
│  └─────────────────────────────────────────┘               │
│                │                                            │
│                ▼                                            │
│  Agent answers based on retrieved content                   │
│  "The prince is a young boy who lives in a castle..."      │
│                │                                            │
│                ▼                                            │
│  "Shall I continue with the story?"                        │
└─────────────────────────────────────────────────────────────┘
```

**RAG enables:**
- "Who is [character]?"
- "What happened to [thing]?"
- "Tell me about [event]"
- "Why did [character] do that?"

---

## File Structure

```
storyteller/
├── main.py              # LiveKit agent entry point
├── upload_to_db.py      # PDF extraction script
├── audio_controller.py  # Background music controller
├── stories.db           # SQLite database (full content)
├── chroma_db/           # ChromaDB vector database (RAG)
├── .env                 # API keys (ULTRAVOX_API_KEY, GOOGLE_API_KEY)
├── requirements.txt     # Python dependencies
│
├── stories/             # PDF files to upload
│   ├── story1.pdf
│   └── story2.pdf
│
└── moods/               # Background music files
    ├── calm.mp3
    ├── happy.mp3
    ├── suspense.mp3
    └── sad.mp3
```

---

## Quick Start Commands

```bash
# 1. First, upload PDFs to database
python upload_to_db.py

# 2. Then run the agent
python main.py dev
```
