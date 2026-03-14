import requests
import os
import json
import mimetypes

class ManagerAPIClient:
    def __init__(self, api_url, api_secret):
        self.api_url = api_url.rstrip('/')
        self.headers = {
            'X-Service-Key': api_secret
        }
        print(f"🔌 Initialized API Client: {self.api_url}")

    def upload_file(self, file_path, content_type='story', category=None, custom_filename=None):
        """Uploads a file (audio or image) to the Manager API

        Args:
            file_path: Path to the local file
            content_type: Type of content (story, music, etc.)
            category: Category/subfolder for S3 storage
            custom_filename: Optional custom filename for S3 (e.g., '01.mp3')
        """
        if not os.path.exists(file_path):
            print(f"❌ File not found: {file_path}")
            return None

        # Determine if it's an image or audio
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = 'application/octet-stream'

        # Endpoint is /content/library/upload for both (verified in content.routes.js)
        endpoint = '/content/library/upload'

        is_image = mime_type.startswith('image')
        url = f"{self.api_url}{endpoint}"

        # Use custom filename if provided, otherwise use original
        upload_filename = custom_filename if custom_filename else os.path.basename(file_path)

        try:
            with open(file_path, 'rb') as f:
                files = {'file': (upload_filename, f, mime_type)}
                data = {'contentType': content_type}

                # Use provided category (e.g., pack_code) or default
                if category:
                    data['category'] = category
                elif not is_image:
                    data['category'] = 'Generated'

                print(f"☁️ Uploading {upload_filename} to {data.get('category')}...")
                response = requests.post(url, headers=self.headers, files=files, data=data)
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('code') == 0: # Success
                         s3_url = result['data']['url']
                         print(f"✅ Uploaded: {s3_url}")
                         return s3_url
                    else:
                         print(f"❌ API Error: {result}")
                else:
                    print(f"❌ HTTP Error {response.status_code}: {response.text}")
                    
        except Exception as e:
            print(f"❌ Upload Exception: {e}")
            return None

    def create_content_pack(self, pack_data):
        """Creates a content pack via the API"""
        url = f"{self.api_url}/admin/rfid/content-pack"
        
        try:
            print(f"📦 Creating Content Pack: {pack_data['packCode']}...")
            # Ensure headers has Content-Type for JSON
            headers = self.headers.copy()
            headers['Content-Type'] = 'application/json'
            
            response = requests.post(url, headers=headers, json=pack_data)
            
            if response.status_code == 200:
                print("✅ Content Pack Created Successfully!")
                return True
            else:
                 print(f"❌ Create Pack Error {response.status_code}: {response.text}")
                 return False
                 
        except Exception as e:
             print(f"❌ Pack Exception: {e}")
             return False

    def export_project(self, project_dir, topic, content_type='story', pack_name=None):
        """Orchestrates the export of a project directory"""
        final_name = pack_name if pack_name else topic
        print(f"\n🚀 Starting Export for: {final_name}")
        
        # --- Generate Pack Code (max 8 chars for ESP32 compatibility) ---
        import random
        # Take first 2 letters from topic + 6 random digits = 8 chars max
        clean_topic = "".join(c for c in topic if c.isalpha())[:2].upper()
        if not clean_topic or len(clean_topic) < 2:
            clean_topic = "PK"  # Default prefix
        pack_code = f"{clean_topic}{random.randint(100000, 999999)}"  # e.g., "EL123456"
        # -----------------------------------------------------------------

        # Load plan.json to get text content for each step
        plan_data = {}
        plan_path = os.path.join(project_dir, "plan.json")
        if os.path.exists(plan_path):
            try:
                with open(plan_path, 'r', encoding='utf-8') as f:
                    plan_list = json.load(f)
                    # Convert to dict keyed by step number
                    for item in plan_list:
                        step_num = item.get('step')
                        if step_num:
                            plan_data[step_num] = item
                    print(f"📄 Loaded plan.json with {len(plan_data)} steps")
            except Exception as e:
                print(f"⚠️ Could not load plan.json: {e}")

        # 1. Scan directory for assets
        steps = []
        files = os.listdir(project_dir)
        
        # Assume files are named step_1_audio.mp3, step_1_image.png
        # We need to group them.
        sys_files = {} # Key: step_num
        
        # First pass: collect audio and .png files
        for f in files:
            if f.startswith('step_') and (f.endswith('.mp3') or f.endswith('.png')):
                parts = f.split('_')
                if len(parts) >= 2:
                    try:
                        step_num = int(parts[1])
                        if step_num not in sys_files: sys_files[step_num] = {}

                        if f.endswith('.mp3'): sys_files[step_num]['audio'] = os.path.join(project_dir, f)
                        if f.endswith('.png'): sys_files[step_num]['image'] = os.path.join(project_dir, f)
                    except:
                        pass

        # Second pass: .bin files override .png (preferred for ESP32)
        for f in files:
            if f.startswith('step_') and f.endswith('.bin'):
                parts = f.split('_')
                if len(parts) >= 2:
                    try:
                        step_num = int(parts[1])
                        if step_num not in sys_files: sys_files[step_num] = {}
                        sys_files[step_num]['image'] = os.path.join(project_dir, f)
                    except:
                        pass
        
        if not sys_files:
            print("⚠️ No valid step content found.")
            return False

        # 2. Upload Assets & Build Items
        pack_items = []
        
        sorted_steps = sorted(sys_files.keys())
        for step_num in sorted_steps:
            assets = sys_files[step_num]
            if 'audio' not in assets and 'image' not in assets:
                print(f"⚠️ Skipping Step {step_num}: No assets found.")
                continue

            print(f"--- Processing Step {step_num} ---")

            # Generate simple filenames: 01.mp3, 01.bin, 02.mp3, 02.bin, etc.
            step_prefix = f"{step_num:02d}"  # Zero-padded: 01, 02, 03...

            audio_url = None
            if 'audio' in assets:
                audio_filename = f"{step_prefix}.mp3"
                # PASS pack_code AS CATEGORY to force subfolder isolation
                audio_url = self.upload_file(assets['audio'], content_type, category=pack_code, custom_filename=audio_filename)

            image_url = None
            if 'image' in assets:
                # Determine extension from actual file
                img_ext = os.path.splitext(assets['image'])[1].lower()  # .bin or .png
                image_filename = f"{step_prefix}{img_ext}"
                image_url = self.upload_file(assets['image'], content_type, category=pack_code, custom_filename=image_filename)
            
            if audio_url or image_url:
                # Get text from plan.json if available
                step_info = plan_data.get(step_num, {})
                step_text = step_info.get('text', '')
                step_title = step_info.get('scene', f"Step {step_num}")  # Use scene as title if available

                pack_items.append({
                    "title": step_title if step_title else f"Step {step_num}",
                    "audioUrl": audio_url,
                    "imageUrl": image_url,
                    "text": step_text
                })
        
        if not pack_items:
            print("❌ No items could be prepared.")
            return False

        # 3. Create Pack
        
        payload = {
            "packCode": pack_code,
            "name": final_name,
            "description": f"AI Generated {content_type}: {final_name}",
            "contentType": content_type,  # 'story' or 'prompt' (check API enum)
            "language": "en",
            "active": True,
            "totalItems": len(pack_items),
            "items": pack_items
        }
        
        success = self.create_content_pack(payload)
        return pack_code if success else None

if __name__ == "__main__":
    # Test
    API_URL = "http://localhost:3000/api" # Adjust port 8002? Env var says 8002
    SECRET = "da11d988-f105-4e71-b095-da62ada82189"
    client = ManagerAPIClient(API_URL, SECRET)
    # client.export_project(r"d:\cheeko\cheeko-backend\content-poc\output\lunch", "Test Lunch")
