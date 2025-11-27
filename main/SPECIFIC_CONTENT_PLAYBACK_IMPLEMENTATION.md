# Specific Content Playback Implementation Guide

## Overview

This document outlines the implementation for playing specific songs or stories on demand via MQTT messages, while maintaining the existing playlist flow. The system allows mobile apps or external clients to request specific content by name, which will interrupt current playback, play the requested content, and then resume the original playlist.

## Architecture Overview

```
Mobile App/Client
       ↓ (MQTT Message)
    EMQX Broker
       ↓ (Republish with client info)
    MQTT Gateway (approom.js)
       ↓ (Device lookup & validation)
    LiveKit Room (Data Channel)
       ↓ (Message forwarding)
    Music/Story Bot (media_api.py)
       ↓ (Content interrupt & play)
    Audio Streaming
```

## Message Format Specification

### For Music Content

```json
{
  "type": "function_call",
  "function_call": {
    "name": "play_music",
    "arguments": {
      "song_name": "Happy Birthday",
      "language": "English",
      "loop_enabled": false,
      "content_type": "music"
    }
  },
  "source": "mobile_app",
  "session_id": "AA:BB:CC:DD:EE:FF"
}
```

### For Story Content

```json
{
  "type": "function_call",
  "function_call": {
    "name": "play_story",
    "arguments": {
      "story_name": "The Three Little Pigs",
      "category": "Fairy Tales",
      "loop_enabled": false,
      "content_type": "story"
    }
  },
  "source": "mobile_app",
  "session_id": "AA:BB:CC:DD:EE:FF"
}
```

### Message Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be "function_call" |
| `function_call.name` | string | Yes | "play_music" or "play_story" |
| `function_call.arguments.song_name` | string | Yes (music) | Name of the song to play |
| `function_call.arguments.story_name` | string | Yes (story) | Name of the story to play |
| `function_call.arguments.language` | string | Optional | Language filter for music |
| `function_call.arguments.category` | string | Optional | Category filter for stories |
| `function_call.arguments.loop_enabled` | boolean | Optional | Whether to loop the specific content |
| `function_call.arguments.content_type` | string | Yes | "music" or "story" |
| `source` | string | Yes | "mobile_app" or other identifier |
| `session_id` | string | Yes | Device MAC address (AA:BB:CC:DD:EE:FF) |

## Implementation Details

### Phase 1: MQTT Gateway Enhancement (approom.js)

#### 1.1 Message Detection and Routing

Add enhanced message detection in the `handleMqttMessage()` function:

```javascript
// In handleMqttMessage() function, add after existing function_call handling
if (originalPayload.type === "function_call") {
  const functionName = originalPayload.function_call?.name;
  
  if (functionName === "play_music") {
    console.log(`🎵 [SPECIFIC-MUSIC] Music request from ${deviceId}`);
    await this.handleSpecificMusicRequest(deviceId, originalPayload, clientId);
    return;
  } else if (functionName === "play_story") {
    console.log(`📖 [SPECIFIC-STORY] Story request from ${deviceId}`);
    await this.handleSpecificStoryRequest(deviceId, originalPayload, clientId);
    return;
  }
}
```

#### 1.2 Music Request Handler

