#!/usr/bin/env python3
"""
Script to check textbook statuses and manually process one
"""

import asyncio
import httpx

async def check_textbooks():
    """Check textbook statuses via API"""
    headers = {
        "Authorization": "Bearer 66122e75-3b2a-45d7-a082-0f0894529348",
        "Content-Type": "application/json"
    }
    
    base_url = "http://localhost:8002/xiaozhi"
    
    async with httpx.AsyncClient() as client:
        try:
            # Get all textbooks
            response = await client.get(f"{base_url}/api/textbooks", headers=headers, timeout=30.0)
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response data: {data}")
                textbooks = data.get('data', [])
                
                if textbooks is None:
                    print("No textbooks data found")
                    return None
                
                print(f"Found {len(textbooks)} textbooks:")
                for tb in textbooks:
                    print(f"  ID: {tb.get('id')}, Name: {tb.get('originalFilename')}, Status: {tb.get('status')}")
                
                # Check for textbooks in "chunked" status
                chunked_books = [tb for tb in textbooks if tb.get('status') == 'chunked']
                if chunked_books:
                    print(f"\nFound {len(chunked_books)} textbooks in 'chunked' status (ready for embedding):")
                    for tb in chunked_books:
                        print(f"  ID: {tb.get('id')}, Name: {tb.get('originalFilename')}")
                    
                    # Try to change one to "pending" to trigger processing
                    first_chunked = chunked_books[0]
                    textbook_id = first_chunked['id']
                    
                    print(f"\nChanging textbook {textbook_id} from 'chunked' to 'pending' for processing...")
                    
                    update_response = await client.patch(
                        f"{base_url}/api/textbooks/{textbook_id}/status",
                        headers=headers,
                        json={"status": "pending"},
                        timeout=30.0
                    )
                    
                    if update_response.status_code == 200:
                        print(f"✓ Successfully changed textbook {textbook_id} to 'pending' status")
                        return textbook_id
                    else:
                        print(f"✗ Failed to update status: {update_response.status_code}")
                        print(update_response.text)
                
            else:
                print(f"Failed to get textbooks: {response.status_code}")
                print(response.text)
        
        except Exception as e:
            print(f"Error: {e}")
    
    return None

if __name__ == "__main__":
    textbook_id = asyncio.run(check_textbooks())