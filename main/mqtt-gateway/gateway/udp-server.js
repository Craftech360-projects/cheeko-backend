/**
 * UDP Server
 * 
 * Handles UDP audio packet reception and transmission.
 * Integrates with encryption/decryption for secure audio streaming.
 */

const dgram = require('dgram');
const { streamingCrypto } = require('../core/streaming-crypto');

/**
 * UDP Server for audio streaming
 */
class UdpServer {
    constructor(port = 1883, publicIp = null) {
        this.port = port;
        this.publicIp = publicIp || process.env.PUBLIC_IP || '0.0.0.0';
        this.socket = null;
        this.messageHandlers = [];
    }

    /**
     * Start UDP server
     */
    start() {
        return new Promise((resolve, reject) => {
            this.socket = dgram.createSocket('udp4');

            this.socket.on('error', (err) => {
                console.error(`❌ [UDP] Server error:`, err);
                reject(err);
            });

            this.socket.on('message', (msg, rinfo) => {
                // Notify all registered handlers
                this.messageHandlers.forEach(handler => {
                    try {
                        handler(msg, rinfo);
                    } catch (error) {
                        console.error(`❌ [UDP] Handler error:`, error);
                    }
                });
            });

            this.socket.on('listening', () => {
                const address = this.socket.address();
                console.log(`✅ [UDP] Server listening on ${address.address}:${address.port}`);
                console.log(`📡 [UDP] Public IP: ${this.publicIp}`);
                resolve();
            });

            this.socket.bind(this.port);
        });
    }

    /**
     * Register message handler
     * @param {Function} handler - Handler function (msg, rinfo) => void
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Send UDP message
     * @param {Buffer} message - Message buffer
     * @param {number} port - Destination port
     * @param {string} address - Destination address
     */
    send(message, port, address) {
        if (!this.socket) {
            console.error(`❌ [UDP] Socket not initialized`);
            return;
        }

        this.socket.send(message, port, address, (err) => {
            if (err) {
                console.error(`❌ [UDP] Send error:`, err);
            }
        });
    }

    /**
     * Send encrypted audio packet
     * @param {Buffer} audioData - Audio data to send
     * @param {Buffer} encryptionKey - Encryption key
     * @param {Buffer} header - Packet header (IV)
     * @param {number} port - Destination port
     * @param {string} address - Destination address
     */
    sendEncrypted(audioData, encryptionKey, header, port, address) {
        try {
            // Encrypt audio data
            const encrypted = streamingCrypto.encrypt(
                audioData,
                'aes-128-ctr',
                encryptionKey,
                header
            );

            // Combine header + encrypted data
            const packet = Buffer.concat([header, encrypted]);

            this.send(packet, port, address);
        } catch (error) {
            console.error(`❌ [UDP] Encryption error:`, error);
        }
    }

    /**
     * Stop UDP server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.socket) {
                this.socket.close(() => {
                    console.log(`🛑 [UDP] Server stopped`);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get server info
     */
    getInfo() {
        if (!this.socket) {
            return null;
        }

        const address = this.socket.address();
        return {
            port: address.port,
            address: address.address,
            publicIp: this.publicIp,
        };
    }
}

module.exports = {
    UdpServer,
};