```javascript
async handleSpecificMusicRequest(deviceId, payload, clientId = null) {
  try {
    const macAddress = payload.session_id;
    const songName = payload.function_call.arguments.song_name;
    const language = payload.function_call.arguments.language;
    
    console.log(`🎵 [SPECIFIC-MUSIC] Request for device: ${macAddress}`);
    console.log(`🎵 [SPECIFIC-MUSIC] Song: "${songName}", Language: ${language || 'Any'}`);
    
    // Find device connection using MAC address
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo || !deviceInfo.connection) {
      console.warn(`⚠️ [SPECIFIC-MUSIC] Device not connected: ${macAddress}`);
      await this.sendErrorResponse(clientId, "Device not connected", macAddress);
      return;
    }
    
    // Validate device is in music mode
    if (deviceInfo.currentMode !== "music") {
      console.warn(`⚠️ [SPECIFIC-MUSIC] Device ${macAddress} not in music mode (current: ${deviceInfo.currentMode})`);
      await this.sendErrorResponse(clientId, `Device is in ${deviceInfo.currentMode} mode, not music mode`, macAddress);
      return;
    }
    
    // Forward to LiveKit room via data channel
    const connection = deviceInfo.connection;
    if (connection.bridge && connection.bridge.room && connection.bridge.room.localParticipant) {
      await this.forwardSpecificContentRequest(connection.bridge.room, {
        type: "specific_content_request",
        content_type: "music",
        content_name: songName,
        language: language,
        loop_enabled: payload.function_call.arguments.loop_enabled || false,
        source: payload.source,
        session_id: macAddress,
        timestamp: Date.now()
      });
      
      console.log(`✅ [SPECIFIC-MUSIC] Request forwarded to LiveKit room for ${macAddress}`);
      
      // Send acknowledgment to mobile app
      await this.sendSuccessResponse(clientId, `Playing "${songName}"`, macAddress);
      
    } else {
      console.error(`❌ [SPECIFIC-MUSIC] No active LiveKit room for device: ${macAddress}`);
      await this.sendErrorResponse(clientId, "No active audio session", macAddress);
    }
    
  } catch (error) {
    console.error(`❌ [SPECIFIC-MUSIC] Error processing request: ${error.message}`);
    await this.sendErrorResponse(clientId, "Failed to process music request", payload.session_id);
  }
}
```

#### 1.3 Story Request Handler

```javascript
async handleSpecificStoryRequest(deviceId, payload, clientId = null) {
  try {
    const macAddress = payload.session_id;
    const storyName = payload.function_call.arguments.story_name;
    const category = payload.function_call.arguments.category;
    
    console.log(`📖 [SPECIFIC-STORY] Request for device: ${macAddress}`);
    console.log(`📖 [SPECIFIC-STORY] Story: "${storyName}", Category: ${category || 'Any'}`);
    
    // Find device connection using MAC address
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo || !deviceInfo.connection) {
      console.warn(`⚠️ [SPECIFIC-STORY] Device not connected: ${macAddress}`);
      await this.sendErrorResponse(clientId, "Device not connected", macAddress);
      return;
    }
    
    // Validate device is in story mode
    if (deviceInfo.currentMode !== "story") {
      console.warn(`⚠️ [SPECIFIC-STORY] Device ${macAddress} not in story mode (current: ${deviceInfo.currentMode})`);
      await this.sendErrorResponse(clientId, `Device is in ${deviceInfo.currentMode} mode, not story mode`, macAddress);
      return;
    }
    
    // Forward to LiveKit room via data channel
    const connection = deviceInfo.connection;
    if (connection.bridge && connection.bridge.room && connection.bridge.room.localParticipant) {
      await this.forwardSpecificContentRequest(connection.bridge.room, {
        type: "specific_content_request",
        content_type: "story",
        content_name: storyName,
        category: category,
        loop_enabled: payload.function_call.arguments.loop_enabled || false,
        source: payload.source,
        session_id: macAddress,
        timestamp: Date.now()
      });
      
      console.log(`✅ [SPECIFIC-STORY] Request forwarded to LiveKit room for ${macAddress}`);
      
      // Send acknowledgment to mobile app
      await this.sendSuccessResponse(clientId, `Playing "${storyName}"`, macAddress);
      
    } else {
      console.error(`❌ [SPECIFIC-STORY] No active LiveKit room for device: ${macAddress}`);
      await this.sendErrorResponse(clientId, "No active audio session", macAddress);
    }
    
  } catch (error) {
    console.error(`❌ [SPECIFIC-STORY] Error processing request: ${error.message}`);
    await this.sendErrorResponse(clientId, "Failed to process story request", payload.session_id);
  }
}
```

