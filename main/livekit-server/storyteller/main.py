"""
Storyteller LiveKit Agent - Reads stories from pre-extracted database.
Run 'python upload_to_db.py' first to populate the database.

Features:
- Sequential story reading (page by page)
- RAG for answering questions about story content
- Background music based on mood

Usage:
    python main.py dev
"""

import logging
import sqlite3
from pathlib import Path
from dotenv import load_dotenv
from typing import Annotated
import chromadb

from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    Agent,
    AgentSession,
    function_tool,
)
# from livekit.plugins import google  # Commented out - using Ultravox instead
from livekit.plugins import ultravox

from audio_controller import AudioController

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger("storyteller.main")
logging.basicConfig(level=logging.INFO)

# Database paths
DB_PATH = ROOT_DIR / "stories.db"
CHROMA_PATH = ROOT_DIR / "chroma_db"

# Global references
_audio_controller = None
_db_connection = None

# Initialize ChromaDB for RAG
chroma_client = chromadb.PersistentClient(path=str(CHROMA_PATH))
story_collection = chroma_client.get_or_create_collection(name="story_pages")


def get_db_connection() -> sqlite3.Connection:
    """Get or create database connection."""
    global _db_connection
    if _db_connection is None:
        _db_connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db_connection.row_factory = sqlite3.Row
    return _db_connection


def get_all_story_titles() -> list[str]:
    """Get list of all story titles from database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT title FROM stories ORDER BY title")
    return [row['title'] for row in cursor.fetchall()]


def get_story_by_name(story_name: str) -> dict | None:
    """Find story by name (partial match)."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Try exact match first
    cursor.execute("SELECT * FROM stories WHERE LOWER(title) = LOWER(?)", (story_name,))
    result = cursor.fetchone()

    if not result:
        # Try partial match
        cursor.execute(
            "SELECT * FROM stories WHERE LOWER(title) LIKE LOWER(?)",
            (f"%{story_name}%",)
        )
        result = cursor.fetchone()

    if result:
        return dict(result)
    return None


@function_tool()
async def set_mood(
    mood: Annotated[str, "The mood to set. One of: calm, suspense, happy, sad, action"]
):
    """Changes the background music mood to match the story scene. Call this silently without announcing it."""
    global _audio_controller
    if _audio_controller:
        logger.info(f"Setting mood to: {mood}")
        await _audio_controller.set_mood(mood)
        return f"Mood changed to {mood}"
    return "Audio controller not available"


# Global to track current story and page
_current_story = None
_current_page = 0


def _split_story_into_pages(content: str) -> list[str]:
    """Split story content into pages based on === PAGE X === markers."""
    import re
    # Split by page markers
    pages = re.split(r'===\s*PAGE\s*\d+\s*===', content)
    # Filter empty pages and strip whitespace
    pages = [p.strip() for p in pages if p.strip()]
    return pages if pages else [content]


@function_tool()
async def start_story(
    story_name: Annotated[str, "The name of the story to start reading"]
):
    """
    Starts a story and returns the FIRST PAGE only.
    Call get_next_page() to continue reading subsequent pages.
    """
    global _current_story, _current_page

    logger.info(f"Starting story: {story_name}")

    story = get_story_by_name(story_name)

    if not story:
        available = get_all_story_titles()
        return f"Story '{story_name}' not found. Available: {', '.join(available)}"

    _current_story = story
    _current_page = 0

    pages = _split_story_into_pages(story['content'])
    total_pages = len(pages)

    logger.info(f"Story '{story['title']}' has {total_pages} pages")

    first_page = pages[0] if pages else "No content found"

    return f"""
STORY: {story['title']}
Page 1 of {total_pages}

{first_page}

---
After reading this page, call get_next_page() for the next page.
Remember to set_mood() based on the scene!
"""


@function_tool()
async def get_next_page():
    """
    Gets the next page of the current story.
    Call this after reading each page to continue the story.
    """
    global _current_story, _current_page

    if not _current_story:
        return "No story started yet. Use start_story() first."

    pages = _split_story_into_pages(_current_story['content'])
    total_pages = len(pages)

    _current_page += 1

    if _current_page >= total_pages:
        story_title = _current_story['title']
        _current_story = None
        _current_page = 0
        return f"THE END! You've finished '{story_title}'. Ask if they want to hear another story!"

    current_content = pages[_current_page]

    logger.info(f"Returning page {_current_page + 1}/{total_pages}")

    return f"""
Page {_current_page + 1} of {total_pages}

{current_content}

---
Continue reading, then call get_next_page() for the next page.
"""


@function_tool()
async def get_story_content(
    story_name: Annotated[str, "The name of the story to read (e.g., 'Prince and the Star' or 'Leela')"]
):
    """
    Gets a summary of the story. For full reading, use start_story() instead.
    """
    logger.info(f"Fetching story info: {story_name}")

    story = get_story_by_name(story_name)

    if not story:
        available = get_all_story_titles()
        return f"Story '{story_name}' not found. Available stories: {', '.join(available)}"

    pages = _split_story_into_pages(story['content'])

    return f"""
Story: {story['title']}
Total pages: {len(pages)}

To read this story, call start_story("{story['title']}") to begin from page 1.
"""


