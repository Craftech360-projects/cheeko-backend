"""
Fix reversed text directly in Qdrant collections
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import requests
import re

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()

QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')

def detect_reversed_words(text: str) -> bool:
    """Detect if text contains reversed words"""
    reversed_patterns = [
        'edarG', 'ecneicS', 'koobtxeT', 'ytisoiruC', 'dlroW',
        'niatnuoM', 'taoG', 'snialp', 'ytisreviD', 'gniviL',
        'slamina', 'stnalp', 'erutan', 'retpahc', 'tsaoC', 'treseD'
    ]
    return any(pattern in text for pattern in reversed_patterns)

def fix_reversed_words(text: str) -> str:
    """Fix only the reversed words in text, preserving normal words"""

    if not detect_reversed_words(text):
        return text

    words = text.split()
    fixed_words = []

    for word in words:
        # Check if this specific word appears to be reversed
        # Heuristic: if reversing it makes it look more like English
        reversed_word = word[::-1]

        # Common English patterns after reversal
        if len(word) > 3:
            # Check if reversed version has more vowel clusters (common in English)
            original_vowel_density = sum(1 for c in word.lower() if c in 'aeiou') / len(word)
            reversed_vowel_density = sum(1 for c in reversed_word.lower() if c in 'aeiou') / len(reversed_word)

            # If reversed has better vowel distribution or matches known patterns
            if (detect_reversed_words(word) or
                (reversed_vowel_density > original_vowel_density * 1.2)):
                fixed_words.append(reversed_word)
            else:
                fixed_words.append(word)
        else:
            fixed_words.append(word)

    return ' '.join(fixed_words)

def get_all_points():
    """Get all points from Qdrant collection"""

    url = f"{QDRANT_URL}/collections/grade_06_science/points/scroll"
    headers = {
        "api-key": QDRANT_API_KEY,
        "Content-Type": "application/json"
    }

    all_points = []
    offset = None

    while True:
        payload = {
            "limit": 100,
            "with_payload": True,
            "with_vector": True
        }

        if offset:
            payload["offset"] = offset

        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            print(f"Error getting points: {response.status_code}")
            print(response.text)
            break

        data = response.json()
        points = data.get('result', {}).get('points', [])

        if not points:
            break

        all_points.extend(points)
        offset = data.get('result', {}).get('next_page_offset')

        if not offset:
            break

    return all_points

def update_point(point_id, payload_data, vector):
    """Update a single point in Qdrant"""

    url = f"{QDRANT_URL}/collections/grade_06_science/points"
    headers = {
        "api-key": QDRANT_API_KEY,
        "Content-Type": "application/json"
    }

    update_payload = {
        "points": [{
            "id": point_id,
            "payload": payload_data,
            "vector": vector
        }]
    }

    response = requests.put(url, headers=headers, json=update_payload)

    return response.status_code == 200

def fix_all_reversed_text():
    """Fix reversed text in all Qdrant points"""

    print("=" * 80)
    print("FIXING REVERSED TEXT IN QDRANT")
    print("=" * 80)

    # Get all points
    print("\n[1/3] Fetching all points from Qdrant...")
    points = get_all_points()
    print(f"   ✓ Retrieved {len(points)} points")

    # Find points with reversed text
    print("\n[2/3] Detecting points with reversed text...")
    points_to_fix = []

    for point in points:
        payload_data = point.get('payload', {})
        content = payload_data.get('content', '')

        if detect_reversed_words(content):
            points_to_fix.append(point)

    print(f"   ✓ Found {len(points_to_fix)} points with reversed text")

    # Fix and update
    print("\n[3/3] Fixing and updating points...")
    fixed_count = 0
    failed_count = 0

    for i, point in enumerate(points_to_fix, 1):
        point_id = point.get('id')
        payload_data = point.get('payload', {})
        vector = point.get('vector')

        # Fix the content
        original_content = payload_data.get('content', '')
        fixed_content = fix_reversed_words(original_content)

        if fixed_content != original_content:
            # Update payload
            payload_data['content'] = fixed_content

            # Update in Qdrant
            success = update_point(point_id, payload_data, vector)

            if success:
                fixed_count += 1
                print(f"   ✓ Fixed point {i}/{len(points_to_fix)}: {payload_data.get('chunk_id', point_id)}")
            else:
                failed_count += 1
                print(f"   ✗ Failed to fix point {i}/{len(points_to_fix)}: {payload_data.get('chunk_id', point_id)}")

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total points: {len(points)}")
    print(f"Points with reversed text: {len(points_to_fix)}")
    print(f"Successfully fixed: {fixed_count}")
    print(f"Failed: {failed_count}")
    print("=" * 80)

if __name__ == "__main__":
    fix_all_reversed_text()