#### 1.4 LiveKit Data Channel Forwarding

```javascript
async forwardSpecificContentRequest(room, requestData) {
  try {
    const messageString = JSON.stringify(requestData);
    const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
    
    await room.localParticipant.publishData(messageData, {
      reliable: true,
      topic: "specific_content"
    });
    
    console.log(`📡 [DATA-CHANNEL] Forwarded specific content request to LiveKit room`);
    console.log(`📡 [DATA-CHANNEL] Content: ${requestData.content_name} (${requestData.content_type})`);
    
  } catch (error) {
    console.error(`❌ [DATA-CHANNEL] Failed to forward request: ${error.message}`);
    throw error;
  }
}
```

#### 1.5 Response Helpers

```javascript
async sendSuccessResponse(clientId, message, macAddress) {
  if (!clientId) return;
  
  const successMessage = {
    type: "specific_content_response",
    status: "success",
    message: message,
    device_mac: macAddress,
    timestamp: Date.now()
  };
  
  this.publishToDevice(clientId, successMessage);
  console.log(`✅ [RESPONSE] Success sent to ${macAddress}: ${message}`);
}

async sendErrorResponse(clientId, errorMessage, macAddress) {
  if (!clientId) return;
  
  const errorResponse = {
    type: "specific_content_response",
    status: "error",
    message: errorMessage,
    device_mac: macAddress,
    timestamp: Date.now()
  };
  
  this.publishToDevice(clientId, errorResponse);
  console.log(`❌ [RESPONSE] Error sent to ${macAddress}: ${errorMessage}`);
}
```

### Phase 2: LiveKit Bridge Enhancement (media_api.py)

#### 2.1 Data Channel Message Handler

Add to the existing data channel handler in `LiveKitBridge` class:

```python
# In the existing RoomEvent.DataReceived handler, add new case:
case "specific_content_request":
    console.log(f"🎯 [SPECIFIC-CONTENT] Request received: {data.content_type}")
    await self.handleSpecificContentRequest(data)
    break
```

#### 2.2 Specific Content Request Handler

