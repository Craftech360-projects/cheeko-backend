/**
 * UDP HTTP Bridge
 *
 * Simple HTTP server that receives forwarded UDP packets from external UDP gateway
 * and re-injects them into the local UDP server.
 */

const http = require('http');
const dgram = require('dgram');

// Configuration
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 8000;
const UDP_LOCAL_PORT = parseInt(process.env.UDP_PORT) || 8884;
const UDP_LOCAL_HOST = '127.0.0.1';

// Statistics
const stats = {
    packetsReceived: 0,
    packetsForwarded: 0,
    errors: 0,
    startTime: Date.now()
};

// Create UDP client to forward to local UDP server
const udpClient = dgram.createSocket('udp4');

/**
 * Forward packet to local UDP server
 */
function forwardToLocalUdp(packet, sourceAddress, sourcePort) {
    return new Promise((resolve, reject) => {
        // Forward to local UDP server (where mqtt-gateway is listening)
        udpClient.send(packet, UDP_LOCAL_PORT, UDP_LOCAL_HOST, (error) => {
            if (error) {
                console.error(`❌ [BRIDGE] Failed to forward to local UDP: ${error.message}`);
                reject(error);
            } else {
                stats.packetsForwarded++;
                resolve();
            }
        });
    });
}

/**
 * Handle HTTP request
 */
async function handleRequest(req, res) {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            uptime: (Date.now() - stats.startTime) / 1000,
            stats
        }));
        return;
    }

    // UDP forwarding endpoint
    if (req.method === 'POST' && req.url === '/udp/forward') {
        try {
            const udpSource = req.headers['x-udp-source'];
            const connectionId = req.headers['x-connection-id'];

            if (!udpSource) {
                res.writeHead(400);
                res.end('Missing X-UDP-Source header');
                stats.errors++;
                return;
            }

            // Read packet data
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const packet = Buffer.concat(chunks);

            stats.packetsReceived++;

            // Log first few packets
            if (stats.packetsReceived <= 5) {
                console.log(`📦 [BRIDGE] Packet #${stats.packetsReceived}: ${packet.length} bytes from ${udpSource} (connectionId: ${connectionId})`);
            }

            // Parse source
            const [address, port] = udpSource.split(':');

            // Forward to local UDP server
            await forwardToLocalUdp(packet, address, parseInt(port));

            // Log stats periodically
            if (stats.packetsReceived % 100 === 0) {
                console.log(`📊 [BRIDGE] Stats: ${stats.packetsReceived} received, ${stats.packetsForwarded} forwarded, ${stats.errors} errors`);
            }

            res.writeHead(200);
            res.end('OK');

        } catch (error) {
            console.error(`❌ [BRIDGE] Error:`, error);
            res.writeHead(500);
            res.end('Internal server error');
            stats.errors++;
        }
        return;
    }

    // 404 for other requests
    res.writeHead(404);
    res.end('Not found');
}

/**
 * Start HTTP server
 */
function startServer() {
    const server = http.createServer(handleRequest);

    server.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log('='.repeat(60));
        console.log('🌉 UDP HTTP Bridge Started');
        console.log('='.repeat(60));
        console.log(`   HTTP Port: ${HTTP_PORT}`);
        console.log(`   UDP Forward: ${UDP_LOCAL_HOST}:${UDP_LOCAL_PORT}`);
        console.log(`   Health: http://0.0.0.0:${HTTP_PORT}/health`);
        console.log('='.repeat(60));
    });

    server.on('error', (error) => {
        console.error(`❌ [BRIDGE] Server error:`, error);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 [BRIDGE] Shutting down...');
        server.close(() => {
            udpClient.close();
            process.exit(0);
        });
    });

    process.on('SIGINT', () => {
        console.log('🛑 [BRIDGE] Shutting down...');
        server.close(() => {
            udpClient.close();
            process.exit(0);
        });
    });
}

// Start the bridge
startServer();
