/**
 * Groq LLM Client
 * Handles language model processing using Groq API with llama-3
 */

const Groq = require('groq-sdk');
const logger = require('../utils/logger');

class GroqLLM {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('Groq API key is required');
        }

        this.client = new Groq({ apiKey });
        this.model = 'openai/gpt-oss-20b';
        this.conversationHistory = new Map(); // deviceMac -> messages[]
        this.isReady = true;

        logger.info(`[GROQ] LLM client initialized with model: ${this.model}`);
    }

    /**
     * Get system prompt for Cheeko
     */
    getSystemPrompt() {
        return `You are Cheeko, a friendly and helpful AI companion for children.
You speak in a warm, encouraging tone and keep responses brief and clear (1-2 sentences max).
You can help with:
- Setting reminders
- Sending messages to parents
- Answering questions
- Having friendly conversations

Always be positive, patient, and age-appropriate.
When using tools, confirm the action briefly.`;
    }

    /**
     * Get tool definitions for function calling
     */
    getTools() {
        return [
            {
                type: "function",
                function: {
                    name: "set_reminder",
                    description: "Set a reminder for the user at a specific time",
                    parameters: {
                        type: "object",
                        properties: {
                            text: {
                                type: "string",
                                description: "What to remind about (e.g., 'do homework', 'call friend')"
                            },
                            time: {
                                type: "string",
                                description: "When to remind (e.g., '5pm', '3:30pm', 'tomorrow at 9am')"
                            }
                        },
                        required: ["text", "time"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "send_message_to_parent",
                    description: "Send a WhatsApp message to the child's parent",
                    parameters: {
                        type: "object",
                        properties: {
                            message: {
                                type: "string",
                                description: "Message content to send to parent"
                            }
                        },
                        required: ["message"]
                    }
                }
            }
        ];
    }

    /**
     * Generate a response from the LLM
     * @param {string} deviceMac - Device MAC address for conversation context
     * @param {string} userMessage - User's message
     * @returns {Promise<Object>} - Response with text and optional tool calls
     */
    async generateResponse(deviceMac, userMessage) {
        try {
            // Get or initialize conversation history
            if (!this.conversationHistory.has(deviceMac)) {
                this.conversationHistory.set(deviceMac, [
                    { role: 'system', content: this.getSystemPrompt() }
                ]);
            }

            const messages = this.conversationHistory.get(deviceMac);

            // Add user message
            messages.push({ role: 'user', content: userMessage });

            // Keep only last 10 messages (plus system prompt)
            if (messages.length > 11) {
                messages.splice(1, messages.length - 11);
            }

            logger.info(`[GROQ] Generating response for: "${userMessage}"`);

            // Call Groq API
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                tools: this.getTools(),
                tool_choice: 'auto',
                temperature: 0.7,
                max_tokens: 150,
            });

            const choice = response.choices[0];
            const assistantMessage = choice.message;

            // Add assistant response to history
            messages.push(assistantMessage);

            // Check for tool calls
            if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                const toolCalls = assistantMessage.tool_calls.map(tc => ({
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments),
                    id: tc.id
                }));

                logger.info(`[GROQ] Tool calls requested:`, toolCalls.map(t => t.name));

                return {
                    text: assistantMessage.content || '',
                    toolCalls: toolCalls,
                    finishReason: choice.finish_reason
                };
            }

            // Regular text response
            const responseText = assistantMessage.content || '';
            logger.info(`[GROQ] Response: "${responseText}"`);

            return {
                text: responseText,
                toolCalls: null,
                finishReason: choice.finish_reason
            };

        } catch (error) {
            logger.error('[GROQ] Error generating response:', error);
            throw error;
        }
    }

    /**
     * Add tool result to conversation
     * @param {string} deviceMac - Device MAC address
     * @param {string} toolCallId - Tool call ID
     * @param {string} result - Tool execution result
     */
    addToolResult(deviceMac, toolCallId, result) {
        const messages = this.conversationHistory.get(deviceMac);
        if (messages) {
            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: result
            });
        }
    }

    /**
     * Clear conversation history for a device
     * @param {string} deviceMac - Device MAC address
     */
    clearHistory(deviceMac) {
        this.conversationHistory.delete(deviceMac);
        logger.info(`[GROQ] Cleared conversation history for ${deviceMac}`);
    }
}

module.exports = GroqLLM;