```python
async def handleSpecificContentRequest(self, request_data):
    """Handle specific content request from mobile app via data channel"""
    try:
        content_type = request_data.get('content_type')
        content_name = request_data.get('content_name')
        
        logger.info(f"🎯 [SPECIFIC-CONTENT] Processing {content_type} request: {content_name}")
        
        # Find the active bot for this room
        room_name = self.room.name if self.room else None
        if not room_name or room_name not in active_bots:
            logger.error(f"❌ [SPECIFIC-CONTENT] No active bot found for room: {room_name}")
            return
        
        bot = active_bots[room_name]
        
        if content_type == "music" and isinstance(bot, MusicBot):
            await self.handleSpecificMusicRequest(bot, request_data)
        elif content_type == "story" and isinstance(bot, StoryBot):
            await self.handleSpecificStoryRequest(bot, request_data)
        else:
            logger.error(f"❌ [SPECIFIC-CONTENT] Bot type mismatch or invalid content type")
            logger.error(f"   Content type: {content_type}, Bot type: {type(bot).__name__}")
            
    except Exception as e:
        logger.error(f"❌ [SPECIFIC-CONTENT] Error handling request: {e}")
        import traceback
        logger.error(f"❌ [SPECIFIC-CONTENT] Traceback: {traceback.format_exc()}")

async def handleSpecificMusicRequest(self, music_bot, request_data):
    """Handle specific music request"""
    try:
        song_name = request_data.get('content_name')
        language = request_data.get('language')
        loop_enabled = request_data.get('loop_enabled', False)
        
        logger.info(f"🎵 [SPECIFIC-MUSIC] Requesting song: {song_name}, Language: {language}")
        
        # Search for the song in the database
        song_info = await self.findSongInDatabase(song_name, language)
        
        if song_info:
            # Request the bot to play this specific song
            await music_bot.playSpecificContent(song_info, loop_enabled)
            logger.info(f"✅ [SPECIFIC-MUSIC] Successfully queued: {song_name}")
        else:
            logger.warning(f"⚠️ [SPECIFIC-MUSIC] Song not found: {song_name}")
            # Could send error response back via data channel if needed
            
    except Exception as e:
        logger.error(f"❌ [SPECIFIC-MUSIC] Error: {e}")

async def handleSpecificStoryRequest(self, story_bot, request_data):
    """Handle specific story request"""
    try:
        story_name = request_data.get('content_name')
        category = request_data.get('category')
        loop_enabled = request_data.get('loop_enabled', False)
        
        logger.info(f"📖 [SPECIFIC-STORY] Requesting story: {story_name}, Category: {category}")
        
        # Search for the story in the database
        story_info = await self.findStoryInDatabase(story_name, category)
        
        if story_info:
            # Request the bot to play this specific story
            await story_bot.playSpecificContent(story_info, loop_enabled)
            logger.info(f"✅ [SPECIFIC-STORY] Successfully queued: {story_name}")
        else:
            logger.warning(f"⚠️ [SPECIFIC-STORY] Story not found: {story_name}")
            # Could send error response back via data channel if needed
            
    except Exception as e:
        logger.error(f"❌ [SPECIFIC-STORY] Error: {e}")

async def findSongInDatabase(self, song_name, language=None):
    """Search for song in music database"""
    try:
        # Use the music service to search for the song
        # This assumes you have a search method in MusicService
        songs = await music_service.searchSongsByName(song_name, language)
        
        if songs and len(songs) > 0:
            return songs[0]  # Return first match
        return None
        
    except Exception as e:
        logger.error(f"❌ [DB-SEARCH] Error searching for song '{song_name}': {e}")
        return None

async def findStoryInDatabase(self, story_name, category=None):
    """Search for story in story database"""
    try:
        # Use the story service to search for the story
        # This assumes you have a search method in StoryService
        stories = await story_service.searchStoriesByName(story_name, category)
        
        if stories and len(stories) > 0:
            return stories[0]  # Return first match
        return None
        
    except Exception as e:
        logger.error(f"❌ [DB-SEARCH] Error searching for story '{story_name}': {e}")
        return None
```

### Phase 3: Bot Enhancement (media_api.py)

#### 3.1 MusicBot Specific Content Support

```python
# Add to MusicBot class
async def playSpecificContent(self, content_info, loop_enabled=False):
    """Play specific content immediately, interrupting current playback"""
    async with self.skip_lock:
        logger.info(f"🎯 [MUSIC-SPECIFIC] Queuing specific song: {content_info.get('title', 'Unknown')}")
        
        # Store the specific content to play
        self.specific_content_queue = {
            'content_info': content_info,
            'loop_enabled': loop_enabled,
            'type': 'mobile_request'
        }
        
        # Interrupt current playback
        self.skip_requested = True
        self.skip_direction = 'specific_content'
        
        logger.info(f"🎯 [MUSIC-SPECIFIC] Current playback will be interrupted")

# Modify the _run_playlist_mode method to handle specific content
async def _run_playlist_mode(self):
    """Run playlist mode with looping and specific content support"""
    while not self.should_stop:
        # Check if we need to play specific content first
        if hasattr(self, 'specific_content_queue') and self.specific_content_queue:
            logger.info("🎯 [MUSIC-SPECIFIC] Playing specific content before continuing playlist")
            
            content_info = self.specific_content_queue['content_info']
            loop_enabled = self.specific_content_queue['loop_enabled']
            self.specific_content_queue = None  # Clear after use
            
            # Extract content details
            title = content_info.get('title', 'Unknown Song')
            filename = content_info.get('filename')
            language = content_info.get('language')
            
            if filename and language:
                song_url = music_service.get_song_url(filename, language)
                logger.info(f"🎯 [MUSIC-SPECIFIC] Playing: '{title}' ({language})")
                
                # Reset skip flag before streaming
                async with self.skip_lock:
                    self.skip_requested = False
                    self.skip_direction = None
                
                # Stream the specific content
                if loop_enabled:
                    # Loop the specific content until interrupted
                    while not self.should_stop and not self.skip_requested:
                        await self._stream_song(song_url, title)
                        if not self.should_stop and not self.skip_requested:
                            await asyncio.sleep(1)  # Small gap between loops
                else:
                    # Play once
                    await self._stream_song(song_url, title)
                
                logger.info(f"🎯 [MUSIC-SPECIFIC] Finished streaming: '{title}'")
                
                # After specific content, continue with normal playlist flow
                if self.should_stop:
                    break
                
                # Small gap before continuing playlist
                await asyncio.sleep(1)
            else:
                logger.error(f"🎯 [MUSIC-SPECIFIC] Invalid content info: {content_info}")
            
            # Continue to next iteration to play normal playlist
            continue
        
        # ... rest of existing playlist logic remains the same ...
```

