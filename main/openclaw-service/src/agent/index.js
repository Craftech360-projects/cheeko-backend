/**
 * Agent Initialization
 * Initializes and manages the OpenClaw agent
 */

const OpenClawAgent = require('./openclaw-agent');
const AgentMQTTHandler = require('./agent-mqtt-handler');
const AgentLiveKitHandler = require('./agent-livekit-handler');
const logger = require('../utils/logger');
const config = require('../config/openclaw.config');

let agentInstance = null;
let mqttHandler = null;
let livekitHandler = null;

/**
 * Initialize the OpenClaw agent
 * @param {Object} mqttClient - MQTT client instance
 * @returns {Object} - Agent instance
 */
async function initializeAgent(mqttClient) {
    try {
        // Check if agent is enabled
        if (!config.features.openclawAgent) {
            logger.info('[AGENT] OpenClaw agent is disabled in config');
            return null;
        }

        // Check if API keys are configured
        if (!config.ai.deepgramApiKey || !config.ai.groqApiKey || !config.ai.elevenlabsApiKey) {
            logger.warn('[AGENT] Deepgram, Groq, or ElevenLabs API keys not configured, agent disabled');
            logger.warn('[AGENT] Please set DEEPGRAM_API_KEY, GROQ_API_KEY, and ELEVENLABS_API_KEY in .env');
            return null;
        }

        logger.info('[AGENT] Initializing OpenClaw agent...');

        // Create agent instance
        agentInstance = new OpenClawAgent({
            deepgramApiKey: config.ai.deepgramApiKey,
            groqApiKey: config.ai.groqApiKey,
            elevenlabsApiKey: config.ai.elevenlabsApiKey,
            elevenlabsVoiceId: config.ai.elevenlabsVoiceId,
        });

        // Create LiveKit handler
        livekitHandler = new AgentLiveKitHandler({
            livekitUrl: config.livekit.url,
            livekitApiKey: config.livekit.apiKey,
            livekitApiSecret: config.livekit.apiSecret,
        });

        // Create MQTT handler
        mqttHandler = new AgentMQTTHandler(mqttClient, agentInstance, livekitHandler);

        logger.info('[AGENT] ✅ OpenClaw agent initialized successfully');
        logger.info('[AGENT] Voice pipeline ready: Deepgram (STT) + ElevenLabs (TTS) → Groq (gpt-oss-20b)');

        return agentInstance;

    } catch (error) {
        logger.error('[AGENT] Failed to initialize agent:', error);
        return null;
    }
}

/**
 * Get agent instance
 * @returns {Object|null} - Agent instance or null if not initialized
 */
function getAgent() {
    return agentInstance;
}

/**
 * Check if agent is ready
 * @returns {boolean}
 */
function isAgentReady() {
    return agentInstance && agentInstance.isReady();
}

/**
 * Shutdown agent
 */
async function shutdownAgent() {
    if (agentInstance) {
        logger.info('[AGENT] Shutting down agent...');
        agentInstance = null;
        mqttHandler = null;
        livekitHandler = null;
        logger.info('[AGENT] Agent shutdown complete');
    }
}

module.exports = {
    initializeAgent,
    getAgent,
    isAgentReady,
    shutdownAgent,
};
