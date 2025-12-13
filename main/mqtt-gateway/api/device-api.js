// """
// REST API endpoints for MQTT Gateway to handle device control requests.

// Add this to your existing MQTT Gateway to expose REST API for MCP server.
// """

const express = require('express');
const router = express.Router();

/**
 * Initialize API routes with MQTT Gateway instance
 * @param {MQTTGateway} mqttGateway - The MQTT Gateway instance
 */
function initDeviceAPI(mqttGateway) {

    // ============ Device Control Endpoint ============
    router.post('/device/:deviceId/control', async (req, res) => {
        const { deviceId } = req.params;
        const { action, value, duration, speed, count } = req.body;

        try {
            console.log(`[API] Control request: ${deviceId} - ${action} - value:${value} duration:${duration} speed:${speed} count:${count}`);

            // Prepare MQTT message
            const topic = `devices/p2p/${deviceId}`;
            const payload = JSON.stringify({
                type: 'control',
                action: action,
                value: value,
                duration: duration || null,
                speed: speed || null,
                count: count || null,
                timestamp: Date.now()
            });

            // Publish to MQTT broker via gateway
            mqttGateway.mqttPublish(topic, payload, {}, (err) => {
                if (err) {
                    console.error(`[API] Failed to publish: ${err.message}`);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }
            });

            // Return success response
            res.json({
                success: true,
                message: `Command ${action} sent to ${deviceId}`,
                device_id: deviceId,
                action: action,
                value: value
            });

        } catch (error) {
            console.error(`[API] Error in control endpoint:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ============ Device Status Endpoint ============
    router.get('/device/:deviceId/status', (req, res) => {
        const { deviceId } = req.params;

        try {
            // Get connection from MQTT Gateway
            const connection = mqttGateway.connections.get(deviceId);

            if (!connection) {
                return res.status(404).json({
                    success: false,
                    error: 'Device not found or not connected'
                });
            }

            // Return device status
            res.json({
                success: true,
                connected: true,
                device_id: deviceId,
                mode: connection.currentMode || 'unknown',
                character: connection.currentCharacter || 'unknown',
                room_name: connection.roomName || null,
                last_seen: connection.lastHeartbeat || null
            });

        } catch (error) {
            console.error(`[API] Error in status endpoint:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ============ List Connected Devices ============
    router.get('/devices', (req, res) => {
        try {
            const devices = [];

            // Iterate through all connections
            for (const [deviceId, connection] of mqttGateway.connections.entries()) {
                devices.push({
                    device_id: deviceId,
                    mode: connection.currentMode,
                    character: connection.currentCharacter,
                    room_name: connection.roomName,
                    connected: true
                });
            }

            res.json({
                success: true,
                count: devices.length,
                devices: devices
            });

        } catch (error) {
            console.error(`[API] Error in devices list:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ============ Health Check ============
    router.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            service: 'mqtt-gateway-api',
            timestamp: new Date().toISOString()
        });
    });

    return router;
}

module.exports = { initDeviceAPI };