#### 3.2 StoryBot Specific Content Support

```python
# Add to StoryBot class (similar to MusicBot)
async def playSpecificContent(self, content_info, loop_enabled=False):
    """Play specific story immediately, interrupting current playback"""
    async with self.skip_lock:
        logger.info(f"🎯 [STORY-SPECIFIC] Queuing specific story: {content_info.get('title', 'Unknown')}")
        
        # Store the specific content to play
        self.specific_content_queue = {
            'content_info': content_info,
            'loop_enabled': loop_enabled,
            'type': 'mobile_request'
        }
        
        # Interrupt current playback
        self.skip_requested = True
        self.skip_direction = 'specific_content'
        
        logger.info(f"🎯 [STORY-SPECIFIC] Current playback will be interrupted")

# Similar modifications to _run_playlist_mode for StoryBot
# (Replace music_service with story_service and adjust logging)
```

### Phase 4: Database Search Implementation

#### 4.1 Music Service Search Method

```python
# Add to MusicService class or as extension
async def searchSongsByName(self, song_name, language=None):
    """Search for songs by name in the database"""
    try:
        search_query = song_name.lower().strip()
        
        # Example implementation using Qdrant vector search
        # You'll need to adapt this to your actual database structure
        
        if self.qdrant_client and self.embedding_model:
            # Create embedding for search query
            query_embedding = await self.embedding_model.encode(search_query)
            
            # Search in music collection
            search_results = await self.qdrant_client.search(
                collection_name="music_collection",
                query_vector=query_embedding,
                limit=10,
                score_threshold=0.7  # Adjust based on your needs
            )
            
            # Filter by language if specified
            filtered_results = []
            for result in search_results:
                payload = result.payload
                
                # Check if title matches (fuzzy matching)
                title = payload.get('title', '').lower()
                if search_query in title or title in search_query:
                    # Check language filter
                    if language is None or payload.get('language', '').lower() == language.lower():
                        filtered_results.append({
                            'title': payload.get('title'),
                            'filename': payload.get('filename'),
                            'language': payload.get('language'),
                            'artist': payload.get('artist'),
                            'duration': payload.get('duration'),
                            'score': result.score
                        })
            
            # Sort by relevance score
            filtered_results.sort(key=lambda x: x['score'], reverse=True)
            
            logger.info(f"🔍 [MUSIC-SEARCH] Found {len(filtered_results)} matches for '{song_name}'")
            return filtered_results
            
        else:
            logger.warning("🔍 [MUSIC-SEARCH] Database not available for search")
            return []
            
    except Exception as e:
        logger.error(f"❌ [MUSIC-SEARCH] Error searching for '{song_name}': {e}")
        return []
```

