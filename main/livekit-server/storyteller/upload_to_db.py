"""
Upload all story PDFs to MySQL database + ChromaDB Cloud (RAG) using Gemini OCR.
Run this ONCE when you add/update stories.

Uses page-by-page approach: PDF → Image → Gemini Vision OCR → MySQL + ChromaDB Cloud

Usage:
    python upload_to_db.py
"""

import asyncio
import logging
import os
import pymysql
import hashlib
import io
import re
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai
import fitz  # PyMuPDF
from PIL import Image
import chromadb

# Load environment
ROOT_DIR = Path(__file__).parent
# Load .env from parent livekit-server directory
load_dotenv(ROOT_DIR.parent / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("upload_stories")

# MySQL Database Configuration
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3307"))
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "manager_api")
MYSQL_USER = os.getenv("MYSQL_USER", "manager")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "managerpassword")

# Paths
STORIES_DIR = ROOT_DIR / "stories"

# Configure Gemini
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY not found in .env")
genai.configure(api_key=GOOGLE_API_KEY)

# Initialize ChromaDB Cloud for RAG
CHROMA_API_KEY = os.getenv("CHROMA_API_KEY")
CHROMA_TENANT = os.getenv("CHROMA_TENANT")
CHROMA_DATABASE = os.getenv("CHROMA_DATABASE")

# DISABLED: Only uploading to MySQL for now
story_collection = None
logger.info("⚠️ ChromaDB upload disabled - MySQL only mode")

# if not all([CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE]):
#     logger.warning("ChromaDB Cloud credentials not found - RAG will be disabled")
#     story_collection = None
# else:
#     try:
#         chroma_client = chromadb.CloudClient(
#             tenant=CHROMA_TENANT,
#             database=CHROMA_DATABASE,
#             api_key=CHROMA_API_KEY
#         )
#         story_collection = chroma_client.get_or_create_collection(name="story_pages")
#         logger.info(f"✅ ChromaDB Cloud connected - Collection: story_pages")
#     except Exception as e:
#         logger.warning(f"⚠️ ChromaDB Cloud connection failed: {e}")
#         story_collection = None


def init_database():
    """Initialize MySQL database connection."""
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )
    logger.info(f"✅ Connected to MySQL: {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}")
    return conn


def get_file_hash(filepath: Path) -> str:
    """Calculate MD5 hash of a file."""
    hash_md5 = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def story_needs_update(conn: pymysql.connections.Connection, filename: str, file_hash: str) -> bool:
    """Check if story needs to be uploaded/updated."""
    cursor = conn.cursor()
    cursor.execute("SELECT file_hash FROM stories WHERE filename = %s", (filename,))
    result = cursor.fetchone()

    if result is None:
        return True  # New file
    return result['file_hash'] != file_hash  # Changed file


def store_pages_in_chromadb(title: str, content: str):
    """Split content into pages and store each page in ChromaDB Cloud for RAG."""
    if not story_collection:
        logger.warning("  ChromaDB not available - skipping RAG storage")
        return
    
    # Split by page markers
    pages = re.split(r'===\s*PAGE\s*\d+\s*===', content)
    pages = [p.strip() for p in pages if p.strip()]

    logger.info(f"  Storing {len(pages)} pages in ChromaDB Cloud for RAG...")

    # Delete existing pages for this story
    try:
        existing = story_collection.get(where={"story_title": title})
        if existing['ids']:
            story_collection.delete(ids=existing['ids'])
            logger.info(f"  Deleted {len(existing['ids'])} old embeddings")
    except Exception:
        pass

    # Add each page
    for i, page_content in enumerate(pages):
        page_num = i + 1
        doc_id = f"{title}_page_{page_num}"

        story_collection.add(
            documents=[page_content],
            metadatas=[{
                "story_title": title,
                "page_num": page_num,
                "total_pages": len(pages)
            }],
            ids=[doc_id]
        )

    logger.info(f"  Added {len(pages)} pages to ChromaDB")


