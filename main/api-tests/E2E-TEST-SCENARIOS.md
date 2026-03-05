# Cheeko E2E Test Scenarios

Comprehensive scenario-based end-to-end test plan for the Cheeko system.

## System Under Test

```
ESP32 Device --> MQTT Gateway --> LiveKit Cloud --> LiveKit Agent (AI)
                     |                                    |
                     v                                    v
              Manager API (Node.js) <--------------------+
                     |
                     v
              Manager Web (Vue.js Admin Dashboard)
```

---

## 1. Authentication & Authorization

| #   | Scenario                         | Services             | Steps                                                                                                                            | Expected Result                    |
| --- | -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1.1 | Admin login                      | Web, API, Supabase   | 1. POST `/toy/user/login` with valid credentials                                                                                 | 200 with JWT token                 |
| 1.2 | Invalid credentials rejected     | API, Supabase        | 1. POST `/toy/user/login` with wrong password                                                                                    | 401 Unauthorized                   |
| 1.3 | Token refresh                    | API, Supabase        | 1. Login and get JWT<br>2. Wait for expiry<br>3. POST `/toy/user/refresh` with refresh token                                     | New JWT returned                   |
| 1.4 | Service-to-service auth          | Agent, API           | 1. Call API with `SERVICE_SECRET_KEY` header                                                                                     | 200 with config data               |
| 1.5 | Firebase auth on content routes  | Mobile, API          | 1. GET `/toy/content/*` with valid Firebase token                                                                                | 200 with content data              |
| 1.6 | Unauthorized access blocked      | API                  | 1. GET protected route without token                                                                                             | 401 Unauthorized                   |
| 1.7 | Role-based access control        | Web, API             | 1. Login as regular user<br>2. Attempt admin-only operation                                                                      | 403 Forbidden                      |

---

## 2. Device Lifecycle

| #   | Scenario                           | Services        | Steps                                                                                                                          | Expected Result                        |
| --- | ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 2.1 | Register new device                | Web, API, DB    | 1. POST `/toy/device/save` with MAC address and device info                                                                    | 201 with device ID                     |
| 2.2 | Device config retrieval            | MQTT, API       | 1. ESP32 connects via MQTT<br>2. Gateway calls GET `/toy/agent/config/{mac}`                                                   | Config JSON with prompts, settings     |
| 2.3 | Update device settings             | Web, API, DB    | 1. PUT `/toy/device/update` with new settings<br>2. GET `/toy/agent/config/{mac}`                                              | Updated settings reflected             |
| 2.4 | Assign device to child profile     | API, DB         | 1. POST assign device to profile<br>2. GET device config                                                                       | Device linked to child profile         |
| 2.5 | Deactivate device                  | Web, API, DB    | 1. PUT deactivate device<br>2. ESP32 attempts connection                                                                       | Device marked inactive, connection rejected |
| 2.6 | Duplicate MAC registration         | API, DB         | 1. Register device with MAC<br>2. Register another device with same MAC                                                        | 409 Conflict                           |
| 2.7 | Device list with pagination/filter | Web, API        | 1. GET `/toy/device/list?page=1&size=10&search=XX`                                                                             | Paginated, filtered results            |

---

## 3. Voice Session (Core User Journey)

| #   | Scenario                          | Services                      | Steps                                                                                                                                | Expected Result                             |
| --- | --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 3.1 | Full conversation session         | ESP32, MQTT, Gateway, LiveKit, Agent | 1. Device connects<br>2. Audio sent via UDP<br>3. STT transcribes<br>4. LLM generates response<br>5. TTS synthesizes<br>6. Audio returned | Child hears AI response                     |
| 3.2 | Session start on device power-on  | MQTT, Gateway, LiveKit        | 1. ESP32 publishes MQTT connect message<br>2. Gateway creates LiveKit room                                                           | LiveKit room active, agent joins             |
| 3.3 | Session end on device disconnect  | MQTT, Gateway, LiveKit        | 1. ESP32 disconnects<br>2. Gateway detects disconnect                                                                                | LiveKit room closed, resources freed         |
| 3.4 | Agent reads child config          | Agent, API                    | 1. Agent starts<br>2. Calls GET `/toy/agent/config/{mac}`                                                                            | Age-appropriate prompts loaded               |
| 3.5 | Agent switches language           | Agent, TTS, STT               | 1. Mid-session language change request<br>2. Agent reconfigures TTS/STT                                                              | Response in new language                     |
| 3.6 | Session timeout cleanup           | Gateway, LiveKit              | 1. No audio for configured timeout period                                                                                            | Session ends gracefully, room closed         |
| 3.7 | Reconnection after drop           | ESP32, MQTT, Gateway          | 1. Device loses connection<br>2. Device reconnects within grace period                                                               | Session resumes without data loss            |