#### 4.2 Story Service Search Method

```python
# Add to StoryService class or as extension
async def searchStoriesByName(self, story_name, category=None):
    """Search for stories by name in the database"""
    try:
        search_query = story_name.lower().strip()
        
        # Similar implementation to music search
        if self.qdrant_client and self.embedding_model:
            query_embedding = await self.embedding_model.encode(search_query)
            
            search_results = await self.qdrant_client.search(
                collection_name="story_collection",
                query_vector=query_embedding,
                limit=10,
                score_threshold=0.7
            )
            
            filtered_results = []
            for result in search_results:
                payload = result.payload
                
                title = payload.get('title', '').lower()
                if search_query in title or title in search_query:
                    if category is None or payload.get('category', '').lower() == category.lower():
                        filtered_results.append({
                            'title': payload.get('title'),
                            'filename': payload.get('filename'),
                            'category': payload.get('category'),
                            'age_group': payload.get('age_group'),
                            'duration': payload.get('duration'),
                            'score': result.score
                        })
            
            filtered_results.sort(key=lambda x: x['score'], reverse=True)
            
            logger.info(f"🔍 [STORY-SEARCH] Found {len(filtered_results)} matches for '{story_name}'")
            return filtered_results
            
        else:
            logger.warning("🔍 [STORY-SEARCH] Database not available for search")
            return []
            
    except Exception as e:
        logger.error(f"❌ [STORY-SEARCH] Error searching for '{story_name}': {e}")
        return []
```

## Flow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Mobile App    │    │   EMQX Broker    │    │  MQTT Gateway   │
│                 │    │                  │    │   (approom.js)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │ 1. MQTT Message        │                        │
         │ (play_music/story)     │                        │
         ├────────────────────────┤                        │
         │                        │ 2. Republish with     │
         │                        │    client info         │
         │                        ├────────────────────────┤
         │                        │                        │
         │                        │                        │ 3. Extract MAC
         │                        │                        │    Find device
         │                        │                        │    Validate mode
         │                        │                        │
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  LiveKit Room   │    │   Music/Story    │    │   Audio Stream  │
│  (Data Channel) │    │   Bot            │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │ 4. Forward request     │                        │
         │    via data channel    │                        │
         ├────────────────────────┤                        │
         │                        │ 5. Interrupt current  │
         │                        │    playback & queue    │
         │                        │    specific content    │
         │                        ├────────────────────────┤
         │                        │                        │ 6. Stream specific
         │                        │                        │    content, then
         │                        │                        │    resume playlist
