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
                action: action,  // Changed from 'cmd' to 'action' to match firmware
                value: value,
                duration: duration,
                speed: speed,
                count: count,
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

    // ============ Car Control Endpoint (Legacy - global topic) ============
    router.post('/car/control', async (req, res) => {
        const { cmd } = req.body;

        // Validate command
        const validCommands = ['forward', 'backward', 'reverse', 'left', 'right', 'stop'];
        if (!cmd || !validCommands.includes(cmd.toLowerCase())) {
            return res.status(400).json({
                success: false,
                error: `Invalid command. Must be one of: ${validCommands.join(', ')}`
            });
        }

        try {
            console.log(`[API] Car control (legacy): ${cmd}`);

            // MQTT topic for car control (matches ESP32 car code)
            const topic = 'esp32/car_control';
            const payload = JSON.stringify({ cmd: cmd.toLowerCase() });

            // Publish to MQTT broker via gateway
            mqttGateway.mqttPublish(topic, payload, {}, (err) => {
                if (err) {
                    console.error(`[API] Failed to publish car command: ${err.message}`);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }
            });

            // Return success response
            res.json({
                success: true,
                message: `Car command '${cmd}' sent`,
                command: cmd.toLowerCase()
            });

        } catch (error) {
            console.error(`[API] Error in car control endpoint:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ============ Accessory Control Endpoint (NEW - per-toy binding) ============
    // POST /api/device/:toyMac/accessory/:type/control
    // Looks up accessory MAC from Manager API and sends command to accessory's topic
    router.post('/device/:toyMac/accessory/:type/control', async (req, res) => {
        const { toyMac, type } = req.params;
        const { action, value } = req.body;

        try {
            console.log(`[API] Accessory control: toy=${toyMac}, type=${type}, action=${action}`);

            // Normalize toy MAC (remove colons, lowercase)
            const normalizedToyMac = toyMac.replace(/:/g, '').replace(/-/g, '').toLowerCase();

            // 1. Look up accessory MAC from Manager API
            const managerApiUrl = process.env.MANAGER_API_URL || 'http://localhost:8002';
            const managerApiSecret = process.env.MANAGER_API_SECRET || '';

            const lookupUrl = `${managerApiUrl}/device/${normalizedToyMac}/accessory/${type}`;
            console.log(`[API] Looking up accessory from: ${lookupUrl}`);

            const fetch = (await import('node-fetch')).default;
            const accessoryResponse = await fetch(lookupUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'secret': managerApiSecret  // Manager API uses 'secret' header
                }
            });

            const accessoryData = await accessoryResponse.json();
            console.log(`[API] Manager API response:`, accessoryData);

            // Manager API returns { code: 0, msg: "success", data: {...} }
            if (accessoryData.code !== 0 || !accessoryData.data) {
                const errorMsg = accessoryData.msg || `No ${type} accessory bound to toy ${toyMac}`;
                console.warn(`[API] Accessory lookup failed: ${errorMsg}`);
                return res.status(404).json({
                    success: false,
                    error: errorMsg
                });
            }

            const accessoryMac = accessoryData.data.accessoryMac;
            if (!accessoryMac) {
                return res.status(404).json({
                    success: false,
                    error: `No ${type} accessory MAC found for toy ${toyMac}`
                });
            }

            // 2. Format accessory MAC with colons for MQTT topic
            // Manager API returns: 841fe816e54c
            // Firmware expects topic: devices/p2p/84:1f:e8:16:e5:4c
            const cleanMac = accessoryMac.replace(/:/g, '').replace(/-/g, '').toLowerCase();
            const formattedAccessoryMac = cleanMac.match(/.{1,2}/g).join(':');

            console.log(`[API] Formatted accessory MAC: ${accessoryMac} -> ${formattedAccessoryMac}`);

            // 3. Send command to accessory's topic
            const topic = `devices/p2p/${formattedAccessoryMac}`;

            const payload = JSON.stringify({
                type: 'control',
                action: action,  // Changed from 'cmd' to 'action' to match firmware
                value: value,
                timestamp: Date.now()
            });

            console.log(`[API] Publishing to ${topic}: ${payload}`);

            mqttGateway.mqttPublish(topic, payload, {}, (err) => {
                if (err) {
                    console.error(`[API] Failed to publish to accessory: ${err.message}`);
                }
            });

            // Return success response
            res.json({
                success: true,
                message: `Command '${action}' sent to ${type}`,
                toy_mac: normalizedToyMac,
                accessory_mac: formattedAccessoryMac,
                action: action
            });

        } catch (error) {
            console.error(`[API] Error in accessory control:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = { initDeviceAPI };
