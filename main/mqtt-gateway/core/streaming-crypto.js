/**
 * Streaming Crypto with Cipher Caching
 * 
 * Optimized streaming crypto with cipher caching.
 * Phase 1 optimization from AUDIO_OPTIMIZATION_PLAN.md
 * Reduces cipher creation overhead by reusing cipher instances.
 */

const crypto = require("crypto");

/**
 * Optimized streaming crypto with cipher caching
 * Implements LRU cache for cipher instances to reduce overhead
 */
class StreamingCrypto {
    constructor() {
        this.encryptCipherCache = new Map();
        this.decryptCipherCache = new Map();
        this.maxCacheSize = 20; // Limit cache size to prevent memory leak
    }

    /**
     * Encrypt data with cached cipher for performance
     * @param {Buffer} data - Data to encrypt
     * @param {string} algorithm - Encryption algorithm (e.g., 'aes-128-ctr')
     * @param {Buffer} key - Encryption key
     * @param {Buffer} iv - Initialization vector (header)
     * @returns {Buffer} Encrypted data
     */
    encrypt(data, algorithm, key, iv) {
        const cacheKey = `${algorithm}:${key.toString("hex")}:${iv.toString(
            "hex"
        )}`;
        let cipher = this.encryptCipherCache.get(cacheKey);

        if (!cipher) {
            cipher = crypto.createCipheriv(algorithm, key, iv);

            // LRU eviction if cache is full
            if (this.encryptCipherCache.size >= this.maxCacheSize) {
                const firstKey = this.encryptCipherCache.keys().next().value;
                this.encryptCipherCache.delete(firstKey);
            }

            this.encryptCipherCache.set(cacheKey, cipher);
        }

        return Buffer.concat([cipher.update(data), cipher.final()]);
    }

    /**
     * Decrypt data with cached cipher for performance
     * @param {Buffer} data - Data to decrypt
     * @param {string} algorithm - Encryption algorithm (e.g., 'aes-128-ctr')
     * @param {Buffer} key - Decryption key
     * @param {Buffer} iv - Initialization vector (header)
     * @returns {Buffer} Decrypted data
     */
    decrypt(data, algorithm, key, iv) {
        const cacheKey = `${algorithm}:${key.toString("hex")}:${iv.toString(
            "hex"
        )}`;
        let decipher = this.decryptCipherCache.get(cacheKey);

        if (!decipher) {
            decipher = crypto.createDecipheriv(algorithm, key, iv);

            // LRU eviction if cache is full
            if (this.decryptCipherCache.size >= this.maxCacheSize) {
                const firstKey = this.decryptCipherCache.keys().next().value;
                this.decryptCipherCache.delete(firstKey);
            }

            this.decryptCipherCache.set(cacheKey, decipher);
        }

        return Buffer.concat([decipher.update(data), decipher.final()]);
    }

    /**
     * Clear all cached ciphers
     */
    clearCache() {
        this.encryptCipherCache.clear();
        this.decryptCipherCache.clear();
    }
}

// Global streaming crypto instance for reuse across connections
const streamingCrypto = new StreamingCrypto();

module.exports = {
    StreamingCrypto,
    streamingCrypto,
};
