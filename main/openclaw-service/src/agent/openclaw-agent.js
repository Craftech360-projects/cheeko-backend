/**
 * OpenClaw Agent
 * Main agent orchestrator that coordinates STT → LLM → TTS pipeline
 */

const DeepgramSTT = require('./deepgram-stt');
const GroqLLM = require('./groq-llm');
const ElevenLabsTTS = require('./elevenlabs-tts');
const logger = require('../utils/logger');

class OpenClawAgent {
    constructor(config) {
        this.config = config;

        // Initialize voice pipeline components
        this.stt = new DeepgramSTT(config.deepgramApiKey);
        this.llm = new GroqLLM(config.groqApiKey);
        this.tts = new ElevenLabsTTS(config.elevenlabsApiKey, config.elevenlabsVoiceId); // Use ElevenLabs for TTS

        // Tool handlers
        this.toolHandlers = new Map();
        this.registerDefaultTools();

        // Session state
        this.activeSessions = new Map(); // deviceMac -> session state

        logger.info('[AGENT] OpenClaw Agent initialized');
    }

    /**
     * Register default tool handlers
     */
    registerDefaultTools() {
        // Set reminder tool
        this.registerTool('set_reminder', async (args, deviceMac) => {
            try {
                const taskScheduler = require('../core/task-scheduler');
                const result = await taskScheduler.scheduleReminder(
                    args.text,
                    args.time,
                    deviceMac
                );
                return `Reminder set successfully for "${args.text}" at ${args.time}`;
            } catch (error) {
                logger.error('[AGENT] Error setting reminder:', error);
                return `Sorry, I couldn't set the reminder: ${error.message}`;
            }
        });

        // Send message to parent tool
        this.registerTool('send_message_to_parent', async (args, deviceMac) => {
            try {
                const messageRouter = require('../core/message-router');
                await messageRouter.sendToParent(args.message, deviceMac);
                return `Message sent to your parent: "${args.message}"`;
            } catch (error) {
                logger.error('[AGENT] Error sending message:', error);
                return `Sorry, I couldn't send the message: ${error.message}`;
            }
        });
    }

    /**
     * Register a custom tool handler
     * @param {string} toolName - Tool name
     * @param {Function} handler - Tool handler function (args, deviceMac) => Promise<string>
     */
    registerTool(toolName, handler) {
        this.toolHandlers.set(toolName, handler);
        logger.info(`[AGENT] Registered tool: ${toolName}`);
    }

    /**
    /**
     * Process voice stream data
     * @param {string} deviceMac - Device MAC address
     * @param {Buffer} audioChunk - Audio data chunk (PCM)
     */
    async processVoiceStream(deviceMac, audioChunk) {
        try {
            let session = this.activeSessions.get(deviceMac);

            // Initialize new session if needed
            if (!session) {
                logger.info(`[AGENT] Starting new voice session for ${deviceMac}`);

                // Create live transcription stream
                const liveStream = this.stt.createLiveStream({
                    encoding: 'linear16',
                    sampleRate: 16000,
                    interimResults: true,
                    endpointing: 500 // 500ms silence = end of utterance
                });

                session = {
                    liveStream,
                    transcriptBuffer: '',
                    lastActivity: Date.now(),
                    isProcessing: false
                };

                // Setup event listeners
                liveStream.addListener('Results', async (data) => {
                    this.handleTranscriptionResult(deviceMac, data);
                });

                liveStream.addListener('Error', (err) => {
                    logger.error(`[AGENT] STT Stream error for ${deviceMac}:`, err);
                    this.closeSession(deviceMac);
                });

                liveStream.addListener('Close', () => {
                    logger.info(`[AGENT] STT Stream closed for ${deviceMac}`);
                    if (this.activeSessions.has(deviceMac)) {
                        this.activeSessions.delete(deviceMac);
                    }
                });

                // Start the stream
                // Deepgram v3 requires explicit 'start' sometimes depending on sdk version, 
                // but createLiveStream usually returns a ready socket-like object.
                // We'll rely on the SDK's behavior (usually validates on first send).

                this.activeSessions.set(deviceMac, session);
            }

            // Reset inactivity timer
            session.lastActivity = Date.now();

            // Send audio to Deepgram
            if (session.liveStream.getReadyState() === 1) { // OPEN
                session.liveStream.send(audioChunk);
            } else {
                // logger.warn(`[AGENT] Stream not ready for ${deviceMac}`);
            }

        } catch (error) {
            logger.error('[AGENT] Error processing voice stream:', error);
        }
    }

    /**
     * Handle transcription results
     */
    async handleTranscriptionResult(deviceMac, data) {
        const session = this.activeSessions.get(deviceMac);
        if (!session) return;

        const sentence = data.channel.alternatives[0].transcript;
        if (sentence && data.is_final) {
            session.transcriptBuffer += ' ' + sentence;
            logger.info(`[AGENT] Interim Transcript (${deviceMac}): ${session.transcriptBuffer.trim()}`);

            // If endpointing detected or explicit end of speech logic
            // For now, simplicity: if is_final and length > 0, treat as query.
            // In rugged system, we might wait for a longer pause signal.

            // Trigger Response
            await this.finalizeAndRespond(deviceMac, session.transcriptBuffer.trim());

            // Reset buffer for next utterance or close?
            // Usually we keep stream open for multi-turn, but let's clear buffer.
            session.transcriptBuffer = '';
        }
    }

