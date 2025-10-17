"""
Check what content is actually stored in Qdrant
"""
import os
from dotenv import load_dotenv
import requests
import json

load_dotenv()

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

def check_qdrant_content():
    """Check what's in Qdrant collection"""

    url = f"{QDRANT_URL}/collections/grade_06_science/points/scroll"
    headers = {
        "api-key": QDRANT_API_KEY,
        "Content-Type": "application/json"
    }

    payload = {
        "limit": 10,
        "with_payload": True,
        "with_vector": False
    }

    print("=" * 80)
    print("QDRANT CONTENT CHECK - grade_06_science")
    print("=" * 80)

    response = requests.post(url, headers=headers, json=payload)

    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        return

    data = response.json()
    points = data.get('result', {}).get('points', [])

    print(f"\nTotal points retrieved: {len(points)}")
    print("=" * 80)

    for i, point in enumerate(points[:5], 1):
        payload_data = point.get('payload', {})

        print(f"\n[Point {i}]")
        print(f"ID: {point.get('id')}")
        print(f"Chapter: {payload_data.get('chapter', 'N/A')}")
        print(f"Section: {payload_data.get('section_title', 'N/A')}")
        print(f"Chunk ID: {payload_data.get('chunk_id', 'N/A')}")

        content = payload_data.get('content', '')
        print(f"\nContent Preview (first 300 chars):")
        print(f"{content[:300]}")

        print("\n" + "-" * 80)

    # Check for specific keywords
    print("\n" + "=" * 80)
    print("KEYWORD SEARCH")
    print("=" * 80)

    keywords = ['scientific method', 'biodiversity', 'classify', 'plants']

    for keyword in keywords:
        count = 0
        for point in points:
            content = point.get('payload', {}).get('content', '').lower()
            if keyword in content:
                count += 1

        print(f"\n'{keyword}': Found in {count}/{len(points)} chunks")

if __name__ == "__main__":
    check_qdrant_content()