---

## 4. Game Modes

| #   | Scenario                         | Services          | Steps                                                                                                                              | Expected Result                         |
| --- | -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 4.1 | Start math game                  | Agent, Math Worker | 1. Child says "let's play math"<br>2. cheeko_worker routes to math_tutor_worker                                                   | Math questions begin at appropriate level |
| 4.2 | Play riddle game                 | Agent, Riddle Worker | 1. Child says "tell me a riddle"<br>2. Routes to riddle_solver_worker                                                            | Riddle presented, hints available        |
| 4.3 | Play word ladder                 | Agent, Word Worker | 1. Child says "word game"<br>2. Routes to word_ladder_worker                                                                      | Word ladder game starts                  |
| 4.4 | Game session analytics recorded  | Agent, API, DB    | 1. Game completes<br>2. Agent POST `/toy/analytics/game-session`                                                                   | Session with score, duration saved       |
| 4.5 | Age-appropriate difficulty       | Agent, API        | 1. Config has age=5 → easy questions<br>2. Config has age=14 → harder questions                                                    | Difficulty matches child age             |
| 4.6 | Game interruption and resume     | Agent             | 1. Child says "stop" mid-game<br>2. Returns to conversation<br>3. Child says "continue game"                                       | Game state preserved, resumes correctly  |

---

## 5. Content Management (Music, Stories, Textbooks)

| #    | Scenario                     | Services           | Steps                                                                                                                         | Expected Result                         |
| ---- | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 5.1  | Upload music content         | Web, API, Storage  | 1. Admin uploads audio file via dashboard<br>2. POST `/toy/content/music/save`                                                | File stored, DB record created           |
| 5.2  | Upload story content         | Web, API, Storage  | 1. Admin uploads story audio<br>2. POST `/toy/content/story/save`                                                             | File stored, DB record created           |
| 5.3  | Upload textbook content      | Web, API, Storage  | 1. Admin uploads textbook<br>2. POST `/toy/content/textbook/save`                                                             | File stored, DB record created           |
| 5.4  | Assign content to playlist   | Web, API, DB       | 1. Create playlist<br>2. Add content items to playlist                                                                        | Playlist contains content items          |
| 5.5  | Assign playlist to device    | Web, API, DB       | 1. Link playlist to device<br>2. GET device config                                                                            | Device config includes playlist          |
| 5.6  | Child requests a song        | Agent, media_api   | 1. Child says "play a song"<br>2. Agent calls media_api<br>3. Music bot plays                                                 | Audio streamed to device                 |
| 5.7  | Child requests a story       | Agent, media_api   | 1. Child says "tell me a story about space"<br>2. Agent calls media_api                                                       | Story audio streamed to device           |
| 5.8  | Content playback analytics   | Agent, API, DB     | 1. Content plays<br>2. Playback event recorded                                                                                | Playback entry with timestamp, duration  |
| 5.9  | Delete content               | Web, API, DB       | 1. Admin deletes content<br>2. Check playlist associations                                                                    | Content removed, playlist refs cleaned   |
| 5.10 | Semantic content search      | Agent, Qdrant      | 1. Child asks for "something about dinosaurs"<br>2. Vector search in Qdrant                                                   | Best matching content returned           |
| 5.11 | Bulk content import          | Web, API, DB       | 1. Admin uploads CSV/batch of content                                                                                         | All items created, errors reported       |

---

## 6. RFID Tag Management