    async finalizeAndRespond(deviceMac, text) {
        if (!text) return;

        logger.info(`[AGENT] Finalized Query (${deviceMac}): "${text}"`);

        try {
            // Step 2: LLM Processing
            const llmResponse = await this.llm.generateResponse(deviceMac, text);
            let finalResponseText = llmResponse.text;

            // Step 3: Tool Execution (Simplified for stream)
            if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                const toolResults = await this.executeTools(llmResponse.toolCalls, deviceMac);
                for (const result of toolResults) {
                    this.llm.addToolResult(deviceMac, result.id, result.result);
                }
                const followUp = await this.llm.generateResponse(deviceMac, `Tool results: ${JSON.stringify(toolResults)}`);
                finalResponseText = followUp.text;
            }

            // Step 4: TTS
            const audioResponse = await this.tts.synthesize(finalResponseText);

            // Use registered callback or event to send audio back
            // We need a way to send audio back to MQTT handler.
            // For now, emit event or look up handler?
            // Ideally Agent should take a 'sendAudio' callback in constructor or method.

            if (this.onAudioResponse) {
                this.onAudioResponse(deviceMac, audioResponse);
            }

        } catch (err) {
            logger.error(`[AGENT] Response generation failed: ${err.message}`);
        }
    }

    /**
     * Close a session
     */
    closeSession(deviceMac) {
        const session = this.activeSessions.get(deviceMac);
        if (session) {
            try {
                session.liveStream.finish();
            } catch (e) { /* ignore */ }
            this.activeSessions.delete(deviceMac);
        }
    }

    // LEGACY: Process voice input and generate response (Request-Response)
    // Kept for compatibility if needed, but streaming preferred
    // async processVoiceInput(deviceMac, audioBuffer) {
    //    // Implementation removed to enforce streaming
    //    logger.warn('[AGENT] processVoiceInput called but streaming is required');
    //    return null;
    // }

    /**
     * Process text input (for reminders, RFID, etc.)
     * @param {string} deviceMac - Device MAC address
     * @param {string} text - Text input
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} - Response with audio and text
     */
    async processTextInput(deviceMac, text, options = {}) {
        try {
            logger.info(`[AGENT] Processing text input for ${deviceMac}: "${text}"`);

            // For reminders, use direct announcement
            if (options.isReminder) {
                const reminderText = text.replace('Reminder:', '').trim();
                const responseText = `Hey! It's time to ${reminderText}!`;
                const audioResponse = await this.tts.synthesize(responseText);

                return {
                    userText: text,
                    responseText: responseText,
                    audioBuffer: audioResponse,
                    toolCalls: []
                };
            }

            // Regular text processing through LLM
            const llmResponse = await this.llm.generateResponse(deviceMac, text);

            // Handle tool calls
            let finalResponseText = llmResponse.text;

            if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                const toolResults = await this.executeTools(llmResponse.toolCalls, deviceMac);

                for (const result of toolResults) {
                    this.llm.addToolResult(deviceMac, result.id, result.result);
                }

                const followUpResponse = await this.llm.generateResponse(
                    deviceMac,
                    `Tool execution results: ${toolResults.map(r => r.result).join(', ')}`
                );

                finalResponseText = followUpResponse.text;
            }

            // Fallback if LLM returns empty response
            if (!finalResponseText || finalResponseText.trim().length === 0) {
                finalResponseText = "Hi there! I'm Cheeko, ready to help!";
                logger.warn('[AGENT] LLM returned empty response, using fallback');
            }

            // Generate audio response
            const audioResponse = await this.tts.synthesize(finalResponseText);

            return {
                userText: text,
                responseText: finalResponseText,
                audioBuffer: audioResponse,
                toolCalls: llmResponse.toolCalls || []
            };

        } catch (error) {
            logger.error('[AGENT] Error processing text input:', error);
            throw error;
        }
    }

    /**
     * Execute tool calls
     * @param {Array} toolCalls - Tool calls from LLM
     * @param {string} deviceMac - Device MAC address
     * @returns {Promise<Array>} - Tool execution results
     */
    async executeTools(toolCalls, deviceMac) {
        const results = [];

        for (const toolCall of toolCalls) {
            const handler = this.toolHandlers.get(toolCall.name);

            if (!handler) {
                logger.warn(`[AGENT] No handler for tool: ${toolCall.name}`);
                results.push({
                    id: toolCall.id,
                    name: toolCall.name,
                    result: `Tool ${toolCall.name} not found`
                });
                continue;
            }

            try {
                const result = await handler(toolCall.arguments, deviceMac);
                results.push({
                    id: toolCall.id,
                    name: toolCall.name,
                    result: result
                });
                logger.info(`[AGENT] Tool executed: ${toolCall.name} -> ${result}`);
            } catch (error) {
                logger.error(`[AGENT] Tool execution error (${toolCall.name}):`, error);
                results.push({
                    id: toolCall.id,
                    name: toolCall.name,
                    result: `Error: ${error.message}`
                });
            }
        }

        return results;
    }

    /**
     * Clear conversation history for a device
     * @param {string} deviceMac - Device MAC address
     */
    clearSession(deviceMac) {
        this.llm.clearHistory(deviceMac);
        this.activeSessions.delete(deviceMac);
        logger.info(`[AGENT] Session cleared for ${deviceMac}`);
    }

    /**
     * Check if agent is ready
     * @returns {boolean}
     */
    isReady() {
        return this.stt.isReady && this.llm.isReady && this.tts.isReady;
    }
}

module.exports = OpenClawAgent;
