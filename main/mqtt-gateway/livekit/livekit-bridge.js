/**
 * LiveKit Bridge
 * 
 * Manages LiveKit room connections for each device.
 * Handles audio resampling, frame buffering, and agent communication.
 */

const { EventEmitter } = require('events');
const JSON5 = require('json5');
const {
  Room,
  RoomEvent,
  AudioSource,
  AudioStream,
  AudioFrame,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  TrackKind,
  AudioResampler,
  AudioResamplerQuality,
} = require('@livekit/rtc-node');
const { AccessToken } = require('livekit-server-sdk');
const { WorkerPoolManager } = require('../core/worker-pool-manager');
const { OUTGOING_SAMPLE_RATE, INCOMING_SAMPLE_RATE, CHANNELS } = require('../constants/audio');

// Global config manager reference (injected by app.js)
let configManager = null;

function setConfigManager(cm) {
  configManager = cm;
}
class LiveKitBridge extends EventEmitter {
  constructor(connection, protocolVersion, macAddress, uuid, userData) {
    super();
    this.connection = connection;
    this.macAddress = macAddress;
    this.uuid = uuid;
    this.userData = userData;
    this.roomType = connection.roomType || "conversation"; // ADD: Store room type from connection
    this.room = null;
    this.roomService = null; // Store roomService for cleanup on disconnect
    this.roomName = null; // Store room name for deletion on disconnect
    this.audioSource = new AudioSource(16000, 1);
    this.protocolVersion = protocolVersion;
    this.isAudioPlaying = false; // Track if audio is actively playing
    this.audioPlayingStartTime = null; // Track when audio started playing (for stuck detection)
    this.stopAudioForwarding = false; // Flag to stop audio forwarding during mode switch

    // Add agent join tracking
    this.agentJoined = false;
    this.greetingSent = false;  // Track if greeting has been sent
    this.agentJoinPromise = null;
    this.agentJoinResolve = null;
    this.agentJoinTimeout = null;

    // Create a promise that resolves when agent joins
    this.agentJoinPromise = new Promise((resolve) => {
      this.agentJoinResolve = resolve;
    });

    // MCP request tracking for async responses
    this.pendingMcpRequests = new Map();
    this.mcpRequestCounter = 1;

    // Volume adjustment queue for request serialization
    this.volumeAdjustmentQueue = [];
    this.isAdjustingVolume = false;
    this.lastKnownVolume = null; // Optimistic volume tracking
    this.volumeDebounceTimer = null; // Debounce timer for volume changes
    this.pendingVolumeAction = null; // Accumulator for debounced volume actions

    // Initialize audio resampler for 48kHz -> 24kHz conversion (outgoing: LiveKit -> ESP32)
    this.audioResampler = new AudioResampler(
      48000,
      24000,
      1,
      AudioResamplerQuality.QUICK
    );

    // Frame buffer for accumulating resampled audio into proper frame sizes
    this.frameBuffer = Buffer.alloc(0);
    this.targetFrameSize = 1440; // 1440 samples = 60ms at 24kHz (outgoing)
    this.targetFrameBytes = this.targetFrameSize * 2; // 2880 bytes for 16-bit PCM

    // PHASE 2: Initialize Worker Pool for parallel audio processing
    this.workerPool = new WorkerPoolManager(4); // Start with minWorkers (4) for proper scaling
    // console.log(`✅ [PHASE-2] Worker pool initialized for ${this.macAddress}`);

    // Initialize workers with encoder/decoder settings
    this.workerPool
      .initializeWorker("init_encoder", {
        sampleRate: OUTGOING_SAMPLE_RATE,
        channels: CHANNELS,
      })
      .then(() => {
        // console.log(`✅ [PHASE-2] Workers encoder ready (${OUTGOING_SAMPLE_RATE}Hz)`);
      })
      .catch((err) => {
        console.error(`❌ [PHASE-2] Worker encoder init failed:`, err.message);
      });

    this.workerPool
      .initializeWorker("init_decoder", {
        sampleRate: INCOMING_SAMPLE_RATE,
        channels: CHANNELS,
      })
      .then(() => {
        // console.log(`✅ [PHASE-2] Workers decoder ready (${INCOMING_SAMPLE_RATE}Hz)`);
      })
      .catch((err) => {
        console.error(`❌ [PHASE-2] Worker decoder init failed:`, err.message);
      });

    this.initializeLiveKit();
  }

  initializeLiveKit() {
    const livekitConfig = configManager.get("livekit");
    if (!livekitConfig) {
      throw new Error("LiveKit config not found");
    }
    this.livekitConfig = livekitConfig;
  }

  /**
   * Clear all audio buffers and pending requests to prevent audio from old session
   * bleeding into new session during mode change
   */
  clearAudioBuffers() {
    // console.log(`🧹 [AUDIO-CLEAR] Clearing audio buffers for ${this.macAddress}...`);

    // 1. Clear frame buffer (accumulated PCM data waiting to be encoded)
    const oldFrameBufferSize = this.frameBuffer.length;
    this.frameBuffer = Buffer.alloc(0);
    // console.log(`🧹 [AUDIO-CLEAR] Cleared frame buffer (was ${oldFrameBufferSize} bytes)`);

    // 2. Clear worker pool pending requests
    if (this.workerPool && this.workerPool.pendingRequests) {
      const pendingCount = this.workerPool.pendingRequests.size;
      // Reject all pending requests to prevent callbacks from firing
      for (const [requestId, request] of this.workerPool.pendingRequests) {
        if (request && request.reject) {
          request.reject(new Error('Audio buffer cleared due to mode change'));
        }
        // Clear timeout if any
        if (request && request.timeout) {
          clearTimeout(request.timeout);
        }
      }
      this.workerPool.pendingRequests.clear();
      // Reset pending counts per worker
      this.workerPool.workerPendingCount = this.workerPool.workerPendingCount.map(() => 0);
      // console.log(`🧹 [AUDIO-CLEAR] Cleared ${pendingCount} pending worker requests`);
    }

    // 3. Reset audio playing state
    this.isAudioPlaying = false;
    this.audioPlayingStartTime = null;

    // 4. Set flag to stop any ongoing audio forwarding
    this.stopAudioForwarding = true;

    // console.log(`✅ [AUDIO-CLEAR] Audio buffers cleared for ${this.macAddress}`);
  }

  // PHASE 2: Process buffered audio frames and encode to Opus using worker threads
  async processBufferedFrames(timestamp, frameCount) {
    if (!this.connection) {
      // console.error(`❌ [PROCESS] No connection available, cannot send audio`);
      return;
    }

    // Check if audio forwarding has been stopped (during mode change)
    if (this.stopAudioForwarding) {
      // Silently discard audio during mode change
      return;
    }

    while (this.frameBuffer.length >= this.targetFrameBytes) {
      // Extract one complete frame
      const frameData = this.frameBuffer.subarray(0, this.targetFrameBytes);
      this.frameBuffer = this.frameBuffer.subarray(this.targetFrameBytes);

      // Process this complete frame - encode to Opus before sending
      if (frameData.length > 0) {
        const samples = new Int16Array(
          frameData.buffer,
          frameData.byteOffset,
          frameData.length / 2
        );
        const isSilent = samples.every((sample) => sample === 0);
        const maxAmplitude = Math.max(...samples.map((s) => Math.abs(s)));
        const isNearlySilent = maxAmplitude < 10;

        // if (frameCount <= 5) {
        //   console.log(`🔍 [DEBUG] Frame ${frameCount}: samples=${samples.length}, max=${maxAmplitude}`);
        // }

        if (isSilent || isNearlySilent) {
          // if (frameCount <= 5) {
          //   console.log(`🔇 [PCM] Silent frame ${frameCount} detected (max=${maxAmplitude}), skipping`);
          // }
          continue;
        }

        // TEMPORARY: Use synchronous encoding to avoid worker thread issues
        try {
          const opusBuffer = await this.workerPool.encodeOpus(
            frameData,
            this.targetFrameSize
          );

          // if (frameCount <= 3 || frameCount % 100 === 0) {
          //   console.log(`🎵 [WORKER] Frame ${frameCount}: PCM ${frameData.length}B → Opus ${opusBuffer.length}B`);
          // }

          this.connection.sendUdpMessage(opusBuffer, timestamp);
        } catch (err) {
          console.error(`❌ [SYNC] Encode error: ${err.message}`);
          // Fallback to PCM if encoding fails
          this.connection.sendUdpMessage(frameData, timestamp);
        }
      }
    }
  }