@function_tool()
async def list_stories():
    """Lists all available story books in the library."""
    titles = get_all_story_titles()

    if not titles:
        return "No stories available. Please run 'python upload_to_db.py' to add stories."

    story_list = "\n".join([f"- {title}" for title in titles])
    return f"Available stories in the library:\n{story_list}"


@function_tool()
async def ask_about_story(
    question: Annotated[str, "The child's question about the story"]
):
    """
    Answer questions about the current story using RAG.
    Use this when the child asks questions like "Who is the prince?" or "What happened to the flower?"
    """
    global _current_story

    if not _current_story:
        return "No story is being read yet. Start a story first!"

    story_title = _current_story['title']
    logger.info(f"RAG query for '{story_title}': {question}")

    try:
        # Search ChromaDB for relevant content
        results = story_collection.query(
            query_texts=[question],
            n_results=3,
            where={"story_title": story_title}
        )

        if results['documents'] and results['documents'][0]:
            context = "\n\n".join(results['documents'][0])
            logger.info(f"RAG found {len(results['documents'][0])} relevant passages")
            return f"Based on the story:\n{context}"
        else:
            return "I couldn't find specific information about that in the story."

    except Exception as e:
        logger.error(f"RAG query error: {e}")
        return "Let me continue with the story - I couldn't search for that right now."


async def entrypoint(ctx: JobContext):
    global _audio_controller
    logger.info("Starting Storyteller Agent...")

    # Check database
    if not DB_PATH.exists():
        logger.error(f"Database not found: {DB_PATH}")
        logger.error("Run 'python upload_to_db.py' first to upload stories!")
        return

    # Get available stories
    story_titles = get_all_story_titles()

    if not story_titles:
        logger.warning("No stories in database. Run 'python upload_to_db.py' first.")
        story_list_str = "No stories available yet."
    else:
        story_list_str = ", ".join(story_titles)
        logger.info(f"Loaded {len(story_titles)} stories: {story_list_str}")

    # Connect to room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Initialize audio controller
    moods_dir = ROOT_DIR / "moods"
    moods_dir.mkdir(exist_ok=True)
    _audio_controller = AudioController(ctx.room, str(moods_dir))

    # Background music will start when story begins (via set_mood tool)

    # System prompt
    system_instruction = f"""
You are a magical storyteller for children. Warm and engaging voice.

STORIES: {story_list_str}

=== WORKFLOW ===
1. Greet child, ask which story
2. When they choose: call start_story(name), then say something brief like "Alright, here we go!" and START READING
3. After each page: call get_next_page() and continue reading
4. Continue until "THE END"

IMPORTANT: After tool returns, you can briefly acknowledge (e.g. "Oh wonderful! Let me tell you this story...") then IMMEDIATELY start reading. Don't wait for user to ask again.

=== READING STYLE ===
- Read the story text naturally with expression
- For [SCENE: ...] tags: mention in 3-5 words MAX, then move on quickly
- Use different voices for characters
- Be expressive but keep it flowing

=== INTERACT WITH THE CHILD ===
Don't just read like a robot! Be a warm storyteller who connects with the child:
- After exciting moments: "Wow, can you believe that happened?"
- Before tense parts: "Uh oh... what do you think will happen next?"
- At page breaks: "Are you ready for what comes next?" or "Let's see what happens..."
- React to the story: "Oh no!" "How wonderful!" "That's so brave!"
- Keep interactions SHORT (5 seconds max) then continue reading
- Don't overdo it - interact naturally every few paragraphs, not after every sentence

=== ANSWERING QUESTIONS (RAG) ===
If the child asks a question about the story (e.g. "Who is the prince?", "What happened to the flower?"):
- Call ask_about_story(question) to search the story content
- Answer based on what RAG returns, then offer to continue reading
- Keep answers brief and child-friendly

=== BACKGROUND MUSIC (SILENT) ===
Call set_mood() silently to control background music. Never announce it to the child.
- When story STARTS: call set_mood("calm") to begin music
- During story: change mood based on scene content:
  - calm: peaceful, quiet moments
  - happy: joyful, celebration scenes
  - suspense: scary, mysterious, tense parts
  - sad: emotional, sad moments
- Change mood naturally as story tone shifts
"""

    # # Gemini Realtime Model (commented out - function calling broken)
    # model = google.realtime.RealtimeModel(
    #     model="gemini-2.0-flash-exp",
    #     voice="Puck",
    # )

    # Ultravox Realtime Model - supports function calling
    # Using "Sarah" - a warm English female voice suitable for storytelling
    model = ultravox.realtime.RealtimeModel(
        # voice="Priya",
        system_prompt=system_instruction,
        temperature=0.7,
        language_hint="en",
        first_speaker="FIRST_SPEAKER_AGENT",
    )

    # Create Agent
    agent = Agent(
        instructions=system_instruction,
        llm=model,
        tools=[set_mood, start_story, get_next_page, list_stories, ask_about_story],
    )

    session = AgentSession()
    await ctx.wait_for_participant()
    await session.start(agent=agent, room=ctx.room)

    # Agent will automatically greet due to first_speaker="FIRST_SPEAKER_AGENT"
    logger.info("Agent started! Waiting for agent to greet...")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