async def extract_pdf_content(pdf_path: Path) -> str:
    """
    Extract text from PDF using page-by-page Gemini Vision OCR.
    Same approach as webapp server.py - converts pages to images.

    Rate Limits: 15 seconds between API calls (like server.py)
    """
    logger.info(f"Extracting content from: {pdf_path.name}")

    # Initialize Gemini model
    model = genai.GenerativeModel("gemini-2.5-flash")

    # Open PDF with PyMuPDF
    pdf_doc = fitz.open(pdf_path)
    page_count = len(pdf_doc)
    logger.info(f"  Found {page_count} pages")

    all_pages_content = []

    for page_num in range(page_count):
        logger.info(f"  Processing page {page_num + 1}/{page_count}...")

        # Convert PDF page to image (2x zoom for quality)
        pdf_page = pdf_doc[page_num]
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = pix.tobytes("png")

        # Open as PIL Image for Gemini
        img = Image.open(io.BytesIO(img_bytes))

        # Rate limiting: 15 seconds between API calls (like server.py)
        if page_num > 0:
            logger.info(f"  Waiting 15s (rate limit)...")
            await asyncio.sleep(15)

        # Call Gemini Vision OCR
        try:
            page_number = page_num + 1  # Capture for closure
            prompt = f"""Extract ALL text content from this children's story page (Page {page_number}).

TEXT EXTRACTION ONLY:
- Include EVERY word of the story text exactly as written
- Preserve all dialogue with quotation marks
- Preserve paragraph structure
- IGNORE any illustrations/images - only extract the TEXT

DO NOT:
- Do NOT describe images or illustrations
- Do NOT add [SCENE: ...] tags
- Do NOT add any commentary about pictures
- Just extract the pure story text

Format your response as:
=== PAGE {page_number} ===

(story text here - nothing else)"""

            response = await asyncio.to_thread(
                lambda p=prompt, i=img: model.generate_content([p, i]).text
            )

            page_content = response
            logger.info(f"  Page {page_num + 1}: {len(page_content)} characters extracted")
            all_pages_content.append(page_content)

        except Exception as e:
            error_str = str(e)
            logger.error(f"  Error on page {page_num + 1}: {error_str[:200]}")

            # Check for quota exhaustion
            if "429" in error_str or "quota" in error_str.lower():
                if "limit: 0" in error_str:
                    logger.error("  DAILY QUOTA EXHAUSTED! Try again after midnight Pacific.")
                    pdf_doc.close()
                    raise Exception("Daily quota exhausted")
                else:
                    # Wait longer and retry once
                    logger.warning(f"  Rate limited. Waiting 30s and retrying...")
                    await asyncio.sleep(30)
                    try:
                        retry_prompt = f"Extract all text from this story page {page_number}. Describe any illustrations."
                        response = await asyncio.to_thread(
                            lambda p=retry_prompt, i=img: model.generate_content([p, i]).text
                        )
                        all_pages_content.append(response)
                    except:
                        all_pages_content.append(f"=== PAGE {page_number} ===\n[Page extraction failed]")
            else:
                all_pages_content.append(f"=== PAGE {page_number} ===\n[Page extraction failed: {error_str[:100]}]")

    pdf_doc.close()

    # Combine all pages
    full_content = "\n\n".join(all_pages_content)
    logger.info(f"  Total: {len(full_content)} characters from {page_count} pages")

    return full_content


async def upload_story(conn: pymysql.connections.Connection, pdf_path: Path):
    """Upload a single story to database."""
    filename = pdf_path.name
    title = pdf_path.stem  # Filename without extension
    file_hash = get_file_hash(pdf_path)

    # Check if update needed
    if not story_needs_update(conn, filename, file_hash):
        logger.info(f"Skipping {filename} (unchanged)")
        return False

    # Extract content
    content = await extract_pdf_content(pdf_path)

    # Upsert to MySQL database
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO stories (filename, title, content, file_hash)
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            content = VALUES(content),
            file_hash = VALUES(file_hash),
            updated_at = CURRENT_TIMESTAMP
    """, (filename, title, content, file_hash))

    conn.commit()
    logger.info(f"Saved {filename} to MySQL")

    # Store pages in ChromaDB Cloud for RAG
    # store_pages_in_chromadb(title, content)  # Skip ChromaDB - already uploaded

    logger.info(f"Completed {filename} (MySQL only)")
    return True


async def main():
    """Main upload process."""
    print("\n" + "=" * 60)
    print("STORYTELLER - PDF Upload to Database")
    print("=" * 60 + "\n")

    # Check stories directory
    if not STORIES_DIR.exists():
        STORIES_DIR.mkdir(exist_ok=True)
        print(f"Created stories folder: {STORIES_DIR}")
        print("Add PDF files to this folder and run again.\n")
        return

    # Get PDF files
    pdf_files = list(STORIES_DIR.glob("*.pdf"))

    if not pdf_files:
        print(f"No PDF files found in: {STORIES_DIR}")
        print("Add PDF files and run again.\n")
        return

    print(f"Found {len(pdf_files)} PDF files:\n")
    for pdf in pdf_files:
        print(f"  - {pdf.name}")

    print()
    print("Method: PDF -> Image -> Gemini Vision OCR (page by page)")
    print("Model: gemini-2.5-flash")
    print("Rate Limit: 15s between pages (like server.py)")
    print()
    print("Extraction includes:")
    print("  - Page numbers (=== PAGE X ===)")
    print("  - Full story text (word-for-word)")
    print("  - Scene descriptions [SCENE: ...] for illustrations")
    print()
    # Estimate: each page takes ~15s + processing time
    total_pages_estimate = len(pdf_files) * 10  # assume ~10 pages per PDF
    print(f"Estimated time: ~{total_pages_estimate * 0.3:.0f}-{total_pages_estimate * 0.5:.0f} minutes")
    print("Check quota: https://aistudio.google.com/usage\n")

    # Initialize database
    conn = init_database()

    # Process each PDF
    uploaded = 0
    skipped = 0
    failed = 0

    for i, pdf_path in enumerate(pdf_files):
        try:
            if await upload_story(conn, pdf_path):
                uploaded += 1
            else:
                skipped += 1

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to process {pdf_path.name}: {e}")
            failed += 1

            # Stop if daily quota exhausted
            if "quota exhausted" in error_msg.lower():
                logger.error("Stopping - daily quota exhausted.")
                break

    conn.close()

    # Summary
    print("\n" + "=" * 60)
    print("UPLOAD COMPLETE")
    print("=" * 60)
    print(f"\n  Uploaded: {uploaded}")
    print(f"  Skipped (unchanged): {skipped}")
    print(f"  Failed: {failed}")
    print(f"\n  MySQL DB: {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}")
    print(f"  ChromaDB: Cloud ({CHROMA_TENANT}/{CHROMA_DATABASE})\" if story_collection else \"  ChromaDB: Disabled\")")
    print("\n" + "=" * 60)
    print("Stories are now available in MySQL for the storyteller agent!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
