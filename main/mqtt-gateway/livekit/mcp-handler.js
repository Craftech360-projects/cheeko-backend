/**
 * MCP Handler
 * 
 * Handles MCP (Model Context Protocol) requests and responses.
 * Manages volume control, device commands, and function calls.
 */

/**
 * MCP Handler for device control
 */
class McpHandler {
    constructor(bridge) {
        this.bridge = bridge;
        this.pendingMcpRequests = new Map();
        this.mcpRequestCounter = 1;

        // Volume adjustment queue for request serialization
        this.volumeAdjustmentQueue = [];
        this.isAdjustingVolume = false;
        this.lastKnownVolume = null; // Optimistic volume tracking
        this.volumeDebounceTimer = null; // Debounce timer for volume changes
        this.pendingVolumeAction = null; // Accumulator for debounced volume actions
    }

    /**
     * Handle function call from LiveKit agent
     * @param {Object} data - Function call data
     */
    handleFunctionCall(data) {
        const functionName = data.function_call?.name;

        console.log(`🔧 [MCP] Handling function call: ${functionName}`);

        // Route to appropriate handler based on function name
        if (functionName && functionName.startsWith('self.audio_speaker.')) {
            this.handleAudioSpeakerFunction(data);
        } else if (functionName && functionName.startsWith('self.led.')) {
            this.handleLedFunction(data);
        } else if (functionName === 'self.get_device_status') {
            this.handleGetDeviceStatus(data);
        } else {
            console.warn(`⚠️ [MCP] Unknown function: ${functionName}`);
        }
    }

    /**
     * Handle audio speaker functions (volume, mute, etc.)
     */
    handleAudioSpeakerFunction(data) {
        const functionName = data.function_call?.name;
        const args = data.function_call?.arguments || {};

        if (functionName === 'self.audio_speaker.set_volume') {
            this.handleSetVolume(args.volume, data.function_call.id);
        } else if (functionName === 'self.audio_speaker.mute') {
            this.handleMute(data.function_call.id);
        } else if (functionName === 'self.audio_speaker.unmute') {
            this.handleUnmute(data.function_call.id);
        }
    }

    /**
     * Handle LED functions
     */
    handleLedFunction(data) {
        const functionName = data.function_call?.name;
        const args = data.function_call?.arguments || {};

        console.log(`💡 [MCP] LED function: ${functionName}`, args);

        // Send MCP request to device
        this.sendMcpRequest(functionName, args, data.function_call.id);
    }

    /**
     * Handle get device status
     */
    handleGetDeviceStatus(data) {
        console.log(`📊 [MCP] Get device status request`);
        this.sendMcpRequest('self.get_device_status', {}, data.function_call.id);
    }

    /**
     * Handle volume adjustment with debouncing
     */
    handleSetVolume(volume, callId) {
        console.log(`🔊 [MCP] Set volume: ${volume}`);

        // Debounce rapid volume changes
        if (this.volumeDebounceTimer) {
            clearTimeout(this.volumeDebounceTimer);
        }

        this.pendingVolumeAction = { volume, callId };

        this.volumeDebounceTimer = setTimeout(() => {
            if (this.pendingVolumeAction) {
                this.sendMcpRequest(
                    'self.audio_speaker.set_volume',
                    { volume: this.pendingVolumeAction.volume },
                    this.pendingVolumeAction.callId
                );
                this.pendingVolumeAction = null;
            }
        }, 300); // 300ms debounce
    }

    /**
     * Handle mute
     */
    handleMute(callId) {
        console.log(`🔇 [MCP] Mute`);
        this.sendMcpRequest('self.audio_speaker.mute', {}, callId);
    }

    /**
     * Handle unmute
     */
    handleUnmute(callId) {
        console.log(`🔊 [MCP] Unmute`);
        this.sendMcpRequest('self.audio_speaker.unmute', {}, callId);
    }

    /**
     * Send MCP request to device
     */
    sendMcpRequest(method, args, callId) {
        const mcpId = this.mcpRequestCounter++;

        const mcpRequest = {
            type: 'mcp',
            payload: {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {
                    name: method,
                    arguments: args,
                },
                id: mcpId,
            },
        };

        // Track pending request
        this.pendingMcpRequests.set(mcpId, {
            callId,
            method,
            timestamp: Date.now(),
        });

        // Send to device via connection
        if (this.bridge.connection && this.bridge.connection.sendMqttMessage) {
            this.bridge.connection.sendMqttMessage(JSON.stringify(mcpRequest));
            console.log(`📤 [MCP] Sent request ${mcpId}: ${method}`);
        } else {
            console.error(`❌ [MCP] No connection available to send request`);
        }
    }

    /**
     * Handle MCP response from device
     */
    handleMcpResponse(response) {
        const mcpId = response.payload?.id;
        const pending = this.pendingMcpRequests.get(mcpId);

        if (pending) {
            console.log(`📥 [MCP] Received response for ${pending.method}`);
            this.pendingMcpRequests.delete(mcpId);

            // TODO: Send response back to LiveKit agent if needed
        } else {
            console.warn(`⚠️ [MCP] Received response for unknown request ${mcpId}`);
        }
    }

    /**
     * Clean up pending requests
     */
    cleanup() {
        if (this.volumeDebounceTimer) {
            clearTimeout(this.volumeDebounceTimer);
        }
        this.pendingMcpRequests.clear();
    }
}

module.exports = {
    McpHandler,
};