```

## Error Handling

### Error Scenarios and Responses

| Scenario | Error Response | Action |
|----------|----------------|--------|
| Device not connected | "Device not connected" | Send error via MQTT |
| Wrong mode (music req to story device) | "Device is in story mode, not music mode" | Send error via MQTT |
| Content not found | "Song/Story not found in database" | Send error via MQTT |
| No active bot | "No active audio session" | Send error via MQTT |
| Database error | "Failed to search content" | Log error, send generic error |
| LiveKit room error | "Failed to process request" | Log error, send generic error |

### Response Message Format

#### Success Response
```json
{
  "type": "specific_content_response",
  "status": "success",
  "message": "Playing \"Happy Birthday\"",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "timestamp": 1640995200000
}
```

#### Error Response
```json
{
  "type": "specific_content_response",
  "status": "error",
  "message": "Device is in conversation mode, not music mode",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "timestamp": 1640995200000
}
```

## Testing Strategy

### Test Cases

#### Music Content Tests
1. **Valid Music Request**
   - Device in music mode
   - Song exists in database
   - Expected: Song plays immediately, playlist resumes after

2. **Invalid Mode Test**
   - Device in story/conversation mode
   - Send music request
   - Expected: Error response "Device is in X mode, not music mode"

3. **Song Not Found Test**
   - Device in music mode
   - Request non-existent song
   - Expected: Error response "Song not found in database"

4. **Device Not Connected Test**
   - Send request for disconnected device
   - Expected: Error response "Device not connected"

#### Story Content Tests
1. **Valid Story Request**
   - Device in story mode
   - Story exists in database
   - Expected: Story plays immediately, playlist resumes after

2. **Invalid Mode Test**
   - Device in music/conversation mode
   - Send story request
   - Expected: Error response "Device is in X mode, not story mode"

3. **Story Not Found Test**
   - Device in story mode
   - Request non-existent story
   - Expected: Error response "Story not found in database"

#### Edge Cases
1. **Multiple Rapid Requests**
   - Send multiple requests quickly
   - Expected: Latest request takes priority

2. **Request During Specific Content**
   - Send request while specific content is playing
   - Expected: Current specific content stops, new content starts

3. **Loop Enabled Test**
   - Send request with loop_enabled: true
   - Expected: Content loops until interrupted

### Testing Tools

#### MQTT Test Messages

**Music Test Message:**
```bash
mosquitto_pub -h your-emqx-broker -t "devices/AA:BB:CC:DD:EE:FF/data" -m '{
  "type": "function_call",
  "function_call": {
    "name": "play_music",
    "arguments": {
      "song_name": "Happy Birthday",
      "language": "English",
      "loop_enabled": false,
      "content_type": "music"
    }
  },
  "source": "mobile_app",
  "session_id": "AA:BB:CC:DD:EE:FF"
}'
```

**Story Test Message:**
```bash
mosquitto_pub -h your-emqx-broker -t "devices/AA:BB:CC:DD:EE:FF/data" -m '{
  "type": "function_call",
  "function_call": {
    "name": "play_story",
    "arguments": {
      "story_name": "The Three Little Pigs",
      "category": "Fairy Tales",
      "loop_enabled": false,
      "content_type": "story"
    }
  },
  "source": "mobile_app",
  "session_id": "AA:BB:CC:DD:EE:FF"
}'
```

## Deployment Checklist

### Prerequisites
- [ ] EMQX broker configured with republish rules
- [ ] MQTT Gateway (approom.js) running
- [ ] LiveKit server running
- [ ] Music/Story bots functional
- [ ] Database with searchable content

### Implementation Steps
1. [ ] Update MQTT Gateway with new message handlers
2. [ ] Update LiveKit Bridge with data channel handlers
3. [ ] Update Music/Story bots with specific content support
4. [ ] Implement database search methods
5. [ ] Test with sample MQTT messages
6. [ ] Verify error handling
7. [ ] Test mobile app integration

### Monitoring and Logging

Key log messages to monitor:
- `🎯 [SPECIFIC-MUSIC/STORY]` - Specific content requests
- `✅ [RESPONSE]` - Successful responses
- `❌ [RESPONSE]` - Error responses
- `🔍 [MUSIC/STORY-SEARCH]` - Database search results
- `📡 [DATA-CHANNEL]` - LiveKit data channel forwarding

## Performance Considerations

### Optimization Points
1. **Database Search**: Implement caching for frequent searches
2. **Content Interruption**: Minimize delay between interrupt and new content
3. **Memory Management**: Clear specific content queue after use
4. **Error Recovery**: Graceful fallback to playlist if specific content fails

### Scalability
- System supports multiple concurrent devices
- Each device maintains independent specific content queue
- No shared state between devices
- Horizontal scaling possible with multiple gateway instances

## Security Considerations

### Input Validation
- Validate MAC address format in session_id
- Sanitize song/story names for database queries
- Limit search query length
- Validate content_type field

### Access Control
- Verify device ownership via MAC address
- Rate limiting for specific content requests
- Audit logging for content requests

This implementation provides a robust, scalable solution for on-demand content playback while maintaining the existing playlist functionality and system architecture.