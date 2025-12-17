/**
 * UDP Forwarder - HTTP endpoint to receive forwarded UDP packets
 *
 * This module provides an HTTP endpoint that receives UDP packets forwarded
 * from the external UDP gateway (running on DigitalOcean) and processes them
 * as if they arrived directly via UDP.
 */

const http = require('http');

class UdpForwarder {
    constructor(port = 8000, mqttGateway) {
        this.port = port;
        this.mqttGateway = mqttGateway;
        this.server = null;
        this.stats = {
            packetsReceived: 0,
            packetsProcessed: 0,
            errors: 0
        };
    }

    /**
     * Start HTTP server to receive forwarded UDP packets
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', (err) => {
                console.error(`❌ [UDP-FWD] Server error:`, err);
                reject(err);
            });

            this.server.listen(this.port, () => {
                console.log(`✅ [UDP-FWD] Forwarder listening on port ${this.port}`);
                console.log(`   Endpoint: POST /udp/forward`);
                resolve();
            });
        });
    }

    /**
     * Handle HTTP request
     */
    async handleRequest(req, res) {
        // Handle health check
        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                stats: this.stats
            }));
            return;
        }

        // Handle UDP packet forwarding
        if (req.method === 'POST' && req.url === '/udp/forward') {
            await this.handleUdpForward(req, res);
            return;
        }

        // 404 for other requests
        res.writeHead(404);
        res.end('Not found');
    }

    /**
     * Handle forwarded UDP packet
     */
    async handleUdpForward(req, res) {
        try {
            // Extract headers
            const udpSource = req.headers['x-udp-source'];
            const connectionId = parseInt(req.headers['x-connection-id']);

            if (!udpSource || isNaN(connectionId)) {
                res.writeHead(400);
                res.end('Missing required headers');
                this.stats.errors++;
                return;
            }

            // Read packet data
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const packet = Buffer.concat(chunks);

            this.stats.packetsReceived++;

            // Parse UDP source
            const [address, port] = udpSource.split(':');
            const rinfo = {
                address,
                port: parseInt(port),
                family: 'IPv4',
                size: packet.length
            };

            // Find the connection by connectionId
            const connection = Array.from(this.mqttGateway.connections.values())
                .find(conn => conn.connectionId === connectionId);

            if (!connection) {
                console.warn(`⚠️  [UDP-FWD] Connection not found: ${connectionId}`);
                res.writeHead(404);
                res.end('Connection not found');
                this.stats.errors++;
                return;
            }

            // Process the packet through the connection
            // This simulates the packet arriving via UDP
            if (connection.handleUdpPacket) {
                await connection.handleUdpPacket(packet, rinfo);
                this.stats.packetsProcessed++;
            } else {
                console.warn(`⚠️  [UDP-FWD] Connection ${connectionId} cannot handle UDP packets`);
                this.stats.errors++;
            }

            // Send response
            res.writeHead(200);
            res.end('OK');

        } catch (error) {
            console.error(`❌ [UDP-FWD] Error processing packet:`, error);
            res.writeHead(500);
            res.end('Internal server error');
            this.stats.errors++;
        }
    }

    /**
     * Stop server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log(`🛑 [UDP-FWD] Forwarder stopped`);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = { UdpForwarder };