| #   | Scenario                          | Services                 | Steps                                                                                                                    | Expected Result                          |
| --- | --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 6.1 | Register RFID tag                 | Web, API, DB             | 1. Admin creates RFID tag<br>2. Links tag to content                                                                     | Tag-content association created           |
| 6.2 | RFID scan triggers content        | ESP32, MQTT, Agent       | 1. Child scans RFID tag<br>2. MQTT message sent<br>3. Agent receives tag ID<br>4. Looks up linked content<br>5. Plays it | Correct content plays                     |
| 6.3 | RFID scan triggers series         | ESP32, MQTT, Agent, API  | 1. Tag linked to series<br>2. Child scans<br>3. Agent plays next episode in series                                       | Next unplayed episode plays               |
| 6.4 | Unregistered RFID scanned         | ESP32, MQTT, Agent       | 1. Child scans unknown tag<br>2. Agent looks up tag                                                                      | Agent responds "I don't know this card"   |
| 6.5 | Reassign RFID to different content | Web, API, DB            | 1. Admin changes tag's linked content<br>2. Child scans same tag                                                         | New content plays                         |
| 6.6 | RFID card dialog mutual exclusivity | Agent                  | 1. Scan card A (dialog opens)<br>2. Scan card B immediately                                                              | Card A dialog dismissed, card B takes over |

---

## 7. Child Profile & Personalization

| #   | Scenario                        | Services            | Steps                                                                                                                      | Expected Result                        |
| --- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 7.1 | Create child profile            | Web/Mobile, API, DB | 1. POST create profile with name, age, preferences                                                                         | Profile created with ID                |
| 7.2 | Update child age/preferences    | API, DB, Agent      | 1. Update profile age from 5 to 7<br>2. Next session loads updated config                                                  | Agent adjusts behavior to new age      |
| 7.3 | Memory recall                   | Agent, Memory       | 1. Child says "remember I like dinosaurs"<br>2. memory_write tool stores fact<br>3. Later session: memory_search retrieves  | Agent recalls preference               |
| 7.4 | Memory search                   | Agent, Memory       | 1. Agent needs context for conversation<br>2. Calls memory_search with query                                               | Relevant memories returned             |
| 7.5 | Fact extraction from conversation | Agent, Fact Extractor | 1. Child mentions "my dog's name is Max"<br>2. fact_extractor detects and stores                                         | Fact saved without explicit "remember"  |
| 7.6 | Daily memory curation           | Curator, Memory, DB | 1. Curation job runs<br>2. Raw daily memories → curated profile                                                            | Profile summary updated, duplicates merged |
| 7.7 | Per-device memory isolation     | Memory, SQLite      | 1. Device A stores memory<br>2. Device B searches same query                                                               | Device B does NOT see Device A's memories |

---

## 8. MQTT Gateway

| #   | Scenario                          | Services            | Steps                                                                                                                  | Expected Result                          |
| --- | --------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 8.1 | MQTT connection established       | ESP32, EMQX, Gateway | 1. ESP32 publishes connect message to EMQX<br>2. Gateway subscribes and handles                                       | Connection acknowledged                  |
| 8.2 | UDP audio stream                  | ESP32, Gateway      | 1. ESP32 sends Opus-encoded audio via UDP<br>2. Gateway decodes<br>3. Forwards to LiveKit                              | Audio received in LiveKit room            |
| 8.3 | Protocol conversion               | Gateway, LiveKit    | 1. MQTT message received<br>2. Gateway converts to WebSocket format<br>3. Sends to LiveKit                             | Message delivered correctly               |
| 8.4 | Multiple devices simultaneously   | Gateway             | 1. 10 devices connect<br>2. All send audio concurrently                                                                | No cross-talk, each device isolated       |
| 8.5 | Malformed MQTT message            | Gateway             | 1. Send invalid JSON on MQTT topic                                                                                     | Error logged, gateway doesn't crash       |
| 8.6 | Broker disconnection recovery     | EMQX, Gateway       | 1. EMQX broker restarts<br>2. Gateway detects disconnect                                                               | Gateway reconnects automatically          |
| 8.7 | Audio processing pipeline         | Gateway             | 1. Raw Opus audio received<br>2. opus-initializer decodes<br>3. worker-pool-manager processes                           | Processed audio forwarded to LiveKit      |

---

## 9. Admin Dashboard (manager-web)

