from exporters import ManagerAPIClient
import os

def test():
    # Configuration
    API_URL = "http://localhost:8002/toy"
    SECRET = "da11d988-f105-4e71-b095-da62ada82189"
    
    # Path to a real folder we checked
    TEST_DIR = r"d:\cheeko\cheeko-backend\content-poc\output\Bedtime_Routine"
    TOPIC = "Bedtime Routine API Test"
    
    print(f"🧪 Testing Export Logic with: {TEST_DIR}")
    
    client = ManagerAPIClient(API_URL, SECRET)
    
    # Run export
    pack_code = client.export_project(TEST_DIR, TOPIC, content_type='story')
    
    if pack_code:
        print(f"\n✅ TEST PASSED: Pack Created -> {pack_code}")
    else:
        print("\n❌ TEST FAILED")

if __name__ == "__main__":
    test()