  async connect(audio_params, features, roomService) {
    const connectStartTime = Date.now();
    // console.log(`🔍 [DEBUG] LiveKitBridge.connect() called - UUID: ${this.uuid}, MAC: ${this.macAddress}`);
    // console.log(`⏱️ [TIMING-START] Connection initiated at ${connectStartTime}`);
    const { url, api_key, api_secret } = this.livekitConfig;
    // Include MAC address AND room type in room name
    const macForRoom = this.macAddress.replace(/:/g, ""); // Remove colons: 00:16:3e:ac:b5:38 → 00163eacb538
    const roomName = `${this.uuid}_${macForRoom}_${this.roomType}`; // CHANGED: Include room type
    const participantName = this.macAddress;

    // Store roomService and roomName for cleanup on disconnect
    this.roomService = roomService;
    this.roomName = roomName;

    console.log(`🏠 [LIVEKIT] Creating room: ${roomName} (type: ${this.roomType})`);

    // Pre-create room with emptyTimeout setting
    if (roomService) {
      try {
        await roomService.createRoom({
          name: roomName,
          empty_timeout: 60, // Auto-close room if empty for 60 seconds (snake_case for LiveKit API)
          max_participants: 2,
        });
        // console.log(`✅ [ROOM] Pre-created room with 60-second empty_timeout: ${roomName}`);
      } catch (error) {
        // Log the actual error for debugging
        console.error(`❌ [ROOM] Error pre-creating room: ${error.message}`);
        // console.error(`❌ [ROOM] Full error:`, error);

        // Room might already exist, that's okay - continue anyway
        // if (error.message && !error.message.includes("already exists")) {
        //   console.warn(`⚠️ [ROOM] Continuing despite error...`);
        // } else {
        //   console.log(`ℹ️ [ROOM] Room already exists: ${roomName}`);
        // }
        // Don't throw - continue with connection even if room pre-creation fails
      }
    }

    const at = new AccessToken(api_key, api_secret, {
      identity: participantName,
      // Add MAC address as custom attributes
      attributes: {
        device_mac: this.macAddress,
        device_uuid: this.uuid || "",
        room_type: "device_session",
      },
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      roomCreate: true,
      canPublish: true,
      canSubscribe: true,
    });
    const token = await at.toJwt(); // Fixed: Make this async

    this.room = new Room();

    // Add connection state monitoring
    // this.room.on("connectionStateChanged", (state) => {
    //   console.log(`[LiveKitBridge] Connection state changed: ${state}`);
    // });

    // this.room.on("connected", () => {
    //   console.log("[LiveKitBridge] Room connected event fired");
    // });

    this.room.on("disconnected", (reason) => {
      console.log(`[LiveKitBridge] Room disconnected: ${reason}`);
      // CRITICAL: Clear audio flag on disconnect to prevent stuck state
      this.isAudioPlaying = false;
      this.audioPlayingStartTime = null;
      // console.log(`🎵 [CLEANUP] Cleared audio flag on room disconnect for device: ${this.macAddress}`);
    });

    this.room.on(
      RoomEvent.DataReceived,
      (payload, participant, kind, topic) => {
        try {
          const str = Buffer.from(payload).toString("utf-8");

          let data;
          try {
            data = JSON5.parse(str);
            // Simplified LiveKit message log
            console.log(`📨 [LIVEKIT-IN] Type: ${data?.type} from ${participant?.identity || 'unknown'}`);
          } catch (err) {
            console.error("❌ [PARSE ERROR] Invalid JSON5:", err.message);
            // console.error("Full raw payload:", str);
          }
          switch (data.type) {
            case "agent_state_changed":
              if (
                data.data.old_state === "speaking" &&
                data.data.new_state === "listening"
              ) {
                // Set audio playing flag to false
                this.isAudioPlaying = false;
                this.audioPlayingStartTime = null;
                // console.log(`🎵 [AUDIO-STOP] TTS stopped for device: ${this.macAddress}`);
                // Send TTS stop message to device
                setTimeout(() => {
                  this.sendTtsStopMessage();
                }, 1000);
                

                // If we're in ending phase, send goodbye MQTT message now that TTS finished
                if (
                  this.connection &&
                  this.connection.isEnding &&
                  !this.connection.goodbyeSent
                ) {
                  // console.log(`👋 [END-COMPLETE] TTS goodbye finished, sending goodbye MQTT message to device: ${this.macAddress}`);
                  this.connection.goodbyeSent = true;
                  this.connection.sendMqttMessage(
                    JSON.stringify({
                      type: "goodbye",
                      session_id: this.connection.udp
                        ? this.connection.udp.session_id
                        : null,
                      reason: "inactivity_timeout",
                      timestamp: Date.now(),
                    })
                  );
                  console.log(`📤 [MQTT-OUT] Sent goodbye message: ${this.macAddress}`);

                  // Close connection shortly after goodbye message
                  setTimeout(() => {
                    if (this.connection) {
                      this.connection.close();
                    }
                  }, 500); // Small delay to ensure goodbye message is delivered
                }
              } else if (
                data.data.old_state === "listening" &&
                data.data.new_state === "thinking"
              ) {
                // DISABLED: Skip forwarding thinking message to ESP32
                console.log(`🤔 [LLM] Thinking message received, forwarding to MQTT is skipped`);
                // this.sendLLMThinkMessage();
              }
              break;
            case "user_input_transcribed":
              // DISABLED: Don't send intermediate STT results to device (too many messages)
              // The device doesn't need partial transcriptions
              // this.sendSttMessage(data.data.text || data.data.transcript);
              break;
            case "speech_created":
              // Set audio playing flag and reset inactivity timer
              this.isAudioPlaying = true;
              this.audioPlayingStartTime = Date.now(); // Track when audio started
              if (this.connection && this.connection.updateActivityTime) {
                this.connection.updateActivityTime();
                // console.log(`🎵 [AUDIO-START] TTS started, timer reset for device: ${this.macAddress}`);
              }
              // Send TTS start message to device
              this.sendTtsStartMessage(data.data.text);
              break;
            case "device_control":
              // Convert device_control commands to MCP function calls
              // console.log(`🎛️ [DEVICE CONTROL] Received action: ${data.action}`);
              this.convertDeviceControlToMcp(data);
              break;
            case "function_call":
              // Handle xiaozhi function calls (volume controls, etc.)
              // console.log(`🔧 [FUNCTION CALL] Received function: ${data.function_call?.name}`);
              this.handleFunctionCall(data);
              break;
            case "mobile_music_request":
              // Handle music play request from mobile app
              console.log(`🎵 [MOBILE] Music play request: ${data.song_name}`);
              // console.log(`   📱 Device: ${this.macAddress}`);
              // console.log(`   🎵 Song: ${data.song_name}`);
              // console.log(`   🗂️ Type: ${data.content_type}`);
              // console.log(`   🌐 Language: ${data.language || "Not specified"}`);
              this.handleMobileMusicRequest(data);
              break;
            case "music_playback_stopped":
              // Handle music playback stopped - force clear audio playing flag
              // console.log(`🎵 [MUSIC-STOP] Music playback stopped for device: ${this.macAddress}`);
              this.isAudioPlaying = false;
              this.audioPlayingStartTime = null;
              // Send TTS stop message to ensure device returns to listening state
              this.sendTtsStopMessage();
              break;
            case "llm":
              // Handle emotion from LLM response
              // console.log(`😊 [EMOTION] Received: ${data.emotion} (${data.text})`);
              this.sendEmotionMessage(data.text, data.emotion);
              break;

            // case "metrics_collected":
            //   console.log(`Metrics: ${JSON.stringify(data.data)}`);
            //   break;
            default:
            //console.log(`Unknown data type: ${data.type}`);
          }
        } catch (error) {
          console.error(`Error processing data packet: ${error}`);
        }
      }
    );

    return new Promise(async (resolve, reject) => {
      try {
        // console.log(`[LiveKitBridge] Connecting to LiveKit room: ${roomName}`);
        await this.room.connect(url, token, {
          autoSubscribe: true,
          dynacast: true,
        });
        const roomConnectedTime = Date.now();
        console.log(`✅ [LIVEKIT] Connected to room: ${roomName}`);
        // console.log(`⏱️ [TIMING-ROOM] Room connection took ${roomConnectedTime - connectStartTime}ms`);
        // console.log(`🔗 [CONNECTION] State: ${this.room.connectionState}`);
        // console.log(`🟢 [STATUS] Is connected: ${this.room.isConnected}`);

        // Store the current mode in deviceInfo for function_call validation
        if (this.connection && this.connection.gateway) {
          const deviceInfo = this.connection.gateway.deviceConnections.get(this.macAddress);
          if (deviceInfo) {
            deviceInfo.currentMode = this.roomType;
            deviceInfo.currentRoomName = roomName;
            // console.log(`✅ [MODE] Set currentMode to '${this.roomType}' for device ${this.macAddress}`);
          } else {
            // console.warn(`⚠️ [MODE] Could not find deviceInfo for ${this.macAddress}`);
          }
        } else {
          // console.warn(`⚠️ [MODE] Gateway reference not available to set currentMode`);
        }

        // Log existing participants in the room
        // console.log(`👥 [PARTICIPANTS] Remote participants in room: ${this.room.remoteParticipants.size}`);
        // this.room.remoteParticipants.forEach((participant, sid) => {
        //   console.log(`   - ${participant.identity} (${sid})`);
        //   participant.trackPublications.forEach((pub, trackSid) => {
        //     console.log(`     📡 Track: ${trackSid}, kind: ${pub.kind}, subscribed: ${pub.isSubscribed}`);
        //   });
        // });

        this.room.on(
          RoomEvent.TrackSubscribed,
          (track, publication, participant) => {
            // console.log(`🎵 [TRACK] Subscribed to track: ${track.sid} from ${participant.identity}, kind: ${track.kind}`);

            // Handle audio track from agent (TTS audio)
            // Check for both string "audio" and TrackKind.KIND_AUDIO constant
            if (track.kind === "audio" || track.kind === TrackKind.KIND_AUDIO) {
              // console.log(`🔊 [AUDIO TRACK] Starting audio stream processing for ${participant.identity}`);

              const stream = new AudioStream(track);
              const reader = stream.getReader();

              let frameCount = 0;
              let totalBytes = 0;
              let lastLogTime = Date.now();

              const readStream = async () => {
                try {
                  // console.log(`🎧 [AUDIO STREAM] Starting to read audio frames from ${participant.identity}`);

                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      this.sendTtsStopMessage();
                      // console.log(`🏁 [AUDIO STREAM] Stream ended for ${participant.identity}. Total frames: ${frameCount}, Total bytes: ${totalBytes}`);

                      // Flush any remaining resampled data
                      const finalFrames = this.audioResampler.flush();
                      for (const finalFrame of finalFrames) {
                        const finalBuffer = Buffer.from(
                          finalFrame.data.buffer,
                          finalFrame.data.byteOffset,
                          finalFrame.data.byteLength
                        );
                        // Add final frames to buffer
                        this.frameBuffer = Buffer.concat([
                          this.frameBuffer,
                          finalBuffer,
                        ]);
                      }

                      // Process any remaining complete frames in buffer
                      const finalTimestamp =
                        (Date.now() - this.connection.udp.startTime) &
                        0xffffffff;
                      this.processBufferedFrames(
                        finalTimestamp,
                        frameCount,
                        participant.identity
                      );

                      // SKIP partial frames - they cause Opus encoder to crash
                      // Opus encoder requires exact frame sizes, partial frames will be dropped
                      // if (this.frameBuffer.length > 0) {
                      //   console.log(`⏭️ [FLUSH] Skipping partial frame (${this.frameBuffer.length}B) - would cause Opus crash`);
                      // }

                      // Clear the buffer
                      this.frameBuffer = Buffer.alloc(0);

                      // Notify connection that audio stream has ended
                      if (this.connection && this.connection.isEnding) {
                        // console.log(`✅ [END-COMPLETE] Audio stream completed, closing connection: ${this.connection.clientId || this.connection.deviceId}`);
                        // Use setTimeout to allow TTS stop message to be sent first
                        setTimeout(() => {
                          if (this.connection && this.connection.isEnding) {
                            this.connection.close();
                          }
                        }, 1000); // 1 second delay to ensure TTS stop is processed
                      }

                      break;
                    }

                    frameCount++;

                    // value is an AudioFrame from LiveKit (48kHz)
                    // Add safety checks for AudioFrame processing
                    try {
                      // Check if audio forwarding is stopped (e.g., during mode switch)
                      if (this.stopAudioForwarding) {
                        // Skip processing audio frames when mode switch is in progress
                        continue;
                      }

                      if (!value || !value.data) {
                        // console.warn(`⚠️ [AUDIO] Invalid AudioFrame received, skipping`);
                        continue;
                      }

                      // Push the frame to resampler and get resampled frames back (24kHz)
                      const resampledFrames = this.audioResampler.push(value);

                      // Add resampled frames to buffer instead of processing directly
                      for (const resampledFrame of resampledFrames) {
                        if (!resampledFrame || !resampledFrame.data) {
                          // console.warn(`⚠️ [AUDIO] Invalid resampled frame, skipping`);
                          continue;
                        }

                        // Safer buffer creation with validation
                        let resampledBuffer;
                        try {
                          resampledBuffer = Buffer.from(
                            resampledFrame.data.buffer,
                            resampledFrame.data.byteOffset,
                            resampledFrame.data.byteLength
                          );
                        } catch (bufferError) {
                          // console.error(`❌ [AUDIO] Buffer creation failed:`, bufferError.message);
                          continue;
                        }

                        // Append to frame buffer
                        this.frameBuffer = Buffer.concat([
                          this.frameBuffer,
                          resampledBuffer,
                        ]);
                        totalBytes += resampledBuffer.length;
                      }

                      const timestamp =
                        (Date.now() - this.connection.udp.startTime) & 0xffffffff;

                      // Process any complete frames from the buffer
                      this.processBufferedFrames(timestamp, frameCount, participant.identity);

                      // Log every 50 frames or every 5 seconds
                      // const now = Date.now();
                      // if (frameCount % 50 === 0 || now - lastLogTime > 5000) {
                      //   console.log(
                      //     `🎵 [AUDIO FRAMES] Received ${frameCount} frames, ${totalBytes} total bytes from ${participant.identity}, buffer: ${this.frameBuffer.length}B`
                      //   );
                      //   lastLogTime = now;
                      // }

                    } catch (audioProcessError) {
                      // console.error(`❌ [AUDIO] Frame processing error:`, audioProcessError.message);
                      // Continue processing other frames
                    }

                  }
                } catch (error) {
                  console.error(`❌ [AUDIO STREAM] Error reading audio stream:`, error.message);
                } finally {
                  // console.log(`🔒 [AUDIO STREAM] Releasing reader lock for ${participant.identity}`);
                  reader.releaseLock();
                }
              };

              readStream();
            } else {
              // console.log(`⚠️ [TRACK] Non-audio track subscribed: ${track.kind} (type: ${typeof track.kind}) from ${participant.identity}`);
            }
          }
        );

        // Add track unsubscription handler
        // this.room.on(
        //   RoomEvent.TrackUnsubscribed,
        //   (track, publication, participant) => {
        //     console.log(`🔇 [TRACK] Unsubscribed from track: ${track.sid} from ${participant.identity}, kind: ${track.kind}`);
        //   }
        // );

        // Add participant connection handlers
        this.room.on(RoomEvent.ParticipantConnected, (participant) => {
          // console.log(`👤 [PARTICIPANT] Connected: ${participant.identity} (${participant.sid})`);

          // Check if this is an agent joining (agent identity typically contains "agent")
          if (participant.identity.includes("agent")) {
            console.log(`🤖 [LIVEKIT] Agent joined: ${participant.identity}`);

            // Set agent joined flag and resolve promise
            this.agentJoined = true;
            if (this.agentJoinResolve) {
              this.agentJoinResolve();
              // console.log(`✅ [AGENT-READY] Agent join promise resolved`);
            }

            // Clear timeouts if set
            if (this.agentJoinTimeout) {
              clearTimeout(this.agentJoinTimeout);
              this.agentJoinTimeout = null;
            }

            // Send start_greeting to agent when it joins AND UDP is ready
            const waitForUdpAndGreet = async () => {
              try {
                if (this.greetingSent) return;

                // Wait for UDP connection to be ready (max 10 seconds)
                let waitCount = 0;
                const maxWait = 100; // 100 * 100ms = 10 seconds
                while (!this.connection?.udp?.remoteAddress && waitCount < maxWait) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  waitCount++;
                }

                if (!this.connection?.udp?.remoteAddress) {
                  console.log(`⚠️ [AGENT-READY] UDP not ready after 10s, sending greeting anyway`);
                }

                // Additional delay for stability after UDP is ready
                await new Promise(resolve => setTimeout(resolve, 500));

                if (!this.greetingSent) {
                  this.greetingSent = true;
                  console.log(`👋 [AGENT-READY] UDP ready, sending start_greeting to agent...`);
                  const startGreetingMsg = {
                    type: "start_greeting",
                    session_id: this.connection?.udp?.session_id || null,
                    is_mode_switch: false,
                    timestamp: Date.now()
                  };
                  await this.room.localParticipant.publishData(
                    Buffer.from(JSON.stringify(startGreetingMsg)),
                    { reliable: true }
                  );
                  console.log(`✅ [AGENT-READY] start_greeting sent to agent`);
                }
              } catch (err) {
                console.error(`❌ [AGENT-READY] Failed to send greeting:`, err.message);
              }
            };
            waitForUdpAndGreet();
          }
        });

        this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          // console.log(`👤 [PARTICIPANT] Disconnected: ${participant.identity} (${participant.sid})`);
        });

        // Fixed: Use proper track publishing method (simplified to match dev branch)
        const {
          LocalAudioTrack,
          TrackPublishOptions,
          TrackSource,
        } = require("@livekit/rtc-node");

        const track = LocalAudioTrack.createAudioTrack(
          "microphone",
          this.audioSource
        );
        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;

        const publication = await this.room.localParticipant.publishTrack(
          track,
          options
        );
        const trackPublishedTime = Date.now();
        // console.log(`🎤 [PUBLISH] Published local audio track: ${publication.trackSid || publication.sid}`);
        // console.log(`⏱️ [TIMING-TRACK] Track publish took ${trackPublishedTime - roomConnectedTime}ms`);

        // Use roomName as session_id - this is consistent with how LiveKit rooms work
        // The room.sid might not be immediately available, but roomName is our session identifier
        // Include audio_params that the client expects
        const totalConnectTime = Date.now() - connectStartTime;
        // console.log(`⏱️ [TIMING-TOTAL] Total connection setup took ${totalConnectTime}ms`);
        resolve({
          session_id: roomName,
          audio_params: {
            sample_rate: 24000,
            channels: 1,
            frame_duration: 60,
            format: "opus",
          },
        });
      } catch (error) {
        console.error("[LiveKitBridge] Error connecting to LiveKit:", error.message);
        // console.error("[LiveKitBridge] Error name:", error.name);
        // console.error("[LiveKitBridge] Error message:", error.message);
        reject(error);
      }
    });
  }

  async sendAudio(opusData, timestamp) {
    // Check if audioSource is available and room is connected
    if (!this.audioSource || !this.room || !this.room.isConnected) {
      // console.warn(`⚠️ [AUDIO] Cannot send audio - audioSource or room not ready. Room connected: ${this.room?.isConnected}`);
      return;
    }

    try {
      // PHASE 1: Improved Opus detection - check if data is likely Opus
      const isOpus = this.checkOpusFormat(opusData);

      if (isOpus) {
        // PHASE 2: Use worker thread for decoding (non-blocking)
        try {
          const pcmBuffer = await this.workerPool.decodeOpus(opusData);

          // console.log(`✅ [WORKER DECODE] Decoded ${opusData.length}B Opus → ${pcmBuffer.length}B PCM`);

          if (pcmBuffer && pcmBuffer.length > 0) {
            // Convert Buffer to Int16Array
            const samples = new Int16Array(
              pcmBuffer.buffer,
              pcmBuffer.byteOffset,
              pcmBuffer.length / 2
            );
            const frame = new AudioFrame(samples, 16000, 1, samples.length);

            // Safe capture with error handling
            this.safeCaptureFrame(frame).catch((err) => {
              // console.error(`❌ [AUDIO] Unhandled error in safeCaptureFrame: ${err.message}`);
            });
          }
        } catch (err) {
          // console.error(`❌ [WORKER] Decode error: ${err.message}`);
          // console.error(`    Data size: ${opusData.length}B, First 8 bytes: ${opusData.subarray(0, Math.min(8, opusData.length)).toString("hex")}`);

          // PHASE 2: Fallback to PCM if worker decode fails (likely false positive detection)
          // console.log(`⚠️ [FALLBACK] Treating as PCM instead`);
          const samples = new Int16Array(
            opusData.buffer,
            opusData.byteOffset,
            opusData.length / 2
          );
          const frame = new AudioFrame(samples, 16000, 1, samples.length);
          this.safeCaptureFrame(frame).catch((err) => {
            // console.error(`❌ [AUDIO] PCM fallback failed: ${err.message}`);
          });
        }
      } else {
        // Treat as PCM directly
        const samples = new Int16Array(
          opusData.buffer,
          opusData.byteOffset,
          opusData.length / 2
        );
        const frame = new AudioFrame(samples, 16000, 1, samples.length);

        // Safe capture with error handling
        this.safeCaptureFrame(frame).catch((err) => {
          // console.error(`❌ [AUDIO] Unhandled error in safeCaptureFrame: ${err.message}`);
        });
      }
    } catch (error) {
      // console.error(`❌ [AUDIO] Error in sendAudio: ${error.message}`);
    }
  }

  async safeCaptureFrame(frame) {
    try {
      // Validate frame before capture
      if (!frame || !frame.data || frame.data.length === 0) {
        // console.warn(`⚠️ [AUDIO] Invalid frame data, treating as keepalive/ping`);
        // Reset activity timer - treat invalid frames as keepalive signals
        if (this.connection && this.connection.updateActivityTime) {
          this.connection.updateActivityTime();
        }
        return;
      }

      // Check if audioSource is still valid
      if (!this.audioSource) {
        // console.warn(`⚠️ [AUDIO] AudioSource is null, cannot capture frame`);
        return;
      }

      // Check if room is still connected before attempting to send audio
      if (!this.room || !this.room.isConnected) {
        // console.warn(`⚠️ [AUDIO] Room disconnected or not available, skipping frame`);
        return;
      }

      // Attempt to capture the frame
      await this.audioSource.captureFrame(frame);
    } catch (error) {
      // console.error(`❌ [AUDIO] Failed to capture frame: ${error.message}`);

      // If we get InvalidState error, it's likely the peer connection is disconnecting
      // if (error.message.includes("InvalidState")) {
      //   console.warn(`⚠️ [AUDIO] InvalidState error - peer connection may be disconnecting`);
      //   console.warn(`💡 [HINT] This is normal during room disconnect, frames will be skipped`);
      // }
    }
  }

  analyzeAudioFormat(audioData, timestamp) {
    // Check for Opus magic signature - DEBUG FUNCTION (commented out)
    // const isOpus = this.checkOpusFormat(audioData);
    // const isPCM = this.checkPCMFormat(audioData);
    // console.log(`🔍 [AUDIO ANALYSIS] Format Detection:`);
    // console.log(`   📊 Size: ${audioData.length} bytes`);
    // console.log(`   🎵 Timestamp: ${timestamp}`);
    // console.log(`   📋 First 16 bytes: ${audioData.slice(0, Math.min(16, audioData.length)).toString("hex")}`);
    // console.log(`   🎼 Opus signature: ${isOpus ? "✅ DETECTED" : "❌ NOT FOUND"}`);
    // console.log(`   🎤 PCM characteristics: ${isPCM ? "✅ LIKELY PCM" : "❌ UNLIKELY PCM"}`);
    // this.analyzeAudioStatistics(audioData);
  }

  checkOpusFormat(data) {
    if (data.length < 1) return false;

    // PHASE 2: Filter out text messages (keepalive, ping, etc.)
    // Check if data looks like ASCII text
    try {
      const textCheck = data.toString("utf8", 0, Math.min(10, data.length));
      if (/^(keepalive|ping|pong|hello|goodbye)/.test(textCheck)) {
        // console.log(`🚫 Filtered out text message: ${textCheck}`);
        return false; // This is a text message, not Opus
      }
    } catch (e) {
      // Not valid UTF-8, continue with Opus check
    }

    // ESP32 sends 60ms OPUS frames at 16kHz mono with complexity=0
    const MIN_OPUS_SIZE = 1; // Minimum OPUS packet (can be very small for silence)
    const MAX_OPUS_SIZE = 400; // Maximum OPUS packet for 60ms@16kHz

    // Validate packet size range
    if (data.length < MIN_OPUS_SIZE || data.length > MAX_OPUS_SIZE) {
      // console.log(`❌ Invalid OPUS size: ${data.length}B (expected ${MIN_OPUS_SIZE}-${MAX_OPUS_SIZE}B)`);
      return false;
    }

    // Check OPUS TOC (Table of Contents) byte
    const firstByte = data[0];
    const config = (firstByte >> 3) & 0x1f; // Bits 7-3: config (0-31)
    const stereo = (firstByte >> 2) & 0x01; // Bit 2: stereo flag
    const frameCount = firstByte & 0x03; // Bits 1-0: frame count

    // console.log(`🔍 OPUS TOC: config=${config}, stereo=${stereo}, frames=${frameCount}, size=${data.length}B`);

    // Validate OPUS TOC byte
    const validConfig = config >= 0 && config <= 31;
    const validStereo = stereo === 0; // ESP32 sends mono (stereo=0)
    const validFrameCount = frameCount >= 0 && frameCount <= 3;

    // ✅ FIXED: Accept ALL valid OPUS configs (0-31) for ESP32 with complexity=0
    // ESP32 with complexity=0 can use various configs depending on audio content
    const validOpusConfigs = [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15, // NB/MB/WB configs
      16,
      17,
      18,
      19, // SWB configs
      20,
      21,
      22,
      23, // FB configs
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31, // Hybrid configs
    ];
    const isValidConfig = validOpusConfigs.includes(config);

    // ✅ FIXED: More lenient validation - just check basic OPUS structure
    const isValidOpus =
      validConfig && validStereo && validFrameCount && isValidConfig;

    // console.log(`📊 OPUS validation: config=${validConfig}(${config}), mono=${validStereo}, frames=${validFrameCount}, validConfig=${isValidConfig} → ${isValidOpus ? "✅ VALID" : "❌ INVALID"}`);

    // ✅ ADDITIONAL: Log first few bytes for debugging
    if (!isValidOpus) {
      const hexDump = data.slice(0, Math.min(8, data.length)).toString("hex");
      //  console.log(`🔍 OPUS debug - first ${Math.min(8, data.length)} bytes: ${hexDump}`);
    }

    return isValidOpus;
  }

  checkOpusMarkers(data) {
    // Look for common Opus packet patterns
    if (data.length < 4) return false;

    // Check for Opus frame size patterns (common sizes: 120, 240, 480, 960, 1920, 2880 samples)
    // At 16kHz: 120 samples = 7.5ms, 240 = 15ms, 480 = 30ms, etc.
    const commonOpusSizes = [20, 40, 60, 80, 120, 160, 240, 320, 480, 640, 960];
    const isCommonOpusSize = commonOpusSizes.includes(data.length);

    // console.log(
    //   `   📏 Common Opus size (${data.length}B): ${isCommonOpusSize ? "✅" : "❌"}`
    // );

    return isCommonOpusSize;
  }

  checkPCMFormat(data) {
    if (data.length < 32) return false;

    // PCM characteristics analysis
    const samples = new Int16Array(
      data.buffer,
      data.byteOffset,
      Math.min(data.length / 2, 16)
    );

    // Calculate basic statistics
    let sum = 0;
    let maxAbs = 0;
    let zeroCount = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      sum += Math.abs(sample);
      maxAbs = Math.max(maxAbs, Math.abs(sample));
      if (sample === 0) zeroCount++;
    }

    const avgAmplitude = sum / samples.length;
    const zeroRatio = zeroCount / samples.length;

    // console.log(`   📈 PCM Statistics:`);
    // console.log(`      🔊 Avg amplitude: ${avgAmplitude.toFixed(1)}`);
    // console.log(`      📊 Max amplitude: ${maxAbs}`);
    // console.log(`      🔇 Zero ratio: ${(zeroRatio * 100).toFixed(1)}%`);
    // console.log(`      📐 Sample count: ${samples.length}`);

    // PCM heuristics
    const hasReasonableAmplitude = avgAmplitude > 10 && avgAmplitude < 10000;
    const hasVariation = maxAbs > 100;
    const notTooManyZeros = zeroRatio < 0.8;
    const reasonableSize = data.length >= 160 && data.length <= 3840; // 10ms to 240ms at 16kHz

    // console.log(`   ✅ PCM Checks:`);
    // console.log(`      🔊 Reasonable amplitude: ${hasReasonableAmplitude ? "✅" : "❌"}`);
    // console.log(`      📊 Has variation: ${hasVariation ? "✅" : "❌"}`);
    // console.log(`      🔇 Not too many zeros: ${notTooManyZeros ? "✅" : "❌"}`);
    // console.log(`      📏 Reasonable size: ${reasonableSize ? "✅" : "❌"}`);

    return (
      hasReasonableAmplitude &&
      hasVariation &&
      notTooManyZeros &&
      reasonableSize
    );
  }

  analyzeAudioStatistics(data) {
    // Frame size analysis for common audio formats - DEBUG FUNCTION (commented out)
    // const frameSizeAnalysis = this.analyzeFrameSize(data.length);
    // console.log(`   ⏱️  Frame Analysis: ${frameSizeAnalysis}`);
    // const entropy = this.calculateEntropy(data);
    // console.log(`   🎲 Data entropy: ${entropy.toFixed(3)} (PCM: ~7-11, Opus: ~7.5-8)`);
  }

  analyzeFrameSize(size) {
    // Common frame sizes for different formats at 16kHz
    const formats = {
      "PCM 10ms": 320, // 160 samples * 2 bytes
      "PCM 20ms": 640, // 320 samples * 2 bytes
      "PCM 30ms": 960, // 480 samples * 2 bytes
      "PCM 60ms": 1920, // 960 samples * 2 bytes
      "Opus 20ms": 40, // Typical Opus frame
      "Opus 40ms": 80, // Typical Opus frame
      "Opus 60ms": 120, // Typical Opus frame
    };

    for (const [format, expectedSize] of Object.entries(formats)) {
      if (size === expectedSize) {
        return `${format} (exact match)`;
      }
    }

    // Check for close matches
    for (const [format, expectedSize] of Object.entries(formats)) {
      if (Math.abs(size - expectedSize) <= 10) {
        return `${format} (close match, diff: ${size - expectedSize})`;
      }
    }

    return `Unknown format (${size}B)`;
  }

  calculateEntropy(data) {
    const freq = new Array(256).fill(0);

    // Count byte frequencies
    for (let i = 0; i < data.length; i++) {
      freq[data[i]]++;
    }

    // Calculate entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (freq[i] > 0) {
        const p = freq[i] / data.length;
        entropy -= p * Math.log2(p);
      }
    }

    return entropy;
  }

  isAlive() {
    return this.room && this.room.isConnected;
  }

  // Send TTS start message to device
  sendTtsStartMessage(text = "") {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "start",
      session_id: this.connection.udp.session_id,
    };

    if (text) {
      message.text = text;
    }

    // console.log(
    //   `📤 [MQTT OUT] Sending TTS start to device: ${this.macAddress}`
    // );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send TTS sentence start message to device
  sendTtsSentenceStartMessage(text) {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "sentence_start",
      session_id: this.connection.udp.session_id,
      text: text || "",
    };

    // console.log(`📤 [MQTT OUT] Sending TTS sentence start to device: ${this.macAddress} - "${text}"`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send TTS stop message to device
  sendTtsStopMessage() {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "stop",
      session_id: this.connection.udp.session_id,
    };

    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  sendLLMThinkMessage() {
    if (!this.connection) return;
    // console.log("Sending LLM think message");
    const message = {
      type: "llm",
      state: "think",
      session_id: this.connection.udp.session_id,
    };

    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send STT (Speech-to-Text) result to device
  sendSttMessage(text) {
    if (!this.connection || !text) return;

    const message = {
      type: "stt",
      text: text,
      session_id: this.connection.udp.session_id,
    };

    console.log(`📤 [MQTT-OUT] STT: "${text}"`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send emotion message to device (from LLM response)
  sendEmotionMessage(emoji, emotion) {
    if (!this.connection) return;

    const message = {
      type: "llm",
      text: emoji,
      emotion: emotion,
      session_id: this.connection.udp.session_id,
    };

    // console.log(`📤 [MQTT OUT] Sending emotion to device: ${this.macAddress} - ${emotion} (${emoji})`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Convert device_control commands to MCP function calls
  convertDeviceControlToMcp(controlData) {
    if (!this.connection) return;

    const action = controlData.action || controlData.command;

    // Map device control actions to xiaozhi function names
    const actionToFunctionMap = {
      set_volume: "self_set_volume",
      volume_up: "self_volume_up",
      volume_down: "self_volume_down",
      get_volume: "self_get_volume",
      mute: "self_mute",
      unmute: "self_unmute",
      set_light_color: "self_set_light_color",
      get_battery_status: "self_get_battery_status",
      set_light_mode: "self_set_light_mode",
      set_rainbow_speed: "self_set_rainbow_speed",
    };

    const functionName = actionToFunctionMap[action];
    if (!functionName) {
      // console.error(`❌ [DEVICE CONTROL] Unknown action: ${action}`);
      return;
    }

    // Prepare function arguments based on action type
    let functionArguments = {};
    if (action === "set_volume") {
      functionArguments.volume = controlData.volume || controlData.value;
    } else if (action === "volume_up" || action === "volume_down") {
      functionArguments.step = controlData.step || controlData.value || 10;
    }

    // Create function call data in the same format as handleFunctionCall expects
    const functionCallData = {
      function_call: {
        name: functionName,
        arguments: functionArguments,
      },
      timestamp: controlData.timestamp || new Date().toISOString(),
      request_id: controlData.request_id || `req_${Date.now()}`,
    };

    // console.log(`🔄 [DEVICE CONTROL] Converting to MCP: ${action} -> ${functionName}, Args: ${JSON.stringify(functionArguments)}`);

    // Use existing handleFunctionCall method to send as MCP format
    this.handleFunctionCall(functionCallData);
  }

  // Handle xiaozhi function calls (volume controls, etc.)
  async handleFunctionCall(functionData) {
    if (!this.connection) return;

    const functionCall = functionData.function_call;
    if (!functionCall || !functionCall.name) {
      // console.error(`❌ [FUNCTION CALL] Invalid function call data:`, functionData);
      return;
    }

    // Handle volume up/down with adjust logic (get current + calculate + set)
    if (functionCall.name === "self_volume_up" || functionCall.name === "self_volume_down") {
      // console.log(`🎛️ [VOICE-MCP] Volume control detected from voice command, using adjust logic`);

      try {
        const action = functionCall.name === "self_volume_up" ? "up" : "down";
        const step = functionCall.arguments?.step || 10;

        const newVolume = await this.debouncedAdjustVolume(action, step, 300);
        // console.log(`✅ [VOICE-MCP] Volume adjusted successfully to ${newVolume}`);
      } catch (error) {
        // console.error(`❌ [VOICE-MCP] Failed to adjust volume:`, error);
      }

      return;
    }

    // Map xiaozhi function names to MCP tool names for ESP32 firmware
    const functionToMcpToolMap = {
      self_set_volume: "self.audio_speaker.set_volume",
      self_get_volume: "self.get_device_status",
      self_mute: "self.audio_speaker.mute",
      self_unmute: "self.audio_speaker.unmute",
      self_set_light_color: "self.led.set_color",
      self_get_battery_status: "self.battery.get_status",
      self_set_light_mode: "self.led.set_mode",
      self_set_rainbow_speed: "self.led.set_rainbow_speed",
    };

    const mcpToolName = functionToMcpToolMap[functionCall.name];
    if (!mcpToolName) {
      // console.log(`⚠️ [FUNCTION CALL] Unknown function: ${functionCall.name}, forwarding as MCP message`);
      // Forward unknown functions as MCP tool calls
      this.sendMcpMessage(functionCall.name, functionCall.arguments || {});
      return;
    }

    // Create MCP message format expected by ESP32 firmware (JSON-RPC 2.0)
    const requestId = parseInt(
      functionData.request_id?.replace("req_", "") || Date.now()
    );
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: mcpToolName,
          arguments: functionCall.arguments || {},
        },
        id: requestId,
      },
      session_id: this.connection.udp.session_id,
      timestamp: functionData.timestamp || new Date().toISOString(),
      request_id: `req_${requestId}`,
    };

    console.log(`📤 [MQTT-OUT] MCP: ${mcpToolName}`);
    this.connection.sendMqttMessage(JSON.stringify(message));

    // Simulate device response for testing (remove in production)
    // setTimeout(() => {
    //   this.simulateFunctionCallResponse(functionData);
    // }, 100);
  }

  // Handle mobile app music play requests
  async handleMobileMusicRequest(requestData) {
    try {
      // console.log(`🎵 [MOBILE] Processing music request...`);

      if (!this.room || !this.room.localParticipant) {
        // console.error(`❌ [MOBILE] Room not connected, cannot forward request`);
        return;
      }

      // Determine function name based on content type
      const functionName =
        requestData.content_type === "story" ? "play_story" : "play_music";

      // Prepare function arguments
      const functionArguments = {};

      if (requestData.content_type === "music") {
        // For music: song_name and language
        if (requestData.song_name) {
          functionArguments.song_name = requestData.song_name;
        }
        if (requestData.language) {
          functionArguments.language = requestData.language;
        }
      } else if (requestData.content_type === "story") {
        // For stories: story_name and category
        if (requestData.song_name) {
          functionArguments.story_name = requestData.song_name;
        }
        if (requestData.language) {
          functionArguments.category = requestData.language;
        }
      }

      // Create function call message for LiveKit agent
      const functionCallMessage = {
        type: "function_call",
        function_call: {
          name: functionName,
          arguments: functionArguments,
        },
        source: "mobile_app",
        timestamp: Date.now(),
        request_id: `mobile_req_${Date.now()}`,
      };

      // Forward to LiveKit agent via data channel
      const messageString = JSON.stringify(functionCallMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));

      await this.room.localParticipant.publishData(messageData, {
        reliable: true,
      });

      // console.log(`✅ [MOBILE] Music request forwarded to LiveKit agent`);
      // console.log(`   🎯 Function: ${functionName}`);
      // console.log(`   📝 Arguments: ${JSON.stringify(functionArguments)}`);
    } catch (error) {
      console.error(`❌ [MOBILE] Failed to forward music request: ${error.message}`);
      // console.error(`   Stack: ${error.stack}`);
    }
  }

  // Send unknown function calls directly to device (deprecated - use sendMcpMessage)
  sendFunctionCallToDevice(functionData) {
    if (!this.connection) return;

    const message = {
      type: "function_call",
      function_call: functionData.function_call,
      session_id: this.connection.udp.session_id,
      timestamp: functionData.timestamp || new Date().toISOString(),
      request_id: functionData.request_id || `req_${Date.now()}`,
    };

    // console.log(`📤 [FUNCTION FORWARD] Forwarding unknown function to device: ${this.macAddress} - ${functionData.function_call?.name}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send MCP tool call message to device
  sendMcpMessage(toolName, toolArgs = {}) {
    if (!this.connection) return;

    const requestId = Date.now();
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs,
        },
        id: requestId,
      },
      session_id: this.connection.udp.session_id,
      timestamp: new Date().toISOString(),
      request_id: `req_${requestId}`,
    };

    // console.log(`📤 [MCP] Sending MCP tool call to device: ${this.macAddress} - Tool: ${toolName}, Args: ${JSON.stringify(toolArgs)}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Simulate device control response (for testing - remove in production)
  simulateDeviceControlResponse(originalCommand) {
    if (!this.room || !this.room.localParticipant) return;

    try {
      let currentValue = null;
      let success = true;
      let errorMessage = null;

      // Simulate responses based on action type
      const action = originalCommand.action || originalCommand.command;
      switch (action) {
        case "set_volume":
          currentValue = originalCommand.volume || originalCommand.value || 50;
          break;
        case "get_volume":
          currentValue = 65; // Simulated current volume
          break;
        case "volume_up":
          currentValue = Math.min(
            100,
            65 + (originalCommand.step || originalCommand.value || 10)
          );
          break;
        case "volume_down":
          currentValue = Math.max(
            0,
            65 - (originalCommand.step || originalCommand.value || 10)
          );
          break;
        default:
          success = false;
          errorMessage = `Unknown action: ${action}`;
      }

      const responseMessage = {
        type: "device_control_response",
        action: action,
        success: success,
        current_value: currentValue,
        error: errorMessage,
        session_id: originalCommand.session_id || "unknown",
      };

      // Send response back to agent via data channel
      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
      this.room.localParticipant.publishData(messageData, { reliable: true });

      // console.log(`🎛️ [DEVICE RESPONSE] Simulated response: Action ${action}, Success: ${success}, Value: ${currentValue}`);
    } catch (error) {
      // console.error(`❌ [DEVICE RESPONSE] Error simulating device response:`, error);
    }
  }

  // Simulate function call response (for testing - remove in production)
  simulateFunctionCallResponse(originalFunction) {
    if (!this.room || !this.room.localParticipant) return;

    try {
      const functionCall = originalFunction.function_call;
      if (!functionCall) return;

      let success = true;
      let result = {};
      let errorMessage = null;

      // Simulate responses based on function name
      switch (functionCall.name) {
        case "self_set_volume":
          const volume = functionCall.arguments?.volume || 50;
          result = { new_volume: volume };
          break;
        case "self_get_volume":
          result = { current_volume: 65 }; // Simulated current volume
          break;
        case "self_volume_up":
          result = { new_volume: Math.min(100, 65 + 10) };
          break;
        case "self_volume_down":
          result = { new_volume: Math.max(0, 65 - 10) };
          break;
        case "self_mute":
          result = { muted: true, previous_volume: 65 };
          break;
        case "self_unmute":
          result = { muted: false, current_volume: 65 };
          break;
        default:
          success = false;
          errorMessage = `Unknown function: ${functionCall.name}`;
      }

      const responseMessage = {
        type: "function_response",
        request_id: originalFunction.request_id || "unknown",
        function_name: functionCall.name,
        success: success,
        result: result,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };

      // Send response back to agent via data channel
      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
      this.room.localParticipant.publishData(messageData, { reliable: true });

      // console.log(`🔧 [FUNCTION RESPONSE] Simulated response: Function ${functionCall.name}, Success: ${success}, Result: ${JSON.stringify(result)}`);
    } catch (error) {
      // console.error(`❌ [FUNCTION RESPONSE] Error simulating function response:`, error);
    }
  }

  // Forward MCP response to LiveKit agent
  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    // console.log(`🔋 [MCP-FORWARD] Forwarding MCP response for device ${this.macAddress}`);

    if (!this.room || !this.room.localParticipant) {
      // console.error(`❌ [MCP-FORWARD] No room available for device ${this.macAddress}`);
      return false;
    }

    try {
      const responseMessage = {
        type: "mcp",
        payload: mcpPayload,
        session_id: sessionId,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      };

      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));

      await this.room.localParticipant.publishData(messageData, {
        reliable: true,
      });

      // console.log(`✅ [MCP-FORWARD] Successfully forwarded MCP response to LiveKit agent`);
      // console.log(`✅ [MCP-FORWARD] Request ID: ${requestId}`);
      return true;
    } catch (error) {
      console.error(`❌ [MCP-FORWARD] Error forwarding MCP response:`, error.message);
      return false;
    }
  }

  // Send MCP command to device and wait for response
  async sendMcpAndWait(toolName, args = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      // Generate unique request ID
      const requestId = this.mcpRequestCounter++;

      // Create timeout
      const timeoutId = setTimeout(() => {
        this.pendingMcpRequests.delete(requestId);
        reject(new Error(`MCP request timeout after ${timeout}ms`));
      }, timeout);

      // Store promise handlers
      this.pendingMcpRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      // Build MCP message
      const mcpMessage = {
        type: "mcp",
        payload: {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
          id: requestId,
        },
        session_id: this.connection.udp.session_id,
        timestamp: new Date().toISOString(),
        request_id: `req_${requestId}`,
      };

      // console.log(`🔧 [MCP] Sending to device: ${this.macAddress} - Tool: ${toolName}, Args: ${JSON.stringify(args)}`);

      // Send MCP message to device
      this.connection.sendMqttMessage(JSON.stringify(mcpMessage));
    });
  }

  // Debounced volume adjustment - accumulates rapid presses and executes after delay
  debouncedAdjustVolume(action, step = 10, debounceMs = 300) {
    return new Promise((resolve, reject) => {
      // Clear existing debounce timer
      if (this.volumeDebounceTimer) {
        clearTimeout(this.volumeDebounceTimer);
        // console.log(`🔄 [VOLUME-DEBOUNCE] Cancelled previous timer, accumulating...`);
      }

      // Accumulate steps if same action
      if (this.pendingVolumeAction && this.pendingVolumeAction.action === action) {
        this.pendingVolumeAction.step += step;
        this.pendingVolumeAction.resolvers.push(resolve);
        // console.log(`📊 [VOLUME-DEBOUNCE] Accumulated ${action} (total step: ${this.pendingVolumeAction.step})`);
      } else {
        // New action - reset accumulator
        this.pendingVolumeAction = {
          action,
          step,
          resolvers: [resolve],
        };
        // console.log(`🆕 [VOLUME-DEBOUNCE] New action: ${action} (step: ${step})`);
      }

      // Set new debounce timer
      this.volumeDebounceTimer = setTimeout(async () => {
        const { action: finalAction, step: finalStep, resolvers } = this.pendingVolumeAction;
        this.pendingVolumeAction = null;
        this.volumeDebounceTimer = null;

        // console.log(`⏰ [VOLUME-DEBOUNCE] Executing accumulated ${finalAction} (total step: ${finalStep})`);

        try {
          const result = await this.adjustVolume(finalAction, finalStep);
          resolvers.forEach((r) => r(result));
        } catch (error) {
          resolvers.forEach((r) => r(null));
        }
      }, debounceMs);
    });
  }

  // Adjust volume by increment/decrement (uses get + set) - WITH QUEUE SERIALIZATION
  async adjustVolume(action, step = 10) {
    return new Promise((resolve, reject) => {
      // Add request to queue
      this.volumeAdjustmentQueue.push({ action, step, resolve, reject });
      // console.log(`📥 [VOLUME-QUEUE] Added request to queue (size: ${this.volumeAdjustmentQueue.length})`);

      // Process queue if not already processing
      this.processVolumeQueue();
    });
  }

  // Process volume adjustment queue (one at a time)
  async processVolumeQueue() {
    // If already processing, return (serialization)
    if (this.isAdjustingVolume) {
      // console.log(`⏳ [VOLUME-QUEUE] Already processing, waiting...`);
      return;
    }

    // If queue is empty, nothing to do
    if (this.volumeAdjustmentQueue.length === 0) {
      return;
    }

    // Mark as processing
    this.isAdjustingVolume = true;

    // Get next request from queue
    const request = this.volumeAdjustmentQueue.shift();
    const { action, step, resolve, reject } = request;

    // console.log(`🔄 [VOLUME-QUEUE] Processing request (${action}, step=${step}), ${this.volumeAdjustmentQueue.length} remaining`);

    try {
      let currentVolume;

      // Use optimistic volume tracking (avoid expensive get_device_status call)
      if (this.lastKnownVolume !== null) {
        currentVolume = this.lastKnownVolume;
        // console.log(`📊 [VOLUME-OPTIMISTIC] Using cached volume: ${currentVolume}`);
      } else {
        // First time or after error - query device
        // console.log(`🔊 [VOLUME-QUERY] Querying device for current volume...`);
        const statusResult = await this.sendMcpAndWait("self.get_device_status", {}, 3000);

        let deviceStatus;
        if (typeof statusResult === "string") {
          deviceStatus = JSON.parse(statusResult);
        } else {
          deviceStatus = statusResult;
        }

        currentVolume = deviceStatus?.audio_speaker?.volume || 50;
        this.lastKnownVolume = currentVolume;
        // console.log(`📊 [VOLUME-QUERY] Device volume: ${currentVolume}`);
      }

      // Calculate new volume
      let newVolume;
      if (action === "up") {
        newVolume = Math.min(100, currentVolume + step);
      } else {
        newVolume = Math.max(0, currentVolume - step);
      }

      // console.log(`🔧 [VOLUME-ADJUST] Calculating new volume: ${currentVolume} ${action === "up" ? "+" : "-"} ${step} = ${newVolume}`);

      // Set new volume (reduced timeout for faster failure detection)
      await this.sendMcpAndWait("self.audio_speaker.set_volume", { volume: newVolume }, 3000);

      // Update cached volume
      this.lastKnownVolume = newVolume;

      // console.log(`✅ [VOLUME-ADJUST] Volume adjusted successfully: ${currentVolume} → ${newVolume}`);
      resolve(newVolume);
    } catch (error) {
      // console.warn(`⚠️ [VOLUME-ADJUST] Error adjusting volume (non-critical):`, error.message);

      // Reset cached volume on error to force re-query next time
      this.lastKnownVolume = null;

      // Don't propagate error - graceful degradation
      resolve(null);
    } finally {
      // Mark as not processing
      this.isAdjustingVolume = false;

      // Process next request in queue (if any)
      if (this.volumeAdjustmentQueue.length > 0) {
        // console.log(`🔄 [VOLUME-QUEUE] Processing next request in queue...`);
        setImmediate(() => this.processVolumeQueue());
      }
    }
  }

  // Send LLM response to device
  sendLlmMessage(text) {
    if (!this.connection || !text) return;

    const message = {
      type: "llm",
      text: text,
      session_id: this.connection.udp.session_id,
    };

    // console.log(`📤 [MQTT OUT] Sending LLM response to device: ${this.macAddress} - "${text}"`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send record stop message to device
  sendRecordStopMessage() {
    if (!this.connection) return;

    const message = {
      type: "record_stop",
      session_id: this.connection.udp.session_id,
    };

    // console.log(`📤 [MQTT OUT] Sending record stop to device: ${this.macAddress}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send device information and initial greeting when agent joins
  /**
   * Send ready notification to client via MQTT
   * Client will press 's' key to trigger the actual greeting
   */
  async sendReadyForGreeting() {
    if (!this.connection) return;

    try {
      const readyMessage = {
        type: "ready_for_greeting",
        session_id: this.connection.udp.session_id,
        timestamp: Date.now(),
      };

      this.connection.sendMqttMessage(JSON.stringify(readyMessage));
      // console.log(`✅ [READY] Sent ready_for_greeting notification to client ${this.macAddress}. Waiting for 's' key press...`);
    } catch (error) {
      console.error(`❌ [READY] Error sending ready notification:`, error.message);
    }
  }

  async sendInitialGreeting() {
    if (!this.connection) return;

    try {
      // First send device information for prompt loading
      const deviceInfoMessage = {
        type: "device_info",
        device_mac: this.macAddress,
        device_uuid: this.uuid,
        timestamp: Date.now(),
        source: "mqtt_gateway",
      };

      // Send device info via LiveKit data channel
      if (this.room && this.room.localParticipant) {
        const deviceInfoString = JSON.stringify(deviceInfoMessage);
        const deviceInfoData = new Uint8Array(
          Buffer.from(deviceInfoString, "utf8")
        );
        await this.room.localParticipant.publishData(deviceInfoData, {
          reliable: true,
        });

        // console.log(`📱 [DEVICE INFO] Sent device MAC (${this.macAddress}) to agent via data channel`);

        // Then send greeting trigger
        const initialMessage = {
          type: "agent_ready",
          message: "Say hello to the user",
          timestamp: Date.now(),
          source: "mqtt_gateway",
        };

        const messageString = JSON.stringify(initialMessage);
        const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
        await this.room.localParticipant.publishData(messageData, {
          reliable: true,
        });

        // console.log(`🤖 [AGENT READY] Sent initial greeting trigger to agent for device: ${this.macAddress}`);
      } else {
        // console.warn(`⚠️ [AGENT READY] Cannot send messages - room not ready for device: ${this.macAddress}`);
      }
    } catch (error) {
      console.error(`❌ [AGENT READY] Error sending messages to agent:`, error.message);
    }
  }

  /**
   * Wait for agent to join the room with timeout
   * @param {number} timeoutMs - Timeout in milliseconds (default: 4000)
   * @returns {Promise<boolean>} - true if agent joined, false if timeout
   */
  async waitForAgentJoin(timeoutMs = 4000) {
    // If agent already joined, return immediately
    if (this.agentJoined) {
      // console.log(`✅ [AGENT-WAIT] Agent already joined`);
      return true;
    }

    // console.log(`⏳ [AGENT-WAIT] Waiting for agent to join (timeout: ${timeoutMs}ms)...`);

    // Race between agent join and timeout
    const timeoutPromise = new Promise((resolve) => {
      this.agentJoinTimeout = setTimeout(() => {
        // console.log(`⏰ [AGENT-WAIT] Timeout reached, proceeding anyway`);
        resolve(false);
      }, timeoutMs);
    });

    const result = await Promise.race([
      this.agentJoinPromise.then(() => true),
      timeoutPromise,
    ]);

    return result;
  }

  async sendAbortSignal(sessionId) {
    /**
     * Send abort signal to LiveKit agent via data channel
     * This tells the agent to stop current TTS/music playback
     */
    if (!this.room || !this.room.localParticipant) {
      throw new Error("Room not connected or no local participant");
    }

    try {
      const abortMessage = {
        type: "abort", // Changed from "abort_playback" to match agent's expected type
        session_id: sessionId,
        timestamp: Date.now(),
        source: "mqtt_gateway",
      };

      // Send via LiveKit data channel to the agent
      // Convert to Uint8Array as required by LiveKit Node SDK
      const messageString = JSON.stringify(abortMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
      await this.room.localParticipant.publishData(messageData, {
        reliable: true,
      });

      // console.log(`🛑 [ABORT] Sent abort signal to LiveKit agent via data channel`);

      // CRITICAL: Clear the audio playing flag immediately when abort is sent
      this.isAudioPlaying = false;
      this.audioPlayingStartTime = null;
      // console.log(`🎵 [ABORT-CLEAR] Cleared audio playing flag for device: ${this.macAddress}`);
    } catch (error) {
      console.error(`[LiveKitBridge] Failed to send abort signal:`, error.message);
      throw error;
    }
  }

  async sendEndPrompt(sessionId) {
    /**
     * Send end prompt signal to LiveKit agent via data channel
     * This tells the agent to say goodbye using the end prompt before session ends
     */
    if (!this.room || !this.room.localParticipant) {
      throw new Error("Room not connected or no local participant");
    }

    // Check if the room is still connected before trying to send data
    if (!this.room.isConnected) {
      // console.log(`👋 [END-PROMPT] Room already disconnected, skipping end prompt`);
      return;
    }

    try {
      const endMessage = {
        type: "end_prompt",
        session_id: sessionId,
        prompt:
          "You must end this conversation now. Start with 'Time flies so fast' and say a SHORT goodbye in 1-2 sentences maximum. Do NOT ask questions or suggest activities. Just say goodbye emotionally and end the conversation.",
        timestamp: Date.now(),
        source: "mqtt_gateway",
      };

      // Send via LiveKit data channel to the agent
      // Convert to Uint8Array as required by LiveKit Node SDK
      const messageString = JSON.stringify(endMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));
      await this.room.localParticipant.publishData(messageData, {
        reliable: true,
      });

      // console.log(`👋 [END-PROMPT] Sent end prompt to LiveKit agent via data channel`);
    } catch (error) {
      console.error(`[LiveKitBridge] Failed to send end prompt:`, error.message);
      // Don't throw the error - just log it and continue with cleanup
      // console.log(`👋 [END-PROMPT] Continuing with connection cleanup despite end prompt failure`);
    }
  }

  async close() {
    if (this.room) {
      console.log("[LiveKitBridge] Disconnecting from LiveKit room");

      // CRITICAL: Clear audio flag before disconnect to prevent stuck state
      this.isAudioPlaying = false;
      this.audioPlayingStartTime = null;
      console.log(
        `🎵 [CLEANUP] Cleared audio flag on bridge close for device: ${this.macAddress}`
      );

      // Step 1: Send cleanup signal to agent BEFORE disconnecting (while still connected)
      try {
        const cleanupMessage = {
          type: "cleanup_request",
          session_id: this.connection.udp.session_id,
          timestamp: Date.now(),
          source: "mqtt_gateway",
        };

        if (this.room.localParticipant && this.room.isConnected) {
          const messageString = JSON.stringify(cleanupMessage);
          const messageData = new Uint8Array(
            Buffer.from(messageString, "utf8")
          );
          await this.room.localParticipant.publishData(messageData, {
            reliable: true,
          });
          console.log("🧹 Sent cleanup signal to agent before disconnect");
        }
      } catch (error) {
        console.log(
          "Note: Could not send cleanup signal (room may already be disconnecting)"
        );
      }

      // Step 2: Disconnect from the room
      try {
        await this.room.disconnect();
        console.log(`✅ [CLEANUP] Disconnected from room: ${this.roomName}`);
      } catch (error) {
        console.log(`⚠️ [CLEANUP] Error disconnecting from room: ${error.message}`);
      }

      // Step 3: Force delete the room from LiveKit server to remove all participants
      if (this.roomService && this.roomName) {
        try {
          await this.roomService.deleteRoom(this.roomName);
          console.log(`✅ [CLEANUP] Deleted room from LiveKit: ${this.roomName}`);
        } catch (error) {
          // Room might already be gone, that's okay
          console.log(`⚠️ [CLEANUP] Could not delete room (may already be removed): ${error.message}`);
        }
      } else {
        console.log(`⚠️ [CLEANUP] No roomService or roomName available for room deletion`);
      }

      this.room = null;
    }
  }

  /**
   * Clean up all old LiveKit rooms for a specific MAC address
   * Finds and deletes ALL rooms ending with the MAC address pattern
   * This ensures no ghost sessions exist before creating a new one
   *
   * @param {string} macAddress - MAC address with colons (e.g., "28:56:2f:07:c6:ec")
   * @param {RoomServiceClient} roomService - LiveKit room service client
   */
  static async cleanupOldSessionsForDevice(
    macAddress,
    roomService,
    currentRoomName = null
  ) {
    try {
      // Convert MAC address format: "28:56:2f:07:c6:ec" → "28562f07c6ec"
      const macForRoom = macAddress.replace(/:/g, "");
      console.log(
        `🧹 [CLEANUP] Searching for old sessions for MAC: ${macAddress} (${macForRoom})`
      );
      if (currentRoomName) {
        console.log(
          `🔒 [CLEANUP] Protecting current room from deletion: ${currentRoomName}`
        );
      }

      // Safety check: Ensure roomService is available
      if (!roomService) {
        console.log(`⚠️ [CLEANUP] RoomService not available, skipping cleanup`);
        return;
      }

      // Get ALL active rooms from LiveKit server
      const allRooms = await roomService.listRooms();
      console.log(`📊 [CLEANUP] Found ${allRooms.length} total active rooms`);

      // Filter rooms belonging to this device (pattern: *_28562f07c6ec)
      // BUT exclude the current room being created
      const deviceRooms = allRooms.filter((room) => {
        if (!room.name || !room.name.endsWith(`_${macForRoom}`)) {
          return false;
        }

        // CRITICAL: Never delete the room we're currently creating
        if (currentRoomName && room.name === currentRoomName) {
          console.log(
            `   🔒 Skipping current room: ${room.name} (actively being used)`
          );
          return false;
        }

        return true;
      });

      if (deviceRooms.length > 0) {
        console.log(
          `🗑️ [CLEANUP] Found ${deviceRooms.length} old session(s) for MAC ${macAddress}:`
        );

        // Delete each old room
        for (const room of deviceRooms) {
          const roomCreationTime = Number(room.creationTime);
          const roomAge = now - roomCreationTime;
          console.log(
            `   - Deleting room: ${room.name} (${room.numParticipants
            } participants, age: ${roomAge.toFixed(0)}s)`
          );
          try {
            await roomService.deleteRoom(room.name);
            console.log(`   ✅ Successfully deleted room: ${room.name}`);
          } catch (deleteError) {
            console.error(
              `   ❌ Failed to delete room ${room.name}:`,
              deleteError.message
            );
            // Continue with other rooms even if one fails
          }
        }

        console.log(`✅ [CLEANUP] Completed cleanup for MAC ${macAddress}`);

        // Wait for cleanup to propagate on LiveKit server
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        console.log(`✓ [CLEANUP] No old sessions found for MAC: ${macAddress}`);
      }
    } catch (error) {
      console.error(
        `❌ [CLEANUP] Error cleaning up sessions for MAC ${macAddress}:`,
        error.message
      );
      // Don't throw - continue with connection attempt even if cleanup fails
    }
  }
}


module.exports = { LiveKitBridge, setConfigManager };

