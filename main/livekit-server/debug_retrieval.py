"""
Debug script to check what's being retrieved for test questions
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import asyncio

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Setup paths
current_dir = Path(__file__).parent
src_dir = current_dir / "src"
sys.path.insert(0, str(current_dir))
sys.path.insert(0, str(src_dir))
os.chdir(current_dir)

# Load environment
load_dotenv()

from src.services.education_service import EducationService

async def debug_retrieval():
    """Test retrieval for failing questions"""

    service = EducationService()
    success = await service.initialize()

    if not success:
        print("Failed to initialize service")
        return

    await service.set_student_context(6, "science")

    # Test questions that failed
    test_questions = [
        "What is the scientific method?",
        "What is biodiversity?",
        "How do we classify plants?"
    ]

    print("=" * 80)
    print("RETRIEVAL DEBUG - Testing Failed Questions")
    print("=" * 80)

    for question in test_questions:
        print(f"\n{'=' * 80}")
        print(f"Question: {question}")
        print(f"{'=' * 80}")

        # Get answer
        response = await service.answer_question(question)

        print(f"\n📝 Raw Answer ({response.get('grade_level', 'unknown')} grade):")
        print(f"   {response['answer'][:200]}...")

        print(f"\n📊 Retrieval Stats:")
        print(f"   Confidence: {response.get('confidence', 0):.2f}")
        print(f"   Sources: {len(response.get('sources', []))}")

        if response.get('sources'):
            print(f"\n📚 Retrieved Sources:")
            for i, source in enumerate(response['sources'][:3], 1):
                print(f"\n   Source {i}:")
                print(f"   - Chapter: {source.get('chapter', 'unknown')}")
                print(f"   - Section: {source.get('section_title', 'unknown')}")
                print(f"   - Score: {source.get('relevance_score', 0):.3f}")
                content = source.get('content', '')[:150]
                print(f"   - Content: {content}...")
        else:
            print(f"\n   ❌ NO SOURCES RETRIEVED!")

        print()

if __name__ == "__main__":
    asyncio.run(debug_retrieval())