| #   | Scenario                       | Services     | Steps                                                                                                                         | Expected Result                       |
| --- | ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 9.1 | Login and see dashboard        | Web, API     | 1. Enter credentials<br>2. Submit login form                                                                                  | Dashboard loads with stats            |
| 9.2 | CRUD devices                   | Web, API, DB | 1. List devices<br>2. Create new device<br>3. Edit device<br>4. Delete device                                                 | All CRUD operations succeed            |
| 9.3 | CRUD content                   | Web, API, DB | 1. Upload content<br>2. Edit metadata<br>3. Delete content                                                                    | All CRUD operations succeed            |
| 9.4 | CRUD users/profiles            | Web, API, DB | 1. Create child profile<br>2. Assign to device<br>3. Edit profile<br>4. Remove profile                                       | All CRUD operations succeed            |
| 9.5 | Manage AI models               | Web, API, DB | 1. Add AI model config<br>2. Set as default<br>3. Assign model to specific device                                             | Model config saved and applied         |
| 9.6 | View analytics                 | Web, API, DB | 1. Navigate to analytics<br>2. View game stats, usage graphs, session history                                                 | Charts render with correct data        |
| 9.7 | Manage TTS voices (timbre)     | Web, API, DB | 1. Select voice<br>2. Assign to device<br>3. Preview voice                                                                    | Voice config saved, preview plays      |
| 9.8 | System settings / dictionaries | Web, API, DB | 1. Update system config value<br>2. Verify change takes effect                                                                | Setting applied immediately            |
| 9.9 | Search and filter all entities | Web, API     | 1. Search devices by MAC<br>2. Filter content by type<br>3. Search users by name                                              | Correct filtered results returned      |

---

## 10. Analytics & Reporting

| #    | Scenario                      | Services       | Steps                                                                                                                    | Expected Result                          |
| ---- | ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 10.1 | Game session recorded         | Agent, API, DB | 1. Child plays math game<br>2. Game ends<br>3. POST analytics                                                            | Session with type, score, duration saved |
| 10.2 | Media playback tracked        | Agent, API, DB | 1. Song/story plays<br>2. Playback ends<br>3. POST analytics                                                             | Playback entry with timestamp, duration  |
| 10.3 | Usage stats aggregated        | API, DB        | 1. GET `/toy/analytics/usage?period=daily`                                                                               | Active devices, session count, avg duration |
| 10.4 | Per-child progress report     | API, DB        | 1. GET `/toy/analytics/child/{id}/progress`                                                                              | Game history, learning metrics, trends    |
| 10.5 | Admin views analytics dashboard | Web, API, DB | 1. Navigate to analytics page<br>2. Select date range                                                                    | Charts and tables render correctly        |

---

## 11. Error Handling & Edge Cases

| #     | Scenario                        | Services      | Steps                                                                                                                  | Expected Result                           |
| ----- | ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 11.1  | LLM provider down               | Agent         | 1. Groq/Google API unreachable<br>2. Child sends voice message                                                         | Graceful error message to child            |
| 11.2  | TTS provider down                | Agent         | 1. ElevenLabs unreachable<br>2. Agent tries TTS                                                                        | Fallback to Edge-TTS                       |
| 11.3  | Database connection lost         | API           | 1. Supabase unreachable<br>2. API receives request                                                                     | 503 Service Unavailable with retry info    |
| 11.4  | Qdrant unavailable               | Agent         | 1. Qdrant cluster down<br>2. Semantic search attempted                                                                 | Fallback to basic search or error message  |
| 11.5  | Concurrent config updates        | API, DB       | 1. Admin A updates device config<br>2. Admin B updates same device simultaneously                                      | No data corruption, last-write-wins or conflict |
| 11.6  | Large file upload                | API           | 1. Upload 100MB audio file                                                                                             | Handled if within limit, 413 if over       |
| 11.7  | XSS attempt in input             | API           | 1. Submit content name with `<script>alert('xss')</script>`                                                            | Input sanitized, script not executed       |
| 11.8  | SQL injection attempt            | API           | 1. Send `'; DROP TABLE devices; --` as query param                                                                     | Blocked by parameterized queries           |
| 11.9  | Rate limiting                    | API           | 1. Send 1000 requests/sec to same endpoint                                                                             | 429 Too Many Requests after threshold      |
| 11.10 | Invalid MAC format               | API           | 1. POST device with MAC `ZZZZZZ`                                                                                       | 400 Bad Request with validation error      |

