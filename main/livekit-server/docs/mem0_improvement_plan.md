# Mem0 Integration Improvement Plan

## Goal Description
Improve the Mem0 memory integration to enable the AI agent to provide highly personalized, non-generic answers for children (aged 4-12). The current implementation has two critical issues:
1. **Junk Data**: Saving too many irrelevant messages ("ok", "um", etc.).
2. **Agent Character Leakage**: The agent's responses are being extracted as child facts (e.g., if the agent says "I like red", Mem0 might save "User likes red").

## Memory Architecture

### Short-term Memory (Session Context)
- **What**: Last 10-20 conversation turns stored in-memory
- **Purpose**: "What did we just talk about?"
- **Example**: Child says "I want to hear a story about dogs" → Agent remembers "dogs" for follow-up questions
- **Implementation**: Already exists in `session.history` (LiveKit's ChatContext) and `conversation_messages` buffer

### Long-term Memory (Mem0)
- **What**: Permanent facts about the child across all sessions
- **Purpose**: "What do I know about this child?"
- **Example**: "Child's name is Alice, likes cats, favorite color is blue"
- **Implementation**: Mem0 cloud storage

### How They Work Together
1. **Start of Session**: Load long-term facts from Mem0 → Inject into system prompt
2. **During Session**: Use short-term memory for recent context
3. **End of Session**: Extract new facts from short-term → Save to long-term (Mem0)

## User Review Required
- [ ] **Approach Selection**: Choose between two approaches:
    - **Approach 1 (Simpler)**: Use Mem0's built-in extraction with custom instructions.
    - **Approach 2 (More Control)**: Add LLM pre-processing before sending to Mem0.
- [ ] **Switch to `get_all`**: Change retrieval strategy from `search("conversation history")` to `get_all(user_id)`.

---

## Proposed Changes

### Approach 1: Custom Instructions (Recommended - Simpler)

#### Memory Provider (`src/memory/mem0_provider.py`)
- [ ] **Add `get_all_memories`**: Implement using `client.get_all(user_id=...)`.
- [ ] **Add `delete_all_memories`**: Implement using `client.delete_all(user_id=...)`.
- [ ] **Fix Agent Character Leakage**:
    - Add explicit instructions in the system message:
      ```
      The user's name is {child_name}. Cheeko is the AI assistant.
      IMPORTANT: Extract facts and preferences ONLY from messages with role='user'.
      Do NOT extract facts from messages with role='assistant'.
      ```
- [ ] **Refine `save_memory` (Junk Prevention)**:
    - Filter out messages with less than 5 words.
    - Filter out common filler words ("ok", "yes", "no", "um", "ah").

---

### Approach 2: LLM Pre-processing (Optional - More Control)

#### Memory Provider (`src/memory/mem0_provider.py`)
- [ ] **Add `extract_facts_with_llm`**: New method that:
    1. Takes the conversation buffer.
    2. Sends it to Groq LLM with a prompt like:
       ```
       Extract only the child's facts from this conversation.
       Child's name: {child_name}
       Conversation: {messages}
       Output format: Bullet points of facts about the child only.
       ```
    3. Returns the extracted facts as a clean string.
- [ ] **Update `save_memory`**: Instead of sending raw messages, send the LLM-extracted facts.
- [ ] **Add `get_all_memories`**: Same as Approach 1.
- [ ] **Add `delete_all_memories`**: Same as Approach 1.

---

### Common Changes (Both Approaches)

### Main Agent (`main.py`)
- [ ] **Switch to `get_all_memories`**: In `query_mem0_memories`, replace the `query_memory` call with `get_all_memories`.
- [ ] **Enhanced Prompt Injection**:
    - Change the injection format to be more explicit:
      ```text
      <user_profile>
      Here is what I know about the child:
      {memories}
      </user_profile>
      IMPORTANT: Use these facts to personalize the conversation. Ask about their specific interests, pets, or friends mentioned in the profile.
      ```
- [ ] **Logging**: Add debug logging to see exactly what facts are being retrieved.

## Verification Plan
### Automated Verification
- [ ] **`test_mem0.py`**: Create a script to:
    1.  **Clear Memories**: Call `delete_all_memories` to start fresh.
    2.  **Add Conversation**: Add a sample conversation with some "junk" (e.g., "Um", "Ah") and some facts ("I like red").
    3.  **Verify Extraction**: Call `get_all()` and ensure only "likes red" is saved, not "Um".

### Manual Verification
- [ ] **Test Run**: Start the agent.
- [ ] **Speak**: "My favorite color is green."
- [ ] **Wait**: Wait for the periodic save (or trigger it).
- [ ] **Restart**: Restart agent.
- [ ] **Verify**: Check logs to see if "green" is in the injected prompt and junk is minimized.
