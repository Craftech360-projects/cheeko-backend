import asyncio
import os
from src.memory.mem0_provider import Mem0MemoryProvider
async def test():
    # 1. Clear existing memories
    provider = Mem0MemoryProvider(
        api_key="m0-tNiOs5lPRZMUGeNglTt9np3GBHt7EOIBZr3FbUtC",
        role_id="test_mac_address"
    )
    await provider.delete_all_memories()
    
    # 2. Add test conversation with junk
    test_conversation = {
        'messages': [
            {'role': 'user', 'content': 'um'},  # Should be filtered
            {'role': 'user', 'content': 'My favorite color is blue'},
            {'role': 'assistant', 'content': 'I like red'},  # Should NOT be saved as user fact
            {'role': 'user', 'content': 'I have a dog named Spot'}
        ]
    }
    await provider.save_memory(test_conversation, child_name="Alice")
    
    # 3. Retrieve and verify
    await asyncio.sleep(5)  # Wait for Mem0 processing
    memories = await provider.get_all_memories()
    print(f"Retrieved memories:\n{memories}")
    
    # Expected: Should contain "blue" and "Spot", NOT "um" or "red"
asyncio.run(test())