---

## 12. Cross-Service Integration Scenarios

These are the highest-value E2E tests that validate the full system working together.

### 12.1 Full Child Interaction (Critical Path)

```
Precondition: Device registered, child profile assigned, content uploaded

1. ESP32 powers on
2. MQTT connect message → Gateway
3. Gateway creates LiveKit room
4. Agent joins room, calls GET /toy/agent/config/{mac}
5. Agent loads age-appropriate prompts
6. Child speaks → UDP audio → Gateway → LiveKit → STT
7. Transcribed text → LLM generates response
8. Response → TTS → audio back to device
9. Child says "remember I like robots"
10. memory_write stores fact
11. Child says "let's play math"
12. Math tutor worker activates
13. Game completes → analytics POST to API
14. Device disconnects → session cleanup

Verify: Config loaded, conversation works, memory stored, game played, analytics saved
```

### 12.2 Content Delivery Pipeline

```
Precondition: Admin logged in

1. Admin uploads music file via dashboard
2. API stores file, creates DB record
3. Admin creates playlist, adds music to it
4. Admin assigns playlist to device
5. Child says "play a song about space"
6. Agent does semantic search in Qdrant
7. Best match found from playlist
8. media_api streams audio to device
9. Playback event recorded in analytics

Verify: Content uploaded, playlist assigned, search works, playback tracked
```

### 12.3 RFID to Playback

```
Precondition: Device registered, RFID tag linked to story content

1. Admin creates RFID tag in dashboard
2. Admin links tag to story content
3. Child scans RFID tag on device
4. ESP32 sends RFID data via MQTT
5. Gateway forwards to Agent
6. Agent looks up tag → finds linked content
7. Content plays on device
8. Playback analytics recorded

Verify: Tag registered, scan detected, correct content plays, analytics saved
```

### 12.4 Profile-Aware Conversation

```
Precondition: Two child profiles (age 5 and age 14) on different devices

1. Admin sets Device A → child age 5
2. Admin sets Device B → child age 14
3. Device A session: Agent loads config → simple vocabulary, easy games
4. Device B session: Agent loads config → complex vocabulary, harder games
5. Device A: memory_write stores "likes trucks"
6. Device B: memory_write stores "likes physics"
7. Verify memories are isolated per device

Verify: Age-appropriate behavior, memory isolation
```

### 12.5 Multi-Device Household

```
Precondition: Two devices registered under same parent account

1. Device A connects → Session A created
2. Device B connects → Session B created
3. Both devices send audio simultaneously
4. Each gets independent AI responses
5. Game on Device A doesn't affect Device B
6. Analytics recorded separately for each

Verify: No cross-talk, independent sessions, separate analytics
```

---

## Test Priority Matrix

| Priority | Scenarios | Reason |
| -------- | --------- | ------ |
| P0 - Critical | 12.1, 2.1-2.3, 1.1-1.3 | Core product flow, basic functionality |
| P1 - High | 5.6-5.7, 6.2, 4.1-4.4, 12.2-12.3 | Primary features |
| P2 - Medium | 7.1-7.7, 8.1-8.4, 9.1-9.6, 10.1-10.3 | Supporting features |
| P3 - Low | 11.1-11.10, 8.5-8.7, 12.4-12.5 | Edge cases, resilience |

---

## Recommended Frameworks

| Layer | Framework | Purpose |
| ----- | --------- | ------- |
| API scenarios | Supertest + Jest | HTTP-based multi-step flows (extends existing `api-tests/`) |
| UI + API E2E | Playwright | Admin dashboard flows with API assertions |
| Python services | pytest + pytest-asyncio | Agent workers, memory system |
| MQTT simulation | MQTT.js + Jest | Device simulation, gateway testing |
| Environment | Docker Compose | Spin up all services for full E2E |

---

## Running Tests

```bash
# API scenario tests (existing infrastructure)
cd main/api-tests
npm test

# Playwright E2E (when set up)
npx playwright test

# Python agent tests
cd main/livekit-server
python -m pytest tests/

# Full E2E with Docker
docker-compose -f docker-compose.test.yml up -d
npm run test:e2e
```
