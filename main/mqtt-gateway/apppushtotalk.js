// Description: MQTT+UDP to LiveKit bridge
// Author: terrence@tenclass.com
// Date: 2025-03-12
// Modified by: Gemini

require("dotenv").config();
const JSON5 = require("json5");

const net = require("net");
const debugModule = require("debug");
const debug = debugModule("mqtt-server");
const crypto = require("crypto");
const dgram = require("dgram");
const Emitter = require("events");
const { AccessToken, RoomServiceClient, AgentDispatchClient } = require("livekit-server-sdk");
const {
  Room,
  RoomEvent,
  AudioSource,
  AudioFrame,
  AudioStream,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  TrackKind,
  AudioResampler,
  AudioResamplerQuality,
} = require("@livekit/rtc-node");
// ========================================
// PHASE 1 OPTIMIZATION: Native Opus Only (@discordjs/opus)
// ========================================
// Use only @discordjs/opus (native libopus bindings) for maximum performance
let OpusEncoder, OpusDecoder;
let opusLib = null;

try {
  const discordOpus = require("@discordjs/opus");
  OpusEncoder = discordOpus.OpusEncoder;
  OpusDecoder = discordOpus.OpusEncoder; // Discord opus uses same class for encoding/decoding
  opusLib = "@discordjs/opus";
  console.log("✅ [OPUS PHASE-1] Using native @discordjs/opus only (libopus bindings - OPTIMIZED)");
} catch (err) {
  console.error("❌ [OPUS] @discordjs/opus not available:", err.message);
  console.error("❌ [OPUS] Cannot proceed without Opus library. Please run: npm install @discordjs/opus");
  OpusEncoder = null;
  OpusDecoder = null;
  process.exit(1); // Exit if Opus not available - it's required
}

// Initialize Opus encoder for 24kHz mono (outgoing), decoder for 16kHz mono (incoming)
let opusEncoder = null;
let opusDecoder = null;

// Define constants for audio parameters
const OUTGOING_SAMPLE_RATE = 24000;  // Hz - for LiveKit → ESP32
const INCOMING_SAMPLE_RATE = 16000;  // Hz - for ESP32 → LiveKit
const CHANNELS = 1;            // Mono
const OUTGOING_FRAME_DURATION_MS = 60;  // 60ms frames for outgoing (LiveKit → ESP32)
const INCOMING_FRAME_DURATION_MS = 60;  // 60ms frames for incoming (ESP32 → LiveKit)
const OUTGOING_FRAME_SIZE_SAMPLES = (OUTGOING_SAMPLE_RATE * OUTGOING_FRAME_DURATION_MS) / 1000; // 24000 * 60 / 1000 = 1440
const INCOMING_FRAME_SIZE_SAMPLES = (INCOMING_SAMPLE_RATE * INCOMING_FRAME_DURATION_MS) / 1000; // 16000 * 60 / 1000 = 960
const OUTGOING_FRAME_SIZE_BYTES = OUTGOING_FRAME_SIZE_SAMPLES * 2; // 1440 samples * 2 bytes/sample = 2880 bytes PCM
const INCOMING_FRAME_SIZE_BYTES = INCOMING_FRAME_SIZE_SAMPLES * 2; // 960 samples * 2 bytes/sample = 1920 bytes PCM

if (OpusEncoder) {
  try {
    // @discordjs/opus API: new OpusEncoder(sampleRate, channels)
    opusEncoder = new OpusEncoder(OUTGOING_SAMPLE_RATE, CHANNELS);
    opusDecoder = new OpusEncoder(INCOMING_SAMPLE_RATE, CHANNELS); // Same class for decode
    console.log(`✅ [OPUS PHASE-1] Native encoder/decoder initialized:`);
    console.log(`   Encoder: ${OUTGOING_SAMPLE_RATE}Hz ${OUTGOING_FRAME_DURATION_MS}ms mono`);
    console.log(`   Decoder: ${INCOMING_SAMPLE_RATE}Hz ${INCOMING_FRAME_DURATION_MS}ms mono`);
  } catch (err) {
    console.error(`❌ [OPUS] Failed to initialize encoder/decoder:`, err.message);
    process.exit(1); // Exit if initialization fails
  }
}

const mqtt = require("mqtt");
const { MQTTProtocol } = require("./mqtt-protocol");
const { ConfigManager } = require("./utils/config-manager");
const { validateMqttCredentials } = require("./utils/mqtt_config_v2");

// ========================================
// PHASE 1 OPTIMIZATION: Streaming AES Encryption
// ========================================
/**
 * Optimized streaming crypto with cipher caching
 * Phase 1 optimization from AUDIO_OPTIMIZATION_PLAN.md
 * Reduces cipher creation overhead by reusing cipher instances
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
    const cacheKey = `${algorithm}:${key.toString('hex')}:${iv.toString('hex')}`;
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
    const cacheKey = `${algorithm}:${key.toString('hex')}:${iv.toString('hex')}`;
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

// ========================================
// PHASE 2: Performance Monitoring with CPU & Memory Metrics
// ========================================
/**
 * Performance monitoring for audio processing
 * Tracks latency, throughput, CPU, memory, and resource usage
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      processingTime: [],
      queueSize: [],
      frameCount: 0,
      errorCount: 0,
      startTime: Date.now(),
      cpuUsage: [],
      memoryUsage: [],
      heapUsage: []
    };
    this.maxSamples = 100; // Keep last 100 measurements
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();

    // Start periodic resource monitoring
    this.startResourceMonitoring();
  }

  /**
   * Start periodic CPU and memory monitoring
   * Samples every 1 second
   */
  startResourceMonitoring() {
    this.resourceMonitorInterval = setInterval(() => {
      this.recordCpuUsage();
      this.recordMemoryUsage();
    }, 1000); // Sample every 1 second
  }

  /**
   * Record CPU usage percentage
   * Based on process.cpuUsage() delta
   */
  recordCpuUsage() {
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const currentTime = Date.now();
    const timeDelta = currentTime - this.lastCpuTime;

    // Calculate CPU percentage
    // cpuUsage returns microseconds, convert to percentage
    const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000) / timeDelta * 100;

    this.metrics.cpuUsage.push(cpuPercent);
    if (this.metrics.cpuUsage.length > this.maxSamples) {
      this.metrics.cpuUsage.shift();
    }

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;

    return cpuPercent;
  }

  /**
   * Record memory usage in MB
   * Tracks RSS, Heap Total, Heap Used, and External
   */
  recordMemoryUsage() {
    const mem = process.memoryUsage();

    const memoryData = {
      rss: mem.rss / 1024 / 1024, // MB
      heapTotal: mem.heapTotal / 1024 / 1024,
      heapUsed: mem.heapUsed / 1024 / 1024,
      external: mem.external / 1024 / 1024,
      timestamp: Date.now()
    };

    this.metrics.memoryUsage.push(memoryData);
    this.metrics.heapUsage.push(mem.heapUsed / 1024 / 1024);

    if (this.metrics.memoryUsage.length > this.maxSamples) {
      this.metrics.memoryUsage.shift();
    }
    if (this.metrics.heapUsage.length > this.maxSamples) {
      this.metrics.heapUsage.shift();
    }

    return memoryData;
  }

  recordProcessingTime(startTime) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // ms
    this.metrics.processingTime.push(duration);

    // Keep only last N measurements
    if (this.metrics.processingTime.length > this.maxSamples) {
      this.metrics.processingTime.shift();
    }

    return duration;
  }

  recordFrame() {
    this.metrics.frameCount++;
  }

  recordError() {
    this.metrics.errorCount++;
  }

  recordQueueSize(size) {
    this.metrics.queueSize.push(size);
    if (this.metrics.queueSize.length > this.maxSamples) {
      this.metrics.queueSize.shift();
    }
  }

  getAverageProcessingTime() {
    const times = this.metrics.processingTime;
    return times.length > 0 ? times.reduce((a, b) => a + b) / times.length : 0;
  }

  getMaxProcessingTime() {
    return this.metrics.processingTime.length > 0
      ? Math.max(...this.metrics.processingTime)
      : 0;
  }

  getAverageQueueSize() {
    const sizes = this.metrics.queueSize;
    return sizes.length > 0 ? sizes.reduce((a, b) => a + b) / sizes.length : 0;
  }

  getAverageCpuUsage() {
    const cpu = this.metrics.cpuUsage;
    return cpu.length > 0 ? cpu.reduce((a, b) => a + b) / cpu.length : 0;
  }

  getMaxCpuUsage() {
    return this.metrics.cpuUsage.length > 0 ? Math.max(...this.metrics.cpuUsage) : 0;
  }

  getAverageMemoryUsage() {
    const heap = this.metrics.heapUsage;
    return heap.length > 0 ? heap.reduce((a, b) => a + b) / heap.length : 0;
  }

  getMaxMemoryUsage() {
    return this.metrics.heapUsage.length > 0 ? Math.max(...this.metrics.heapUsage) : 0;
  }

  getCurrentMemoryUsage() {
    return this.metrics.memoryUsage.length > 0
      ? this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1]
      : null;
  }

  getStats() {
    const runtime = Date.now() - this.metrics.startTime;
    const currentMem = this.getCurrentMemoryUsage() || { rss: 0, heapUsed: 0, heapTotal: 0 };

    return {
      // Performance metrics
      framesProcessed: this.metrics.frameCount,
      errors: this.metrics.errorCount,
      avgLatency: this.getAverageProcessingTime().toFixed(2) + 'ms',
      maxLatency: this.getMaxProcessingTime().toFixed(2) + 'ms',
      avgQueueSize: this.getAverageQueueSize().toFixed(1),
      runtime: (runtime / 1000).toFixed(1) + 's',
      framesPerSecond: ((this.metrics.frameCount / runtime) * 1000).toFixed(1),

      // CPU metrics
      avgCpuUsage: this.getAverageCpuUsage().toFixed(2) + '%',
      maxCpuUsage: this.getMaxCpuUsage().toFixed(2) + '%',
      currentCpuUsage: this.metrics.cpuUsage.length > 0
        ? this.metrics.cpuUsage[this.metrics.cpuUsage.length - 1].toFixed(2) + '%'
        : '0%',

      // Memory metrics
      avgMemoryUsage: this.getAverageMemoryUsage().toFixed(2) + 'MB',
      maxMemoryUsage: this.getMaxMemoryUsage().toFixed(2) + 'MB',
      currentMemory: {
        rss: currentMem.rss.toFixed(2) + 'MB',
        heapUsed: currentMem.heapUsed.toFixed(2) + 'MB',
        heapTotal: currentMem.heapTotal.toFixed(2) + 'MB'
      }
    };
  }

  /**
   * Get detailed metrics for logging/debugging
   */
  getDetailedStats() {
    const stats = this.getStats();
    return {
      ...stats,
      rawData: {
        cpuSamples: this.metrics.cpuUsage.length,
        memorySamples: this.metrics.memoryUsage.length,
        latencySamples: this.metrics.processingTime.length
      }
    };
  }

  shouldDowngrade() {
    // Check multiple conditions for degradation
    const highLatency = this.getAverageProcessingTime() > 10; // 10ms threshold
    const highCpu = this.getAverageCpuUsage() > 80; // 80% CPU
    const highMemory = this.getAverageMemoryUsage() > 500; // 500MB heap

    return highLatency || highCpu || highMemory;
  }

  reset() {
    this.metrics = {
      processingTime: [],
      queueSize: [],
      frameCount: 0,
      errorCount: 0,
      startTime: Date.now(),
      cpuUsage: [],
      memoryUsage: [],
      heapUsage: []
    };
  }

  /**
   * Stop resource monitoring and cleanup
   */
  stop() {
    if (this.resourceMonitorInterval) {
      clearInterval(this.resourceMonitorInterval);
      this.resourceMonitorInterval = null;
    }
  }
}

// ========================================
// PHASE 2: Worker Pool Manager
// ========================================
const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Worker Pool Manager for parallel audio processing
 * Distributes audio processing across multiple worker threads
 */
class WorkerPoolManager {
  constructor(workerCount = 2) {
    this.workers = [];
    this.workerIndex = 0;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.workerCount = workerCount;
    this.performanceMonitor = new PerformanceMonitor();
    this.workerPendingCount = []; // Track pending requests per worker for load balancing

    // DYNAMIC SCALING: Configuration
    this.minWorkers = 4; // Minimum workers (always keep at least 2)
    this.maxWorkers = 8; // Maximum workers (cap based on typical CPU cores)
    this.scaleUpThreshold = 0.7; // Scale up when workers are 70% loaded
    this.scaleDownThreshold = 0.3; // Scale down when workers are 30% loaded
    this.scaleUpCpuThreshold = 60; // Scale up when CPU > 60%
    this.scaleCheckInterval = 10000; // Check every 10 seconds
    this.scaleCheckTimer = null;
    this.lastScaleAction = Date.now();
    this.scaleUpCooldown = 30000; // Wait 30s after scaling up
    this.scaleDownCooldown = 60000; // Wait 60s after scaling down

    this.initializeWorkers();

    // Ensure we start with at least minWorkers
    if (this.workerCount < this.minWorkers) {
      console.log(`⚠️  [WORKER-POOL] Starting with ${this.workerCount} workers, scaling to minWorkers (${this.minWorkers})`);
      this.workerCount = this.minWorkers;
    }

    this.startAutoScaling();
  }

  initializeWorkers() {
    const workerPath = path.join(__dirname, 'audio-worker.js');

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(workerPath);

      worker.on('message', this.handleWorkerMessage.bind(this));
      worker.on('error', (error) => {
        console.error(`❌ [WORKER-${i}] Error:`, error);
        this.restartWorker(i);
      });
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`❌ [WORKER-${i}] Exited with code ${code}, restarting...`);
          this.restartWorker(i);
        }
      });

      this.workers.push({ worker, id: i, active: true });
      this.workerPendingCount.push(0); // Initialize pending count for this worker
      console.log(`✅ [WORKER-POOL] Worker ${i} initialized`);
    }

    console.log(`✅ [WORKER-POOL] Created pool with ${this.workerCount} workers`);
  }

  restartWorker(index) {
    const workerPath = path.join(__dirname, 'audio-worker.js');

    if (this.workers[index]) {
      try {
        this.workers[index].worker.terminate();
      } catch (e) {
        // Ignore termination errors
      }

      const newWorker = new Worker(workerPath);
      newWorker.on('message', this.handleWorkerMessage.bind(this));
      newWorker.on('error', (error) => {
        console.error(`❌ [WORKER-${index}] Error:`, error);
      });

      this.workers[index] = { worker: newWorker, id: index, active: true };
      console.log(`🔄 [WORKER-POOL] Worker ${index} restarted`);
    }
  }

  async initializeWorker(type, params) {
    // Initialize encoder/decoder in all workers
    // Use longer timeout for initialization (500ms instead of 50ms)
    const promises = this.workers.map((w) => {
      return this.sendMessage(w.worker, {
        type: type,
        data: params
      }, 500); // 500ms timeout for init
    });

    await Promise.all(promises);
  }

  async encodeOpus(pcmData, frameSize) {
    const { worker, index } = this.getNextWorker();
    const startTime = process.hrtime.bigint();

    // Track pending request count
    this.workerPendingCount[index]++;

    try {
      const result = await this.sendMessage(worker, {
        type: 'encode',
        data: { pcmData, frameSize }
      }, 150); // 150ms timeout (increased from 50ms to handle load spikes)

      const totalTime = this.performanceMonitor.recordProcessingTime(startTime);
      this.performanceMonitor.recordFrame();
      this.performanceMonitor.recordQueueSize(this.pendingRequests.size);

      return result.data;
    } catch (error) {
      this.performanceMonitor.recordError();
      throw error;
    } finally {
      // Always decrement pending count when done
      this.workerPendingCount[index]--;
    }
  }

  async decodeOpus(opusData) {
    const { worker, index } = this.getNextWorker();
    const startTime = process.hrtime.bigint();

    // Track pending request count
    this.workerPendingCount[index]++;

    try {
      const result = await this.sendMessage(worker, {
        type: 'decode',
        data: { opusData }
      }, 150); // 150ms timeout (increased from 50ms to handle load spikes)

      const totalTime = this.performanceMonitor.recordProcessingTime(startTime);
      this.performanceMonitor.recordFrame();
      this.performanceMonitor.recordQueueSize(this.pendingRequests.size);

      return result.data;
    } catch (error) {
      this.performanceMonitor.recordError();
      throw error;
    } finally {
      // Always decrement pending count when done
      this.workerPendingCount[index]--;
    }
  }

  getNextWorker() {
    // JITTER FIX: Use least-loaded worker instead of round-robin
    // Find worker with minimum pending requests
    let minPending = Infinity;
    let selectedIndex = 0;

    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerPendingCount[i] < minPending) {
        minPending = this.workerPendingCount[i];
        selectedIndex = i;
      }
    }

    return { worker: this.workers[selectedIndex].worker, index: selectedIndex };
  }

  sendMessage(worker, message, timeoutMs = 50) {
    const requestId = ++this.requestId;
    message.id = requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      // Send message to worker
      worker.postMessage(message);

      // Timeout handling
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Worker request ${requestId} timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Store timeout for cleanup
      this.pendingRequests.get(requestId).timeout = timeout;
    });
  }

  handleWorkerMessage(message) {
    const { id, success, result, error } = message;
    const request = this.pendingRequests.get(id);

    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(id);

      if (success) {
        request.resolve(result);
      } else {
        request.reject(new Error(error));
      }
    }
  }

  getStats() {
    return {
      workers: this.workers.length,
      activeWorkers: this.workers.filter(w => w.active).length,
      pendingRequests: this.pendingRequests.size,
      performance: this.performanceMonitor.getStats()
    };
  }

  /**
   * Get detailed stats including CPU and memory
   */
  getDetailedStats() {
    return {
      workers: this.workers.length,
      activeWorkers: this.workers.filter(w => w.active).length,
      pendingRequests: this.pendingRequests.size,
      performance: this.performanceMonitor.getDetailedStats()
    };
  }

  /**
   * Start periodic metrics logging
   * Logs stats every N seconds
   */
  startMetricsLogging(intervalSeconds = 120) {
    this.metricsInterval = setInterval(() => {
      const stats = this.getDetailedStats();

      // Calculate current load for auto-scaling display
      const avgPendingPerWorker = this.workerPendingCount.reduce((a, b) => a + b, 0) / this.workers.length;
      const loadPercent = Math.min(100, (avgPendingPerWorker / 5 * 100)).toFixed(1);

      // console.log('\n📊 [WORKER-POOL METRICS] ================');
      // console.log(`   Workers: ${stats.activeWorkers}/${stats.workers} active (min: ${this.minWorkers}, max: ${this.maxWorkers})`);
      // console.log(`   Load: ${loadPercent}% (${avgPendingPerWorker.toFixed(2)} pending/worker)`);
      // console.log(`   Pending Requests: ${stats.pendingRequests}`);
      // console.log(`   Frames Processed: ${stats.performance.framesProcessed}`);
      // console.log(`   Throughput: ${stats.performance.framesPerSecond} fps`);
      // console.log(`   Avg Latency: ${stats.performance.avgLatency}`);
      // console.log(`   Max Latency: ${stats.performance.maxLatency}`);
      // console.log(`   CPU Usage: ${stats.performance.avgCpuUsage} (max: ${stats.performance.maxCpuUsage})`);
      // console.log(`   Memory: ${stats.performance.currentMemory.heapUsed} / ${stats.performance.currentMemory.heapTotal}`);
      // console.log(`   Errors: ${stats.performance.errors}`);
      // console.log('==========================================\n');
    }, intervalSeconds * 1000);
  }

  /**
   * Stop metrics logging
   */
  stopMetricsLogging() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  // ========================================
  // DYNAMIC SCALING METHODS
  // ========================================

  /**
   * Start automatic worker scaling based on load
   */
  startAutoScaling() {
    if (this.scaleCheckTimer) {
      return; // Already running
    }

    console.log(`🔄 [AUTO-SCALE] Starting dynamic scaling (${this.minWorkers}-${this.maxWorkers} workers)`);

    this.scaleCheckTimer = setInterval(() => {
      this.checkAndScale();
    }, this.scaleCheckInterval);
  }

  /**
   * Stop automatic worker scaling
   */
  stopAutoScaling() {
    if (this.scaleCheckTimer) {
      clearInterval(this.scaleCheckTimer);
      this.scaleCheckTimer = null;
      console.log('🛑 [AUTO-SCALE] Stopped dynamic scaling');
    }
  }

  /**
   * Check current load and scale workers if needed
   */
  checkAndScale() {
    const currentWorkerCount = this.workers.length;
    const timeSinceLastScale = Date.now() - this.lastScaleAction;

    // Get current load metrics
    const avgPendingPerWorker = this.workerPendingCount.reduce((a, b) => a + b, 0) / currentWorkerCount;
    const maxPendingPerWorker = Math.max(...this.workerPendingCount);
    const totalPending = this.pendingRequests.size;
    const avgCpu = this.performanceMonitor.getAverageCpuUsage();
    const maxLatency = this.performanceMonitor.getMaxProcessingTime();

    // Calculate load ratio (0-1 scale)
    const loadRatio = avgPendingPerWorker / 5; // Assume 5 pending = full load

    // SCALE UP CONDITIONS
    const shouldScaleUp =
      currentWorkerCount < this.maxWorkers &&
      timeSinceLastScale >= this.scaleUpCooldown &&
      (
        loadRatio > this.scaleUpThreshold ||  // Workers are overloaded
        avgCpu > this.scaleUpCpuThreshold ||   // CPU is high
        maxLatency > 50 ||                     // Latency is getting bad
        totalPending > currentWorkerCount * 3  // Queue is building up
      );

    // SCALE DOWN CONDITIONS
    const shouldScaleDown =
      currentWorkerCount > this.minWorkers &&
      timeSinceLastScale >= this.scaleDownCooldown &&
      loadRatio < this.scaleDownThreshold &&  // Workers are underutilized
      avgCpu < 30 &&                          // CPU is low
      maxLatency < 10 &&                      // Latency is excellent
      totalPending === 0;                     // No queue buildup

    if (shouldScaleUp) {
      const newWorkerCount = Math.min(currentWorkerCount + 1, this.maxWorkers);
      this.scaleUp(newWorkerCount);
    } else if (shouldScaleDown) {
      const newWorkerCount = Math.max(currentWorkerCount - 1, this.minWorkers);
      this.scaleDown(newWorkerCount);
    }
  }

  /**
   * Scale up by adding workers
   */
  async scaleUp(targetCount) {
    const currentCount = this.workers.length;
    const workersToAdd = targetCount - currentCount;

    console.log(`📈 [AUTO-SCALE] Scaling UP: ${currentCount} → ${targetCount} workers (+${workersToAdd})`);

    const workerPath = path.join(__dirname, 'audio-worker.js');

    for (let i = 0; i < workersToAdd; i++) {
      const workerId = this.workers.length;
      const worker = new Worker(workerPath);

      worker.on('message', this.handleWorkerMessage.bind(this));
      worker.on('error', (error) => {
        console.error(`❌ [WORKER-${workerId}] Error:`, error);
        this.restartWorker(workerId);
      });
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`❌ [WORKER-${workerId}] Exited with code ${code}, restarting...`);
          this.restartWorker(workerId);
        }
      });

      this.workers.push({ worker, id: workerId, active: true });
      this.workerPendingCount.push(0);

      console.log(`✅ [AUTO-SCALE] Worker ${workerId} added`);
    }

    this.lastScaleAction = Date.now();
    this.workerCount = targetCount;

    // Initialize new workers with encoder/decoder
    await this.initializeNewWorkers(currentCount, targetCount);
  }

  /**
   * Scale down by removing workers
   */
  async scaleDown(targetCount) {
    const currentCount = this.workers.length;
    const workersToRemove = currentCount - targetCount;

    console.log(`📉 [AUTO-SCALE] Scaling DOWN: ${currentCount} → ${targetCount} workers (-${workersToRemove})`);

    // Remove workers from the end (newest first)
    for (let i = 0; i < workersToRemove; i++) {
      const workerIndex = this.workers.length - 1;
      const workerInfo = this.workers[workerIndex];

      // Wait for any pending operations on this worker
      const maxWaitTime = 5000; // 5 seconds max wait
      const startWait = Date.now();

      while (this.workerPendingCount[workerIndex] > 0 && (Date.now() - startWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Terminate worker
      try {
        await workerInfo.worker.terminate();
        console.log(`🗑️ [AUTO-SCALE] Worker ${workerInfo.id} removed`);
      } catch (error) {
        console.error(`❌ [AUTO-SCALE] Error terminating worker ${workerInfo.id}:`, error);
      }

      // Remove from arrays
      this.workers.pop();
      this.workerPendingCount.pop();
    }

    this.lastScaleAction = Date.now();
    this.workerCount = targetCount;
  }

  /**
   * Initialize newly added workers with encoder/decoder
   */
  async initializeNewWorkers(startIndex, endIndex) {
    const workersToInit = this.workers.slice(startIndex, endIndex);

    // Initialize encoder and decoder for new workers
    try {
      await Promise.all(workersToInit.map(w =>
        this.sendMessage(w.worker, {
          type: 'init_encoder',
          data: { sampleRate: 24000, channels: 1 }
        }, 500)
      ));

      await Promise.all(workersToInit.map(w =>
        this.sendMessage(w.worker, {
          type: 'init_decoder',
          data: { sampleRate: 16000, channels: 1 }
        }, 500)
      ));

      console.log(`✅ [AUTO-SCALE] New workers initialized (${startIndex}-${endIndex-1})`);
    } catch (error) {
      console.error(`❌ [AUTO-SCALE] Failed to initialize new workers:`, error);
    }
  }

  // ========================================
  // END DYNAMIC SCALING METHODS
  // ========================================

  async terminate() {
    console.log('🛑 [WORKER-POOL] Terminating all workers...');

    // Stop auto-scaling
    this.stopAutoScaling();

    // Stop metrics logging
    this.stopMetricsLogging();

    // Stop performance monitor
    this.performanceMonitor.stop();

    // Terminate all workers
    await Promise.all(this.workers.map(w => w.worker.terminate()));
    this.workers = [];
  }
}

function setDebugEnabled(enabled) {
  if (enabled) {
    debugModule.enable("mqtt-server");
  } else {
    debugModule.disable();
  }
}

const configManager = new ConfigManager("mqtt.json");
configManager.on("configChanged", (config) => {
  setDebugEnabled(false);
});
setDebugEnabled(configManager.get("debug"));

class LiveKitBridge extends Emitter {
  constructor(connection, protocolVersion, macAddress, uuid, userData) {
    super();
    this.connection = connection;
    this.macAddress = macAddress;
    this.uuid = uuid;
    this.userData = userData;
    this.room = null;
    this.audioSource = new AudioSource(16000, 1);
    this.protocolVersion = protocolVersion;
    this.isAudioPlaying = false; // Track if audio is actively playing

    // Add agent join tracking
    this.agentJoined = false;
    this.agentJoinPromise = null;
    this.agentJoinResolve = null;
    this.agentJoinTimeout = null;

    // Create a promise that resolves when agent joins
    this.agentJoinPromise = new Promise((resolve) => {
      this.agentJoinResolve = resolve;
    });

    // Initialize audio resampler for 48kHz -> 24kHz conversion (outgoing: LiveKit -> ESP32)
    this.audioResampler = new AudioResampler(48000, 24000, 1, AudioResamplerQuality.QUICK);

    // Frame buffer for accumulating resampled audio into proper frame sizes
    this.frameBuffer = Buffer.alloc(0);
    this.targetFrameSize = 1440; // 1440 samples = 60ms at 24kHz (outgoing)
    this.targetFrameBytes = this.targetFrameSize * 2; // 2880 bytes for 16-bit PCM

    // PHASE 2: Initialize Worker Pool for parallel audio processing
    this.workerPool = new WorkerPoolManager(4); // Start with minWorkers (4) for proper scaling
    console.log(`✅ [PHASE-2] Worker pool initialized for ${this.macAddress}`);

    // Start periodic metrics logging (every 30 seconds)
    // this.workerPool.startMetricsLogging(30);

    // Initialize workers with encoder/decoder settings
    this.workerPool.initializeWorker('init_encoder', {
      sampleRate: OUTGOING_SAMPLE_RATE,
      channels: CHANNELS
    }).then(() => {
      console.log(`✅ [PHASE-2] Workers encoder ready (${OUTGOING_SAMPLE_RATE}Hz)`);
    }).catch(err => {
      console.error(`❌ [PHASE-2] Worker encoder init failed:`, err.message);
    });

    this.workerPool.initializeWorker('init_decoder', {
      sampleRate: INCOMING_SAMPLE_RATE,
      channels: CHANNELS
    }).then(() => {
      console.log(`✅ [PHASE-2] Workers decoder ready (${INCOMING_SAMPLE_RATE}Hz)`);
    }).catch(err => {
      console.error(`❌ [PHASE-2] Worker decoder init failed:`, err.message);
    });

    this.initializeLiveKit();
  }

  initializeLiveKit() {
    const livekitConfig = configManager.get("livekit");
    if (!livekitConfig) {
      throw new Error("LiveKit config not found");
    }
    this.livekitConfig = livekitConfig;
  }

  // PHASE 2: Process buffered audio frames and encode to Opus using worker threads
  async processBufferedFrames(timestamp, frameCount) {
    if (!this.connection) {
      console.error(`❌ [PROCESS] No connection available, cannot send audio`);
      return;
    }

    while (this.frameBuffer.length >= this.targetFrameBytes) {
      // Extract one complete frame
      const frameData = this.frameBuffer.subarray(0, this.targetFrameBytes);
      this.frameBuffer = this.frameBuffer.subarray(this.targetFrameBytes);

      // Process this complete frame - encode to Opus before sending
      if (frameData.length > 0) {
        const samples = new Int16Array(frameData.buffer, frameData.byteOffset, frameData.length / 2);
        const isSilent = samples.every(sample => sample === 0);
        const maxAmplitude = Math.max(...samples.map(s => Math.abs(s)));
        const isNearlySilent = maxAmplitude < 10;

        if (frameCount <= 5) {
          console.log(`🔍 [DEBUG] Frame ${frameCount}: samples=${samples.length}, max=${maxAmplitude}`);
        }

        if (isSilent || isNearlySilent) {
          if (frameCount <= 5) {
            console.log(`🔇 [PCM] Silent frame ${frameCount} detected (max=${maxAmplitude}), skipping`);
          }
          continue;
        }

        // PHASE 2: Encode using worker thread (non-blocking)
        try {
          const opusBuffer = await this.workerPool.encodeOpus(frameData, this.targetFrameSize);

          if (frameCount <= 3 || frameCount % 100 === 0) {
            console.log(`🎵 [WORKER] Frame ${frameCount}: PCM ${frameData.length}B → Opus ${opusBuffer.length}B`);
          }

          this.connection.sendUdpMessage(opusBuffer, timestamp);
        } catch (err) {
          console.error(`❌ [WORKER] Encode error: ${err.message}`);
          // Fallback to PCM if worker encoding fails
          this.connection.sendUdpMessage(frameData, timestamp);
        }
      }
    }
  }

  async connect(audio_params, features, roomService) {
    const connectStartTime = Date.now();
    console.log(`🔍 [DEBUG] LiveKitBridge.connect() called - UUID: ${this.uuid}, MAC: ${this.macAddress}`);
    console.log(`⏱️ [TIMING-START] Connection initiated at ${connectStartTime}`);
    const { url, api_key, api_secret } = this.livekitConfig;
    // Include MAC address in room name for agent to extract device-specific prompt
    const macForRoom = this.macAddress.replace(/:/g, ''); // Remove colons: 00:16:3e:ac:b5:38 → 00163eacb538
    const roomName = `${this.uuid}_${macForRoom}`;
    const participantName = this.macAddress;

    console.log(`🏠 [ROOM] Creating room with name: ${roomName} (UUID: ${this.uuid}, MAC: ${this.macAddress})`);

    // Pre-create room with emptyTimeout setting
    if (roomService) {
      try {
        await roomService.createRoom({
          name: roomName,
          empty_timeout: 60, // Auto-close room if empty for 60 seconds (snake_case for LiveKit API)
          max_participants: 2
        });
        console.log(`✅ [ROOM] Pre-created room with 60-second empty_timeout: ${roomName}`);
      } catch (error) {
        // Log the actual error for debugging
        console.error(`❌ [ROOM] Error pre-creating room: ${error.message}`);
        console.error(`❌ [ROOM] Full error:`, error);

        // Room might already exist, that's okay - continue anyway
        if (error.message && !error.message.includes('already exists')) {
          console.warn(`⚠️ [ROOM] Continuing despite error...`);
        } else {
          console.log(`ℹ️ [ROOM] Room already exists: ${roomName}`);
        }
        // Don't throw - continue with connection even if room pre-creation fails
      }
    }

    const at = new AccessToken(api_key, api_secret, {
      identity: participantName,
      // Add MAC address as custom attributes
      attributes: {
        device_mac: this.macAddress,
        device_uuid: this.uuid || '',
        room_type: 'device_session'
      }
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      roomCreate: true,
      canPublish: true,
      canSubscribe: true,
    });
    const token = await at.toJwt(); // Fixed: Make this async

    this.room = new Room();

    // Add connection state monitoring
    this.room.on("connectionStateChanged", (state) => {
      console.log(`[LiveKitBridge] Connection state changed: ${state}`);
    });

    this.room.on("connected", () => {
      console.log("[LiveKitBridge] Room connected event fired");
    });

    this.room.on("disconnected", (reason) => {
      console.log(`[LiveKitBridge] Room disconnected: ${reason}`);
      // CRITICAL: Clear audio flag on disconnect to prevent stuck state
      this.isAudioPlaying = false;
      console.log(`🎵 [CLEANUP] Cleared audio flag on room disconnect for device: ${this.macAddress}`);
    });

    this.room.on(
      RoomEvent.DataReceived,
      (payload, participant, kind, topic) => {
        try {
          const str = Buffer.from(payload).toString("utf-8");
          let data;
          try {
            data = JSON5.parse(str);
            console.log(`📨 [DATA RECEIVED] Topic: ${topic}, Type: ${data?.type}, Data:`, data);
          } catch (err) {
            console.error("Invalid JSON5:", err.message);
          }
          switch (data.type) {
            case "agent_state_changed":
              // console.log(`Agent state changed: ${JSON.stringify(data.data)}`);
              if (
                data.data.old_state === "speaking" &&
                data.data.new_state === "listening"
              ) {
                // Set audio playing flag to false
                this.isAudioPlaying = false;
                console.log(`🎵 [AUDIO-STOP] TTS stopped for device: ${this.macAddress}`);
                // Send TTS stop message to device
                this.sendTtsStopMessage();

                // If we're in ending phase, send goodbye MQTT message now that TTS finished
                if (this.connection && this.connection.isEnding && !this.connection.goodbyeSent) {
                  console.log(`👋 [END-COMPLETE] TTS goodbye finished, sending goodbye MQTT message to device: ${this.macAddress}`);
                  this.connection.goodbyeSent = true;
                  this.connection.sendMqttMessage(
                    JSON.stringify({
                      type: "goodbye",
                      session_id: this.connection.udp ? this.connection.udp.session_id : null,
                      reason: "inactivity_timeout",
                      timestamp: Date.now()
                    })
                  );
                  console.log(`👋 [GOODBYE-MQTT] Sent goodbye MQTT message after TTS completed: ${this.macAddress}`);

                  // Close connection shortly after goodbye message
                  setTimeout(() => {
                    if (this.connection) {
                      this.connection.close();
                    }
                  }, 500); // Small delay to ensure goodbye message is delivered
                }
              }
              else if(
                data.data.old_state === "listening" &&
                data.data.new_state === "thinking"
              )
              {
                  this.sendLLMThinkMessage();
              }
              break;
            case "user_input_transcribed":
              // console.log(`Transcription: ${JSON.stringify(data.data)}`);
              // Send STT result back to device
              this.sendSttMessage(data.data.text || data.data.transcript);
              break;
            case "speech_created":
              // console.log(`Speech created: ${JSON.stringify(data.data)}`);
              // Set audio playing flag and reset inactivity timer
              this.isAudioPlaying = true;
              if (this.connection && this.connection.updateActivityTime) {
                this.connection.updateActivityTime();
                console.log(`🎵 [AUDIO-START] TTS started, timer reset for device: ${this.macAddress}`);
              }
              // Send TTS start message to device
              this.sendTtsStartMessage(data.data.text);
              break;
            case "device_control":
              // Convert device_control commands to MCP function calls
              console.log(`🎛️ [DEVICE CONTROL] Received action: ${data.action}`);
              this.convertDeviceControlToMcp(data);
              break;
            case "function_call":
              // Handle xiaozhi function calls (volume controls, etc.)
              console.log(`🔧 [FUNCTION CALL] Received function: ${data.function_call?.name}`);
              this.handleFunctionCall(data);
              break;
            case "mobile_music_request":
              // Handle music play request from mobile app
              console.log(`🎵 [MOBILE] Music play request received from mobile app`);
              console.log(`   📱 Device: ${this.macAddress}`);
              console.log(`   🎵 Song: ${data.song_name}`);
              console.log(`   🗂️ Type: ${data.content_type}`);
              console.log(`   🌐 Language: ${data.language || 'Not specified'}`);
              this.handleMobileMusicRequest(data);
              break;
            case "music_playback_stopped":
              // Handle music playback stopped - force clear audio playing flag
              console.log(`🎵 [MUSIC-STOP] Music playback stopped for device: ${this.macAddress}`);
              this.isAudioPlaying = false;
              // Send TTS stop message to ensure device returns to listening state
              this.sendTtsStopMessage();
              break;
            case "llm":
              // Handle emotion from LLM response
              console.log(`😊 [EMOTION] Received: ${data.emotion} (${data.text})`);
              this.sendEmotionMessage(data.text, data.emotion);
              break;

            // case "metrics_collected":
            //   console.log(`Metrics: ${JSON.stringify(data.data)}`);
            //   break;
            default:
            //console.log(`Unknown data type: ${data.type}`);
          }
        } catch (error) {
          console.error(`Error processing data packet: ${error}`);
        }
      }
    );

    return new Promise(async (resolve, reject) => {
      try {
        console.log(`[LiveKitBridge] Connecting to LiveKit room: ${roomName}`);
        await this.room.connect(url, token, {
          autoSubscribe: true,
          dynacast: true,
        });
        const roomConnectedTime = Date.now();
        console.log(`✅ [ROOM] Connected to LiveKit room: ${roomName}`);
        console.log(`⏱️ [TIMING-ROOM] Room connection took ${roomConnectedTime - connectStartTime}ms`);
        console.log(`🔗 [CONNECTION] State: ${this.room.connectionState}`);
        console.log(`🟢 [STATUS] Is connected: ${this.room.isConnected}`);

        // Log existing participants in the room
        console.log(
          `👥 [PARTICIPANTS] Remote participants in room: ${this.room.remoteParticipants.size}`
        );
        this.room.remoteParticipants.forEach((participant, sid) => {
          console.log(`   - ${participant.identity} (${sid})`);

          // Log existing tracks from participants
          participant.trackPublications.forEach((pub, trackSid) => {
            console.log(
              `     📡 Track: ${trackSid}, kind: ${pub.kind}, subscribed: ${pub.isSubscribed}`
            );
          });
        });

        this.room.on(
          RoomEvent.TrackSubscribed,
          (track, publication, participant) => {
            console.log(
              `🎵 [TRACK] Subscribed to track: ${track.sid} from ${participant.identity}, kind: ${track.kind}`
            );

            // Handle audio track from agent (TTS audio)
            // Check for both string "audio" and TrackKind.KIND_AUDIO constant
            if (track.kind === "audio" || track.kind === TrackKind.KIND_AUDIO) {
              console.log(
                `🔊 [AUDIO TRACK] Starting audio stream processing for ${participant.identity}`
              );


              const stream = new AudioStream(track);
              const reader = stream.getReader();

              let frameCount = 0;
              let totalBytes = 0;
              let lastLogTime = Date.now();

              const readStream = async () => {
                try {
                  console.log(
                    `🎧 [AUDIO STREAM] Starting to read audio frames from ${participant.identity}`
                  );

                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      this.sendTtsStopMessage();
                      console.log(
                        `🏁 [AUDIO STREAM] Stream ended for ${participant.identity}. Total frames: ${frameCount}, Total bytes: ${totalBytes}`
                      );

                      // Flush any remaining resampled data
                      const finalFrames = this.audioResampler.flush();
                      for (const finalFrame of finalFrames) {
                        const finalBuffer = Buffer.from(
                          finalFrame.data.buffer,
                          finalFrame.data.byteOffset,
                          finalFrame.data.byteLength
                        );
                        // Add final frames to buffer
                        this.frameBuffer = Buffer.concat([this.frameBuffer, finalBuffer]);
                      }

                      // Process any remaining complete frames in buffer
                      const finalTimestamp = (Date.now() - this.connection.udp.startTime) & 0xffffffff;
                      this.processBufferedFrames(finalTimestamp, frameCount, participant.identity);

                      // SKIP partial frames - they cause Opus encoder to crash
                      // Opus encoder requires exact frame sizes, partial frames will be dropped
                      if (this.frameBuffer.length > 0) {
                        console.log(`⏭️ [FLUSH] Skipping partial frame (${this.frameBuffer.length}B) - would cause Opus crash`);
                      }

                      // Clear the buffer
                      this.frameBuffer = Buffer.alloc(0);

                      // Notify connection that audio stream has ended
                      if (this.connection && this.connection.isEnding) {
                        console.log(`✅ [END-COMPLETE] Audio stream completed, closing connection: ${this.connection.clientId || this.connection.deviceId}`);
                        // Use setTimeout to allow TTS stop message to be sent first
                        setTimeout(() => {
                          if (this.connection && this.connection.isEnding) {
                            this.connection.close();
                          }
                        }, 1000); // 1 second delay to ensure TTS stop is processed
                      }

                      break;
                    }

                    frameCount++;

                    // value is an AudioFrame from LiveKit (48kHz)
                    // Push the frame to resampler and get resampled frames back (16kHz)
                    const resampledFrames = this.audioResampler.push(value);

                    // Add resampled frames to buffer instead of processing directly
                    for (const resampledFrame of resampledFrames) {
                      const resampledBuffer = Buffer.from(
                        resampledFrame.data.buffer,
                        resampledFrame.data.byteOffset,
                        resampledFrame.data.byteLength
                      );

                      // Append to frame buffer
                      this.frameBuffer = Buffer.concat([this.frameBuffer, resampledBuffer]);
                      totalBytes += resampledBuffer.length;
                    }

                    const timestamp = (Date.now() - this.connection.udp.startTime) & 0xffffffff;

                    // Process any complete frames from the buffer
                    this.processBufferedFrames(timestamp, frameCount, participant.identity);

                    // Log every 50 frames or every 5 seconds
                    // const now = Date.now();
                    // if (frameCount % 50 === 0 || now - lastLogTime > 5000) {
                    //   console.log(
                    //     `🎵 [AUDIO FRAMES] Received ${frameCount} frames, ${totalBytes} total bytes from ${participant.identity}, buffer: ${this.frameBuffer.length}B`
                    //   );
                    //   lastLogTime = now;
                    // }

                  }
                } catch (error) {
                  console.error(
                    `❌ [AUDIO STREAM] Error reading audio stream from ${participant.identity}:`,
                    error
                  );
                } finally {
                  console.log(
                    `🔒 [AUDIO STREAM] Releasing reader lock for ${participant.identity}`
                  );
                  reader.releaseLock();
                }
              };

              readStream();
            } else {
              console.log(
                `⚠️ [TRACK] Non-audio track subscribed: ${track.kind} (type: ${typeof track.kind}) from ${participant.identity}`
              );
            }
          }
        );

        // Add track unsubscription handler
        this.room.on(
          RoomEvent.TrackUnsubscribed,
          (track, publication, participant) => {
            console.log(
              `🔇 [TRACK] Unsubscribed from track: ${track.sid} from ${participant.identity}, kind: ${track.kind}`
            );
          }
        );

        // Add participant connection handlers
        this.room.on(RoomEvent.ParticipantConnected, (participant) => {
          console.log(
            `👤 [PARTICIPANT] Connected: ${participant.identity} (${participant.sid})`
          );

          // Check if this is an agent joining (agent identity typically contains "agent")
          if (participant.identity.includes('agent')) {
            console.log(`🤖 [AGENT] Agent joined the room: ${participant.identity}`);

            // Set agent joined flag and resolve promise
            this.agentJoined = true;
            if (this.agentJoinResolve) {
              this.agentJoinResolve();
              console.log(`✅ [AGENT-READY] Agent join promise resolved`);
            }

            // Clear timeouts if set
            if (this.agentJoinTimeout) {
              clearTimeout(this.agentJoinTimeout);
              this.agentJoinTimeout = null;
            }
            // Note: Room emptyTimeout is handled by LiveKit server automatically

            console.log(`✅ [AGENT] Agent ready, waiting for 's' key press from client to trigger greeting`);
          }
        });

        this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          console.log(
            `👤 [PARTICIPANT] Disconnected: ${participant.identity} (${participant.sid})`
          );
        });

        // Fixed: Use proper track publishing method (simplified to match dev branch)
        const {
          LocalAudioTrack,
          TrackPublishOptions,
          TrackSource,
        } = require("@livekit/rtc-node");

        const track = LocalAudioTrack.createAudioTrack(
          "microphone",
          this.audioSource
        );
        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;

        const publication = await this.room.localParticipant.publishTrack(
          track,
          options
        );
        const trackPublishedTime = Date.now();
        console.log(
          `🎤 [PUBLISH] Published local audio track: ${publication.trackSid || publication.sid}`
        );
        console.log(`⏱️ [TIMING-TRACK] Track publish took ${trackPublishedTime - roomConnectedTime}ms`);

        // Use roomName as session_id - this is consistent with how LiveKit rooms work
        // The room.sid might not be immediately available, but roomName is our session identifier
        // Include audio_params that the client expects
        const totalConnectTime = Date.now() - connectStartTime;
        console.log(`⏱️ [TIMING-TOTAL] Total connection setup took ${totalConnectTime}ms`);
        resolve({
          session_id: roomName,
          audio_params: {
            sample_rate: 24000,
            channels: 1,
            frame_duration: 60,
            format: "opus"
          }
        });
      } catch (error) {
        console.error("[LiveKitBridge] Error connecting to LiveKit:", error);
        console.error("[LiveKitBridge] Error name:", error.name);
        console.error("[LiveKitBridge] Error message:", error.message);
        reject(error);
      }
    });
  }

  async sendAudio(opusData, timestamp) {
    // Check if audioSource is available and room is connected
    if (!this.audioSource || !this.room || !this.room.isConnected) {
      console.warn(`⚠️ [AUDIO] Cannot send audio - audioSource or room not ready. Room connected: ${this.room?.isConnected}`);
      return;
    }

    try {
      // PHASE 1: Improved Opus detection - check if data is likely Opus
      const isOpus = this.checkOpusFormat(opusData);

      if (isOpus) {
        // PHASE 2: Use worker thread for decoding (non-blocking)
        try {
          const pcmBuffer = await this.workerPool.decodeOpus(opusData);

          // console.log(`✅ [WORKER DECODE] Decoded ${opusData.length}B Opus → ${pcmBuffer.length}B PCM`);

          if (pcmBuffer && pcmBuffer.length > 0) {
            // Convert Buffer to Int16Array
            const samples = new Int16Array(
              pcmBuffer.buffer,
              pcmBuffer.byteOffset,
              pcmBuffer.length / 2
            );
            const frame = new AudioFrame(samples, 16000, 1, samples.length);

            // Safe capture with error handling
            this.safeCaptureFrame(frame).catch(err => {
              console.error(`❌ [AUDIO] Unhandled error in safeCaptureFrame: ${err.message}`);
            });
          }
        } catch (err) {
          console.error(`❌ [WORKER] Decode error: ${err.message}`);
          console.error(`    Data size: ${opusData.length}B, First 8 bytes: ${opusData.subarray(0, Math.min(8, opusData.length)).toString('hex')}`);

          // PHASE 2: Fallback to PCM if worker decode fails (likely false positive detection)
          console.log(`⚠️ [FALLBACK] Treating as PCM instead`);
          const samples = new Int16Array(
            opusData.buffer,
            opusData.byteOffset,
            opusData.length / 2
          );
          const frame = new AudioFrame(samples, 16000, 1, samples.length);
          this.safeCaptureFrame(frame).catch(err => {
            console.error(`❌ [AUDIO] PCM fallback failed: ${err.message}`);
          });
        }
      } else {
        // Treat as PCM directly
        const samples = new Int16Array(
          opusData.buffer,
          opusData.byteOffset,
          opusData.length / 2
        );
        const frame = new AudioFrame(samples, 16000, 1, samples.length);

        // Safe capture with error handling
        this.safeCaptureFrame(frame).catch(err => {
          console.error(`❌ [AUDIO] Unhandled error in safeCaptureFrame: ${err.message}`);
        });
      }
    } catch (error) {
      console.error(`❌ [AUDIO] Error in sendAudio: ${error.message}`);
    }
  }

  async safeCaptureFrame(frame) {
    try {
      // Validate frame before capture
      if (!frame || !frame.data || frame.data.length === 0) {
        console.warn(`⚠️ [AUDIO] Invalid frame data, skipping`);
        return;
      }

      // Check if audioSource is still valid
      if (!this.audioSource) {
        console.warn(`⚠️ [AUDIO] AudioSource is null, cannot capture frame`);
        return;
      }

      // Check if room is still connected before attempting to send audio
      if (!this.room || !this.room.isConnected) {
        console.warn(`⚠️ [AUDIO] Room disconnected or not available, skipping frame`);
        return;
      }

      // Attempt to capture the frame
     await this.audioSource.captureFrame(frame);
    } catch (error) {
      console.error(`❌ [AUDIO] Failed to capture frame: ${error.message}`);

      // If we get InvalidState error, it's likely the peer connection is disconnecting
      if (error.message.includes('InvalidState')) {
        console.warn(`⚠️ [AUDIO] InvalidState error - peer connection may be disconnecting`);
        console.warn(`💡 [HINT] This is normal during room disconnect, frames will be skipped`);
        // Don't reinitialize - the room connection check above will prevent future frames
      }
    }
  }

  analyzeAudioFormat(audioData, timestamp) {
    // Check for Opus magic signature
    const isOpus = this.checkOpusFormat(audioData);
    const isPCM = this.checkPCMFormat(audioData);

    console.log(`🔍 [AUDIO ANALYSIS] Format Detection:`);
    console.log(`   📊 Size: ${audioData.length} bytes`);
    console.log(`   🎵 Timestamp: ${timestamp}`);
    console.log(
      `   📋 First 16 bytes: ${audioData.slice(0, Math.min(16, audioData.length)).toString("hex")}`
    );
    console.log(
      `   🎼 Opus signature: ${isOpus ? "✅ DETECTED" : "❌ NOT FOUND"}`
    );
    console.log(
      `   🎤 PCM characteristics: ${isPCM ? "✅ LIKELY PCM" : "❌ UNLIKELY PCM"}`
    );

    // Additional analysis
    this.analyzeAudioStatistics(audioData);
  }


  checkOpusFormat(data) {
      if (data.length < 1) return false;

      // PHASE 2: Filter out text messages (keepalive, ping, etc.)
      // Check if data looks like ASCII text
      try {
        const textCheck = data.toString('utf8', 0, Math.min(10, data.length));
        if (/^(keepalive|ping|pong|hello|goodbye)/.test(textCheck)) {
          // console.log(`🚫 Filtered out text message: ${textCheck}`);
          return false; // This is a text message, not Opus
        }
      } catch (e) {
        // Not valid UTF-8, continue with Opus check
      }

      // ESP32 sends 60ms OPUS frames at 16kHz mono with complexity=0
      const MIN_OPUS_SIZE = 1;    // Minimum OPUS packet (can be very small for silence)
      const MAX_OPUS_SIZE = 400;  // Maximum OPUS packet for 60ms@16kHz

      // Validate packet size range
      if (data.length < MIN_OPUS_SIZE || data.length > MAX_OPUS_SIZE) {
          // console.log(`❌ Invalid OPUS size: ${data.length}B (expected ${MIN_OPUS_SIZE}-${MAX_OPUS_SIZE}B)`);
          return false;
      }


      // Check OPUS TOC (Table of Contents) byte
      const firstByte = data[0];
      const config = (firstByte >> 3) & 0x1f;        // Bits 7-3: config (0-31)
      const stereo = (firstByte >> 2) & 0x01;        // Bit 2: stereo flag
      const frameCount = firstByte & 0x03;           // Bits 1-0: frame count


     // console.log(`🔍 OPUS TOC: config=${config}, stereo=${stereo}, frames=${frameCount}, size=${data.length}B`);


      // Validate OPUS TOC byte
      const validConfig = config >= 0 && config <= 31;
      const validStereo = stereo === 0;  // ESP32 sends mono (stereo=0)
      const validFrameCount = frameCount >= 0 && frameCount <= 3;

      // ✅ FIXED: Accept ALL valid OPUS configs (0-31) for ESP32 with complexity=0
      // ESP32 with complexity=0 can use various configs depending on audio content
      const validOpusConfigs = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,  // NB/MB/WB configs
        16, 17, 18, 19,                                          // SWB configs
        20, 21, 22, 23,                                          // FB configs
        24, 25, 26, 27, 28, 29, 30, 31                          // Hybrid configs
      ];
      const isValidConfig = validOpusConfigs.includes(config);

      // ✅ FIXED: More lenient validation - just check basic OPUS structure
      const isValidOpus = validConfig && validStereo && validFrameCount && isValidConfig;


     // console.log(`📊 OPUS validation: config=${validConfig}(${config}), mono=${validStereo}, frames=${validFrameCount}, validConfig=${isValidConfig} → ${isValidOpus ? "✅ VALID" : "❌ INVALID"}`);

      // ✅ ADDITIONAL: Log first few bytes for debugging
      if (!isValidOpus) {
        const hexDump = data.slice(0, Math.min(8, data.length)).toString('hex');
      //  console.log(`🔍 OPUS debug - first ${Math.min(8, data.length)} bytes: ${hexDump}`);
      }

      return isValidOpus;
  }


  checkOpusMarkers(data) {
    // Look for common Opus packet patterns
    if (data.length < 4) return false;

    // Check for Opus frame size patterns (common sizes: 120, 240, 480, 960, 1920, 2880 samples)
    // At 16kHz: 120 samples = 7.5ms, 240 = 15ms, 480 = 30ms, etc.
    const commonOpusSizes = [20, 40, 60, 80, 120, 160, 240, 320, 480, 640, 960];
    const isCommonOpusSize = commonOpusSizes.includes(data.length);

    // console.log(
    //   `   📏 Common Opus size (${data.length}B): ${isCommonOpusSize ? "✅" : "❌"}`
    // );

    return isCommonOpusSize;
  }

  checkPCMFormat(data) {
    if (data.length < 32) return false;

    // PCM characteristics analysis
    const samples = new Int16Array(
      data.buffer,
      data.byteOffset,
      Math.min(data.length / 2, 16)
    );

    // Calculate basic statistics
    let sum = 0;
    let maxAbs = 0;
    let zeroCount = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      sum += Math.abs(sample);
      maxAbs = Math.max(maxAbs, Math.abs(sample));
      if (sample === 0) zeroCount++;
    }

    const avgAmplitude = sum / samples.length;
    const zeroRatio = zeroCount / samples.length;

    console.log(`   📈 PCM Statistics:`);
    console.log(`      🔊 Avg amplitude: ${avgAmplitude.toFixed(1)}`);
    console.log(`      📊 Max amplitude: ${maxAbs}`);
    console.log(`      🔇 Zero ratio: ${(zeroRatio * 100).toFixed(1)}%`);
    console.log(`      📐 Sample count: ${samples.length}`);

    // PCM heuristics
    const hasReasonableAmplitude = avgAmplitude > 10 && avgAmplitude < 10000;
    const hasVariation = maxAbs > 100;
    const notTooManyZeros = zeroRatio < 0.8;
    const reasonableSize = data.length >= 160 && data.length <= 3840; // 10ms to 240ms at 16kHz

    console.log(`   ✅ PCM Checks:`);
    console.log(
      `      🔊 Reasonable amplitude: ${hasReasonableAmplitude ? "✅" : "❌"}`
    );
    console.log(`      📊 Has variation: ${hasVariation ? "✅" : "❌"}`);
    console.log(
      `      🔇 Not too many zeros: ${notTooManyZeros ? "✅" : "❌"}`
    );
    console.log(`      📏 Reasonable size: ${reasonableSize ? "✅" : "❌"}`);

    return (
      hasReasonableAmplitude &&
      hasVariation &&
      notTooManyZeros &&
      reasonableSize
    );
  }

  analyzeAudioStatistics(data) {
    // Frame size analysis for common audio formats
    const frameSizeAnalysis = this.analyzeFrameSize(data.length);
    console.log(`   ⏱️  Frame Analysis: ${frameSizeAnalysis}`);

    // Entropy analysis (compressed data has higher entropy)
    const entropy = this.calculateEntropy(data);
    console.log(
      `   🎲 Data entropy: ${entropy.toFixed(3)} (PCM: ~7-11, Opus: ~7.5-8)`
    );
  }

  analyzeFrameSize(size) {
    // Common frame sizes for different formats at 16kHz
    const formats = {
      "PCM 10ms": 320, // 160 samples * 2 bytes
      "PCM 20ms": 640, // 320 samples * 2 bytes
      "PCM 30ms": 960, // 480 samples * 2 bytes
      "PCM 60ms": 1920, // 960 samples * 2 bytes
      "Opus 20ms": 40, // Typical Opus frame
      "Opus 40ms": 80, // Typical Opus frame
      "Opus 60ms": 120, // Typical Opus frame
    };

    for (const [format, expectedSize] of Object.entries(formats)) {
      if (size === expectedSize) {
        return `${format} (exact match)`;
      }
    }

    // Check for close matches
    for (const [format, expectedSize] of Object.entries(formats)) {
      if (Math.abs(size - expectedSize) <= 10) {
        return `${format} (close match, diff: ${size - expectedSize})`;
      }
    }

    return `Unknown format (${size}B)`;
  }

  calculateEntropy(data) {
    const freq = new Array(256).fill(0);

    // Count byte frequencies
    for (let i = 0; i < data.length; i++) {
      freq[data[i]]++;
    }

    // Calculate entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (freq[i] > 0) {
        const p = freq[i] / data.length;
        entropy -= p * Math.log2(p);
      }
    }

    return entropy;
  }

  isAlive() {
    return this.room && this.room.isConnected;
  }

  // Send TTS start message to device
  sendTtsStartMessage(text = "") {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "start",
      session_id: this.connection.udp.session_id,
    };

    if (text) {
      message.text = text;
    }

    // console.log(
    //   `📤 [MQTT OUT] Sending TTS start to device: ${this.macAddress}`
    // );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send TTS sentence start message to device
  sendTtsSentenceStartMessage(text) {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "sentence_start",
      session_id: this.connection.udp.session_id,
      text: text || "",
    };

    console.log(
      `📤 [MQTT OUT] Sending TTS sentence start to device: ${this.macAddress} - "${text}"`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send TTS stop message to device
  sendTtsStopMessage() {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "stop",
      session_id: this.connection.udp.session_id,
    };

    console.log(`📤 [MQTT OUT] Sending TTS stop to device: ${this.macAddress}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }


  sendLLMThinkMessage(){
     if (!this.connection) return;
    console.log("Sending LLM think message");
    const message = {
      type: "llm",
      state: "think",
      session_id: this.connection.udp.session_id,
    };

    console.log(`📤 [MQTT OUT] Sending TTS stop to device: ${this.macAddress}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send STT (Speech-to-Text) result to device
  sendSttMessage(text) {
    if (!this.connection || !text) return;

    const message = {
      type: "stt",
      text: text,
      session_id: this.connection.udp.session_id,
    };

    console.log(
      `📤 [MQTT OUT] Sending STT result to device: ${this.macAddress} - "${text}"`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send emotion message to device (from LLM response)
  sendEmotionMessage(emoji, emotion) {
    if (!this.connection) return;

    const message = {
      type: "llm",
      text: emoji,
      emotion: emotion,
      session_id: this.connection.udp.session_id,
    };

    console.log(
      `📤 [MQTT OUT] Sending emotion to device: ${this.macAddress} - ${emotion} (${emoji})`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Convert device_control commands to MCP function calls
  convertDeviceControlToMcp(controlData) {
    if (!this.connection) return;

    const action = controlData.action || controlData.command;

    // Map device control actions to xiaozhi function names
    const actionToFunctionMap = {
      'set_volume': 'self_set_volume',
      'volume_up': 'self_volume_up',
      'volume_down': 'self_volume_down',
      'get_volume': 'self_get_volume',
      'mute': 'self_mute',
      'unmute': 'self_unmute',
      'set_light_color': 'self_set_light_color',
      'get_battery_status': 'self_get_battery_status',
      'set_light_mode': 'self_set_light_mode',
      'set_rainbow_speed': 'self_set_rainbow_speed'
    };

    const functionName = actionToFunctionMap[action];
    if (!functionName) {
      console.error(`❌ [DEVICE CONTROL] Unknown action: ${action}`);
      return;
    }

    // Prepare function arguments based on action type
    let functionArguments = {};
    if (action === "set_volume") {
      functionArguments.volume = controlData.volume || controlData.value;
    } else if (action === "volume_up" || action === "volume_down") {
      functionArguments.step = controlData.step || controlData.value || 10;
    }

    // Create function call data in the same format as handleFunctionCall expects
    const functionCallData = {
      function_call: {
        name: functionName,
        arguments: functionArguments
      },
      timestamp: controlData.timestamp || new Date().toISOString(),
      request_id: controlData.request_id || `req_${Date.now()}`
    };

    console.log(
      `🔄 [DEVICE CONTROL] Converting to MCP: ${action} -> ${functionName}, Args: ${JSON.stringify(functionArguments)}`
    );

    // Use existing handleFunctionCall method to send as MCP format
    this.handleFunctionCall(functionCallData);
  }

  // Handle xiaozhi function calls (volume controls, etc.)
  handleFunctionCall(functionData) {
    if (!this.connection) return;

    const functionCall = functionData.function_call;
    if (!functionCall || !functionCall.name) {
      console.error(`❌ [FUNCTION CALL] Invalid function call data:`, functionData);
      return;
    }

    // Map xiaozhi function names to MCP tool names for ESP32 firmware
    const functionToMcpToolMap = {
      'self_set_volume': 'self.audio_speaker.set_volume',
      'self_get_volume': 'self.get_device_status',
      'self_volume_up': 'self.audio_speaker.volume_up',
      'self_volume_down': 'self.audio_speaker.volume_down',
      'self_mute': 'self.audio_speaker.mute',
      'self_unmute': 'self.audio_speaker.unmute',
      'self_set_light_color': 'self.led.set_color',
      'self_get_battery_status': 'self.battery.get_status',
      'self_set_light_mode': 'self.led.set_mode',
      'self_set_rainbow_speed': 'self.led.set_rainbow_speed'
      
    };

    const mcpToolName = functionToMcpToolMap[functionCall.name];
    if (!mcpToolName) {
      console.log(`⚠️ [FUNCTION CALL] Unknown function: ${functionCall.name}, forwarding as MCP message`);
      // Forward unknown functions as MCP tool calls
      this.sendMcpMessage(functionCall.name, functionCall.arguments || {});
      return;
    }

    // Create MCP message format expected by ESP32 firmware (JSON-RPC 2.0)
    const requestId = parseInt(functionData.request_id?.replace('req_', '') || Date.now());
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: mcpToolName,
          arguments: functionCall.arguments || {}
        },
        id: requestId
      },
      session_id: this.connection.udp.session_id,
      timestamp: functionData.timestamp || new Date().toISOString(),
      request_id: `req_${requestId}`
    };

    console.log(
      `🔧 [MCP] Sending to device: ${this.macAddress} - Tool: ${mcpToolName}, Args: ${JSON.stringify(functionCall.arguments)}`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));

    // Simulate device response for testing (remove in production)
    // setTimeout(() => {
    //   this.simulateFunctionCallResponse(functionData);
    // }, 100);
  }

  // Handle mobile app music play requests
  async handleMobileMusicRequest(requestData) {
    try {
      console.log(`🎵 [MOBILE] Processing music request...`);

      if (!this.room || !this.room.localParticipant) {
        console.error(`❌ [MOBILE] Room not connected, cannot forward request`);
        return;
      }

      // Determine function name based on content type
      const functionName = requestData.content_type === "story" ? "play_story" : "play_music";

      // Prepare function arguments
      const functionArguments = {};

      if (requestData.content_type === "music") {
        // For music: song_name and language
        if (requestData.song_name) {
          functionArguments.song_name = requestData.song_name;
        }
        if (requestData.language) {
          functionArguments.language = requestData.language;
        }
      } else if (requestData.content_type === "story") {
        // For stories: story_name and category
        if (requestData.song_name) {
          functionArguments.story_name = requestData.song_name;
        }
        if (requestData.language) {
          functionArguments.category = requestData.language;
        }
      }

      // Create function call message for LiveKit agent
      const functionCallMessage = {
        type: "function_call",
        function_call: {
          name: functionName,
          arguments: functionArguments
        },
        source: "mobile_app",
        timestamp: Date.now(),
        request_id: `mobile_req_${Date.now()}`
      };

      // Forward to LiveKit agent via data channel
      const messageString = JSON.stringify(functionCallMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

      await this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`✅ [MOBILE] Music request forwarded to LiveKit agent`);
      console.log(`   🎯 Function: ${functionName}`);
      console.log(`   📝 Arguments: ${JSON.stringify(functionArguments)}`);
    } catch (error) {
      console.error(`❌ [MOBILE] Failed to forward music request: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
  }

  // Send unknown function calls directly to device (deprecated - use sendMcpMessage)
  sendFunctionCallToDevice(functionData) {
    if (!this.connection) return;

    const message = {
      type: "function_call",
      function_call: functionData.function_call,
      session_id: this.connection.udp.session_id,
      timestamp: functionData.timestamp || new Date().toISOString(),
      request_id: functionData.request_id || `req_${Date.now()}`
    };

    console.log(
      `📤 [FUNCTION FORWARD] Forwarding unknown function to device: ${this.macAddress} - ${functionData.function_call?.name}`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send MCP tool call message to device
  sendMcpMessage(toolName, toolArgs = {}) {
    if (!this.connection) return;

    const requestId = Date.now();
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs
        },
        id: requestId
      },
      session_id: this.connection.udp.session_id,
      timestamp: new Date().toISOString(),
      request_id: `req_${requestId}`
    };

    console.log(
      `📤 [MCP] Sending MCP tool call to device: ${this.macAddress} - Tool: ${toolName}, Args: ${JSON.stringify(toolArgs)}`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Simulate device control response (for testing - remove in production)
  simulateDeviceControlResponse(originalCommand) {
    if (!this.room || !this.room.localParticipant) return;

    try {
      let currentValue = null;
      let success = true;
      let errorMessage = null;

      // Simulate responses based on action type
      const action = originalCommand.action || originalCommand.command;
      switch (action) {
        case 'set_volume':
          currentValue = originalCommand.volume || originalCommand.value || 50;
          break;
        case 'get_volume':
          currentValue = 65; // Simulated current volume
          break;
        case 'volume_up':
          currentValue = Math.min(100, 65 + (originalCommand.step || originalCommand.value || 10));
          break;
        case 'volume_down':
          currentValue = Math.max(0, 65 - (originalCommand.step || originalCommand.value || 10));
          break;
        default:
          success = false;
          errorMessage = `Unknown action: ${action}`;
      }

      const responseMessage = {
        type: "device_control_response",
        action: action,
        success: success,
        current_value: currentValue,
        error: errorMessage,
        session_id: originalCommand.session_id || "unknown"
      };

      // Send response back to agent via data channel
      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));
      this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`🎛️ [DEVICE RESPONSE] Simulated response: Action ${action}, Success: ${success}, Value: ${currentValue}`);
    } catch (error) {
      console.error(`❌ [DEVICE RESPONSE] Error simulating device response:`, error);
    }
  }

  // Simulate function call response (for testing - remove in production)
  simulateFunctionCallResponse(originalFunction) {
    if (!this.room || !this.room.localParticipant) return;

    try {
      const functionCall = originalFunction.function_call;
      if (!functionCall) return;

      let success = true;
      let result = {};
      let errorMessage = null;

      // Simulate responses based on function name
      switch (functionCall.name) {
        case 'self_set_volume':
          const volume = functionCall.arguments?.volume || 50;
          result = { new_volume: volume };
          break;
        case 'self_get_volume':
          result = { current_volume: 65 }; // Simulated current volume
          break;
        case 'self_volume_up':
          result = { new_volume: Math.min(100, 65 + 10) };
          break;
        case 'self_volume_down':
          result = { new_volume: Math.max(0, 65 - 10) };
          break;
        case 'self_mute':
          result = { muted: true, previous_volume: 65 };
          break;
        case 'self_unmute':
          result = { muted: false, current_volume: 65 };
          break;
        default:
          success = false;
          errorMessage = `Unknown function: ${functionCall.name}`;
      }

      const responseMessage = {
        type: "function_response",
        request_id: originalFunction.request_id || "unknown",
        function_name: functionCall.name,
        success: success,
        result: result,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };

      // Send response back to agent via data channel
      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));
      this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`🔧 [FUNCTION RESPONSE] Simulated response: Function ${functionCall.name}, Success: ${success}, Result: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`❌ [FUNCTION RESPONSE] Error simulating function response:`, error);
    }
  }

  // Forward MCP response to LiveKit agent
  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    console.log(`🔋 [MCP-FORWARD] Forwarding MCP response for device ${this.macAddress}`);

    if (!this.room || !this.room.localParticipant) {
      console.error(`❌ [MCP-FORWARD] No room available for device ${this.macAddress}`);
      return false;
    }

    try {
      const responseMessage = {
        type: 'mcp',
        payload: mcpPayload,
        session_id: sessionId,
        request_id: requestId,
        timestamp: new Date().toISOString()
      };

      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

      await this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`✅ [MCP-FORWARD] Successfully forwarded MCP response to LiveKit agent`);
      console.log(`✅ [MCP-FORWARD] Request ID: ${requestId}`);
      return true;
    } catch (error) {
      console.error(`❌ [MCP-FORWARD] Error forwarding MCP response:`, error);
      return false;
    }
  }

  // Send LLM response to device
  sendLlmMessage(text) {
    if (!this.connection || !text) return;

    const message = {
      type: "llm",
      text: text,
      session_id: this.connection.udp.session_id,
    };

    console.log(
      `📤 [MQTT OUT] Sending LLM response to device: ${this.macAddress} - "${text}"`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send record stop message to device
  sendRecordStopMessage() {
    if (!this.connection) return;

    const message = {
      type: "record_stop",
      session_id: this.connection.udp.session_id,
    };

    console.log(
      `📤 [MQTT OUT] Sending record stop to device: ${this.macAddress}`
    );
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  // Send device information and initial greeting when agent joins
  /**
   * Send ready notification to client via MQTT
   * Client will press 's' key to trigger the actual greeting
   */
  async sendReadyForGreeting() {
    if (!this.connection) return;

    try {
      const readyMessage = {
        type: "ready_for_greeting",
        session_id: this.connection.udp.session_id,
        timestamp: Date.now()
      };

      this.connection.sendMqttMessage(JSON.stringify(readyMessage));
      console.log(
        `✅ [READY] Sent ready_for_greeting notification to client ${this.macAddress}. Waiting for 's' key press...`
      );
    } catch (error) {
      console.error(
        `❌ [READY] Error sending ready notification to client ${this.macAddress}:`, error
      );
    }
  }

  async sendInitialGreeting() {
    if (!this.connection) return;

    try {
      // Add delay to ensure agent has fully initialized its data channel handlers
      // Agent joins room immediately after accepting job, but handlers are registered
      // during entrypoint() execution which takes some time
      console.log(`⏳ [GREETING-DELAY] Waiting 1000ms for agent to fully initialize handlers...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`✅ [GREETING-DELAY] Delay complete, agent handlers should be ready`);

      // First send device information for prompt loading
      const deviceInfoMessage = {
        type: "device_info",
        device_mac: this.macAddress,
        device_uuid: this.uuid,
        timestamp: Date.now(),
        source: "mqtt_gateway"
      };

      // Send device info via LiveKit data channel
      if (this.room && this.room.localParticipant) {
        const deviceInfoString = JSON.stringify(deviceInfoMessage);
        const deviceInfoData = new Uint8Array(Buffer.from(deviceInfoString, 'utf8'));
        await this.room.localParticipant.publishData(
          deviceInfoData,
          { reliable: true }
        );

        console.log(
          `📱 [DEVICE INFO] Sent device MAC (${this.macAddress}) to agent via data channel`
        );
      } else {
        console.warn(
          `⚠️ [AGENT READY] Cannot send messages - room not ready for device: ${this.macAddress}`
        );
      }
    } catch (error) {
      console.error(
        `❌ [AGENT READY] Error sending messages to agent for device ${this.macAddress}:`, error
      );
    }
  }

  /**
   * Wait for agent to join the room with timeout
   * @param {number} timeoutMs - Timeout in milliseconds (default: 4000)
   * @returns {Promise<boolean>} - true if agent joined, false if timeout
   */
  async waitForAgentJoin(timeoutMs = 4000) {
    // If agent already joined, return immediately
    if (this.agentJoined) {
      console.log(`✅ [AGENT-WAIT] Agent already joined`);
      return true;
    }

    console.log(`⏳ [AGENT-WAIT] Waiting for agent to join (timeout: ${timeoutMs}ms)...`);

    // Race between agent join and timeout
    const timeoutPromise = new Promise((resolve) => {
      this.agentJoinTimeout = setTimeout(() => {
        console.log(`⏰ [AGENT-WAIT] Timeout reached, proceeding anyway`);
        resolve(false);
      }, timeoutMs);
    });

    const result = await Promise.race([
      this.agentJoinPromise.then(() => true),
      timeoutPromise
    ]);

    return result;
  }

  async sendAbortSignal(sessionId) {
    /**
     * Send abort signal to LiveKit agent via data channel
     * This tells the agent to stop current TTS/music playback
     */
    if (!this.room || !this.room.localParticipant) {
      throw new Error("Room not connected or no local participant");
    }

    try {
      const abortMessage = {
        type: "abort",  // Changed from "abort_playback" to match agent's expected type
        session_id: sessionId,
        timestamp: Date.now(),
        source: "mqtt_gateway"
      };

      // Send via LiveKit data channel to the agent
      // Convert to Uint8Array as required by LiveKit Node SDK
      const messageString = JSON.stringify(abortMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));
      await this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`🛑 [ABORT] Sent abort signal to LiveKit agent via data channel`);

      // CRITICAL: Clear the audio playing flag immediately when abort is sent
      this.isAudioPlaying = false;
      console.log(`🎵 [ABORT-CLEAR] Cleared audio playing flag for device: ${this.macAddress}`);
    } catch (error) {
      console.error(`[LiveKitBridge] Failed to send abort signal:`, error);
      throw error;
    }
  }

  async sendEndPrompt(sessionId) {
    /**
     * Send end prompt signal to LiveKit agent via data channel
     * This tells the agent to say goodbye using the end prompt before session ends
     */
    if (!this.room || !this.room.localParticipant) {
      throw new Error("Room not connected or no local participant");
    }

    // Check if the room is still connected before trying to send data
    if (!this.room.isConnected) {
      console.log(`👋 [END-PROMPT] Room already disconnected, skipping end prompt`);
      return;
    }

    try {
      const endMessage = {
        type: "end_prompt",
        session_id: sessionId,
        prompt: "You must end this conversation now. Start with 'Time flies so fast' and say a SHORT goodbye in 1-2 sentences maximum. Do NOT ask questions or suggest activities. Just say goodbye emotionally and end the conversation.",
        timestamp: Date.now(),
        source: "mqtt_gateway"
      };

      // Send via LiveKit data channel to the agent
      // Convert to Uint8Array as required by LiveKit Node SDK
      const messageString = JSON.stringify(endMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));
      await this.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`👋 [END-PROMPT] Sent end prompt to LiveKit agent via data channel`);
    } catch (error) {
      console.error(`[LiveKitBridge] Failed to send end prompt:`, error);
      // Don't throw the error - just log it and continue with cleanup
      console.log(`👋 [END-PROMPT] Continuing with connection cleanup despite end prompt failure`);
    }
  }

  async close() {
    if (this.room) {
      console.log("[LiveKitBridge] Disconnecting from LiveKit room");

      // CRITICAL: Clear audio flag before disconnect to prevent stuck state
      this.isAudioPlaying = false;
      console.log(`🎵 [CLEANUP] Cleared audio flag on bridge close for device: ${this.macAddress}`);

      // First disconnect from the room
      await this.room.disconnect();

      // Send a final cleanup signal to ensure the agent side also cleans up
      try {
        const cleanupMessage = {
          type: "cleanup_request",
          session_id: this.connection.udp.session_id,
          timestamp: Date.now(),
          source: "mqtt_gateway"
        };

        if (this.room.localParticipant && this.room.isConnected) {
          const messageString = JSON.stringify(cleanupMessage);
          const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));
          await this.room.localParticipant.publishData(
            messageData,
            { reliable: true }
          );
          console.log("🧹 Sent cleanup signal to agent before disconnect");
        }
      } catch (error) {
        console.log("Note: Could not send cleanup signal (room already disconnected)");
      }

      this.room = null;
    }
  }

  /**
   * Clean up all old LiveKit rooms for a specific MAC address
   * Finds and deletes ALL rooms ending with the MAC address pattern
   * This ensures no ghost sessions exist before creating a new one
   *
   * @param {string} macAddress - MAC address with colons (e.g., "28:56:2f:07:c6:ec")
   * @param {RoomServiceClient} roomService - LiveKit room service client
   */
  static async cleanupOldSessionsForDevice(macAddress, roomService, currentRoomName = null) {
    try {
      // Convert MAC address format: "28:56:2f:07:c6:ec" → "28562f07c6ec"
      const macForRoom = macAddress.replace(/:/g, '');
      console.log(`🧹 [CLEANUP] Searching for old sessions for MAC: ${macAddress} (${macForRoom})`);
      if (currentRoomName) {
        console.log(`🔒 [CLEANUP] Protecting current room from deletion: ${currentRoomName}`);
      }

      // Safety check: Ensure roomService is available
      if (!roomService) {
        console.log(`⚠️ [CLEANUP] RoomService not available, skipping cleanup`);
        return;
      }

      // Get ALL active rooms from LiveKit server
      const allRooms = await roomService.listRooms();
      console.log(`📊 [CLEANUP] Found ${allRooms.length} total active rooms`);

      // Filter rooms belonging to this device (pattern: *_28562f07c6ec)
      // BUT exclude the current room being created
      const deviceRooms = allRooms.filter(room => {
        if (!room.name || !room.name.endsWith(`_${macForRoom}`)) {
          return false;
        }

        // CRITICAL: Never delete the room we're currently creating
        if (currentRoomName && room.name === currentRoomName) {
          console.log(`   🔒 Skipping current room: ${room.name} (actively being used)`);
          return false;
        }

        return true;
      });

      if (deviceRooms.length > 0) {
        console.log(`🗑️ [CLEANUP] Found ${deviceRooms.length} old session(s) for MAC ${macAddress}:`);

        // Delete each old room
        for (const room of deviceRooms) {
          const roomCreationTime = Number(room.creationTime);
          const roomAge = now - roomCreationTime;
          console.log(`   - Deleting room: ${room.name} (${room.numParticipants} participants, age: ${roomAge.toFixed(0)}s)`);
          try {
            await roomService.deleteRoom(room.name);
            console.log(`   ✅ Successfully deleted room: ${room.name}`);
          } catch (deleteError) {
            console.error(`   ❌ Failed to delete room ${room.name}:`, deleteError.message);
            // Continue with other rooms even if one fails
          }
        }

        console.log(`✅ [CLEANUP] Completed cleanup for MAC ${macAddress}`);

        // Wait for cleanup to propagate on LiveKit server
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.log(`✓ [CLEANUP] No old sessions found for MAC: ${macAddress}`);
      }
    } catch (error) {
      console.error(`❌ [CLEANUP] Error cleaning up sessions for MAC ${macAddress}:`, error.message);
      // Don't throw - continue with connection attempt even if cleanup fails
    }
  }
}

const MacAddressRegex = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/**
 * MQTT connection class for devices connecting through EMQX broker
 * Handles all device connections (ESP32 hardware and Python test clients)
 */
class VirtualMQTTConnection {
  constructor(deviceId, connectionId, gateway, helloPayload) {
    this.deviceId = deviceId;
    this.connectionId = connectionId;
    this.gateway = gateway;
    this.clientId = helloPayload.clientId || deviceId;
    this.username = helloPayload.username;
    this.password = helloPayload.password;
     this.fullClientId = helloPayload.clientId;

    this.bridge = null;
    this.udp = {
      remoteAddress: null,
      cookie: null,
      localSequence: 0,
      remoteSequence: 0,
    };
    this.headerBuffer = Buffer.alloc(16);
    this.closing = false;

    // Add inactivity timeout tracking
    this.lastActivityTime = Date.now();
    this.inactivityTimeoutMs = 60 * 1000; // 1 minute in milliseconds
    this.isEnding = false; // Track if end prompt has been sent
    this.endPromptSentTime = null; // Track when end prompt was sent

    // Track target toy for mobile-initiated connections
    this.targetToyMac = null; // MAC address of the toy to route audio to
    this.isMobileConnection = false; // Flag to identify mobile connections

    // Parse device info from hello message
    if (helloPayload.clientId) {
      const parts = helloPayload.clientId.split("@@@");
      if (parts.length === 3) {
        // GID_test@@@mac_address@@@uuid format
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = parts[2];
        this.userData = null; // Set to null since we don't have user data

        console.log(`📱 [VIRTUAL] Parsed client info:`);
        console.log(`   - Group ID: ${this.groupId}`);
        console.log(`   - MAC Address: ${this.macAddress}`);
        console.log(`   - UUID: ${this.uuid}`);

        // Validate MAC address format
        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }

        // For virtual connections, we can skip the full credential validation
        // since we're working with EMQX and not the original MQTT protocol

      } else if (parts.length === 2) {
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = `virtual-${Date.now()}`; // Generate a virtual UUID
        this.userData = null;

        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }
      } else {
        console.error(`❌ [VIRTUAL] Invalid clientId format: ${helloPayload.clientId}`);
        this.close();
        return;
      }

      this.replyTo = `devices/p2p/${parts[1]}`;
      console.log(`📱 [VIRTUAL] Reply topic set to: ${this.replyTo}`);
    } else {
      console.error(`❌ [VIRTUAL] No clientId provided in hello payload`);
      this.close();
      return;
    }

    debug(`Virtual connection created for device: ${this.deviceId}`);
  }

  updateActivityTime() {
    this.lastActivityTime = Date.now();

    // Don't reset ending state during goodbye sequence
    if (this.isEnding) {
      console.log(`📱 [ENDING-IGNORE] Activity during goodbye sequence ignored for virtual device: ${this.deviceId}`);
      return; // Don't log timer reset during ending
    }

    console.log(`⏱️ [TIMER-RESET] Activity timer reset for virtual device: ${this.deviceId} at ${new Date().toISOString()}`);
  }

  handlePublish(publishData) {
    // Update activity timestamp on any MQTT message receipt
    console.log(`📨 [ACTIVITY] MQTT message received from virtual device ${this.deviceId}, resetting inactivity timer`);
    this.updateActivityTime();

    try {
      const json = JSON.parse(publishData.payload);
      if (json.type === "hello") {
        if (json.version !== 3) {
          debug(
            "Unsupported protocol version:",
            json.version,
            "closing connection"
          );
          this.close();
          return;
        }

        this.parseHelloMessage(json).catch((error) => {
          console.error(`❌ [HELLO-ERROR] Failed to process hello message for ${this.deviceId}:`, error);
          console.error(`❌ [HELLO-ERROR] Error stack:`, error.stack);
          debug("Failed to process hello message:", error);
          this.close();
        });
      } else {
        this.parseOtherMessage(json).catch((error) => {
          debug("Failed to process other message:", error);
          this.close();
        });
      }
    } catch (error) {
      debug("Error parsing message:", error);
    }
  }

  sendMqttMessage(payload) {
    console.log(`📤 [VIRTUAL] sendMqttMessage called for device: ${this.deviceId}`);
    console.log(`📤 [VIRTUAL] Payload: ${payload}`);
    debug(`Sending message to ${this.deviceId}: ${payload}`);

    try {
      const parsedPayload = JSON.parse(payload);
      console.log(`📤 [VIRTUAL] Parsed payload:`, parsedPayload);
      this.gateway.publishToDevice(this.fullClientId, parsedPayload)
      console.log(`📤 [VIRTUAL] Called publishToDevice for device: ${this.deviceId}`);
    } catch (error) {
      console.error(`❌ [VIRTUAL] Error in sendMqttMessage for device ${this.deviceId}:`, error);
    }
  }

  // Forward MCP response to LiveKit agent
  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    console.log(`🔋 [MCP-FORWARD] Forwarding MCP response for device ${this.deviceId}`);

    if (!this.bridge || !this.bridge.room || !this.bridge.room.localParticipant) {
      console.error(`❌ [MCP-FORWARD] No LiveKit room available for device ${this.deviceId}`);
      return false;
    }

    try {
      const responseMessage = {
        type: 'mcp',
        payload: mcpPayload,
        session_id: sessionId,
        request_id: requestId,
        timestamp: new Date().toISOString()
      };

      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

      await this.bridge.room.localParticipant.publishData(
        messageData,
        { reliable: true }
      );

      console.log(`✅ [MCP-FORWARD] Successfully forwarded MCP response to LiveKit agent`);
      console.log(`✅ [MCP-FORWARD] Request ID: ${requestId}`);
      return true;
    } catch (error) {
      console.error(`❌ [MCP-FORWARD] Error forwarding MCP response:`, error);
      return false;
    }
  }

  sendUdpMessage(payload, timestamp) {
    // Check if this is a mobile-initiated connection that needs routing to a physical toy
    if (!this.udp.remoteAddress && this.isMobileConnection && this.macAddress) {
      // Find the real toy connection with UDP endpoint
      const toyConnection = this.findRealToyConnection(this.macAddress);
      if (toyConnection && toyConnection.udp && toyConnection.udp.remoteAddress) {
        console.log(`🎯 [MOBILE->TOY] Routing audio from mobile to toy: ${this.macAddress}`);
        // Route audio through the real toy's UDP connection
        toyConnection.sendUdpMessage(payload, timestamp);
        return;
      } else {
        // Log but don't fail - toy might not be connected yet
        console.log(`⚠️ [MOBILE->TOY] No active toy connection found for MAC: ${this.macAddress}`);
        return;
      }
    }

    // Original implementation for direct UDP connections
    if (!this.udp.remoteAddress) {
      debug(`Device ${this.deviceId} not connected, cannot send UDP message`);
      return;
    }

    this.udp.localSequence++;
    const header = this.generateUdpHeader(
      payload.length,
      timestamp,
      this.udp.localSequence
    );

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    const encryptedPayload = streamingCrypto.encrypt(
      payload,
      this.udp.encryption,
      this.udp.key,
      header
    );
    const message = Buffer.concat([header, encryptedPayload]);
    this.gateway.sendUdpMessage(message, this.udp.remoteAddress);
  }

  generateUdpHeader(length, timestamp, sequence) {
    this.headerBuffer.writeUInt8(1, 0);
    this.headerBuffer.writeUInt8(0, 1);
    this.headerBuffer.writeUInt16BE(length, 2);
    this.headerBuffer.writeUInt32BE(this.connectionId, 4);
    this.headerBuffer.writeUInt32BE(timestamp, 8);
    this.headerBuffer.writeUInt32BE(sequence, 12);
    return Buffer.from(this.headerBuffer);
  }

  findRealToyConnection(macAddress) {
    // Find device connection (all devices now use VirtualMQTTConnection)
    const deviceInfo = this.gateway.deviceConnections.get(macAddress);
    if (deviceInfo && deviceInfo.connection) {
      console.log(`✅ [FIND-TOY] Found device connection for MAC ${macAddress}`);
      return deviceInfo.connection;
    }

    console.log(`❌ [FIND-TOY] No device connection found for MAC ${macAddress}`);
    return null;
  }

  async parseHelloMessage(json) {
    console.log(`🔍 [PARSE-HELLO] Starting parseHelloMessage for ${this.deviceId}`);
    console.log(`🔍 [PARSE-HELLO] JSON version: ${json.version}, has bridge: ${!!this.bridge}`);

    this.udp = {
      ...this.udp,
      key: crypto.randomBytes(16),
      nonce: this.generateUdpHeader(0, 0, 0),
      encryption: "aes-128-ctr",
      remoteSequence: 0,
      localSequence: 0,
      startTime: Date.now(),
    };

    if (this.bridge) {
      debug(
        `${this.deviceId} received duplicate hello message, closing previous bridge`
      );
      this.bridge.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.bridge = null;
    }

    // Generate new UUID for session
    const newSessionUuid = crypto.randomUUID();
    console.log(`🔄 [NEW-SESSION] Generated UUID: ${newSessionUuid}`);

    // Generate session_id for room
    const macForRoom = this.macAddress.replace(/:/g, '');
    const futureSessionId = `${newSessionUuid}_${macForRoom}`;
    this.udp.session_id = futureSessionId;

    console.log(`🏗️ [HELLO] Creating LiveKit room and connecting gateway (NO agent deployment yet)`);

    // Clean up old sessions
    if (this.gateway.roomService) {
      const newRoomName = `${newSessionUuid}_${macForRoom}`;
      console.log(`🧹 [CLEANUP] Cleaning up old sessions for device: ${this.deviceId}`);
      LiveKitBridge.cleanupOldSessionsForDevice(this.deviceId, this.gateway.roomService, newRoomName).then(() => {
        console.log(`✅ [CLEANUP] Old sessions cleaned up`);
      }).catch((err) => {
        console.warn(`⚠️ [CLEANUP] Cleanup error (non-fatal):`, err);
      });
    }

    // Create bridge immediately (this creates room and gateway joins)
    this.bridge = new LiveKitBridge(
      this,
      json.version,
      this.deviceId,
      newSessionUuid,
      this.userData
    );

    // Mark bridge as waiting for agent deployment
    this.bridge.agentDeployed = false;

    // Setup bridge close handler
    this.bridge.on("close", () => {
      const seconds = (Date.now() - this.udp.startTime) / 1000;
      console.log(`Call ended: ${this.deviceId} Duration: ${seconds}s`);
      this.sendMqttMessage(
        JSON.stringify({ type: "goodbye", session_id: this.udp.session_id })
      );
      this.bridge = null;
    });

    // Reset activity timer
    this.lastActivityTime = Date.now();

    try {
      // Connect to LiveKit room (gateway joins, and agent will deploy immediately)
      const roomCreationStart = Date.now();
      await this.bridge.connect(json.audio_params, json.features, this.server?.roomService || this.gateway?.roomService);
      const roomCreationTime = Date.now() - roomCreationStart;
      console.log(`✅ [HELLO] Room created and gateway connected in ${roomCreationTime}ms`);
      console.log(`🤖 [HELLO] Deploying agent immediately and will send initial greeting`);

      // Get the room name for agent dispatch
      const roomName = this.bridge.room ? this.bridge.room.name : null;

      // Dispatch agent immediately on hello
      if (roomName && this.gateway?.agentDispatchClient) {
        try {
          await this.gateway.agentDispatchClient.createDispatch(roomName, 'cheeko-agent', {
            metadata: JSON.stringify({
              device_mac: this.macAddress,
              device_uuid: this.deviceId,
              timestamp: Date.now()
            })
          });
          console.log(`✅ [HELLO] Agent dispatched to room: ${roomName}`);
          this.bridge.agentDeployed = true;

          // Wait for agent to join and then trigger initial greeting
          console.log(`⏳ [HELLO] Waiting for agent to join before sending initial greeting...`);
          this.bridge.waitForAgentJoin(4000).then((agentReady) => {
            if (agentReady) {
              console.log(`✅ [HELLO] Agent joined, sending initial greeting...`);
              return this.bridge.sendInitialGreeting();
            } else {
              console.warn(`⚠️ [HELLO] Agent join timeout, trying to send greeting anyway...`);
              return this.bridge.sendInitialGreeting();
            }
          }).then(() => {
            console.log(`✅ [HELLO] Initial greeting sent successfully`);
          }).catch((error) => {
            console.error(`❌ [HELLO] Error sending initial greeting:`, error);
          });
        } catch (error) {
          console.error(`❌ [HELLO] Failed to dispatch agent:`, error.message);
        }
      } else {
        console.warn(`⚠️ [HELLO] Cannot dispatch agent - roomName: ${roomName}, agentDispatchClient: ${!!this.gateway?.agentDispatchClient}`);
      }

      // Send hello response with UDP session details
      this.sendMqttMessage(
        JSON.stringify({
          type: "hello",
          version: json.version,
          session_id: this.udp.session_id,
          transport: "udp",
          udp: {
            server: this.gateway.publicIp,
            port: this.gateway.udpPort,
            encryption: this.udp.encryption,
            key: this.udp.key.toString("hex"),
            nonce: this.udp.nonce.toString("hex"),
          },
          audio_params: {
            sample_rate: 24000,
            channels: 1,
            frame_duration: 60,
            format: "opus"
          },
        })
      );

      console.log(`✅ [READY] Room ready. Agent will send initial greeting then use PTT for further interaction.`);

    } catch (error) {
      this.sendMqttMessage(
        JSON.stringify({
          type: "error",
          message: "Failed to create room",
        })
      );
      console.error(
        `${this.deviceId} failed to create room: ${error}`
      );
    }
  }

  async parseOtherMessage(json) {
    if (!this.bridge) {
      if (json.type !== "goodbye") {
        this.sendMqttMessage(
          JSON.stringify({ type: "goodbye", session_id: json.session_id })
        );
      }
      return;
    }

    if (json.type === "goodbye") {
      console.log(`🔌 [DISCONNECT-AGENT] Received goodbye from device: ${this.deviceId} - disconnecting agent but keeping room alive`);

      // Disconnect agent participant but keep room alive
      if (this.bridge && this.bridge.room && this.bridge.room.localParticipant) {
        try {
          // Send disconnect message to agent via data channel
          const disconnectMessage = {
            type: "disconnect_agent",
            session_id: json.session_id,
            timestamp: Date.now(),
            source: "mqtt_gateway"
          };

          const messageString = JSON.stringify(disconnectMessage);
          const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

          await this.bridge.room.localParticipant.publishData(
            messageData,
            { reliable: true }
          );

          console.log(`✅ [DISCONNECT-AGENT] Sent disconnect signal to agent`);

          // Mark agent as not joined so it can rejoin
          this.bridge.agentJoined = false;
          this.bridge.agentDeployed = false;

          // Reset agent join promise for next join
          this.bridge.agentJoinPromise = new Promise((resolve) => {
            this.bridge.agentJoinResolve = resolve;
          });

          console.log(`🏠 [DISCONNECT-AGENT] Room remains alive, agent can rejoin on 's' press`);
        } catch (error) {
          console.error(`❌ [DISCONNECT-AGENT] Failed to disconnect agent:`, error);
        }
      }

      // Keep bridge and room alive - agent can rejoin with 's'
      return;
    }

    // Handle abort message - forward to LiveKit agent via data channel
    if (json.type === "abort") {
      try {
        console.log(`🛑 [ABORT] Received abort signal from device: ${this.deviceId}`);
        await this.bridge.sendAbortSignal(json.session_id);
        debug("Successfully forwarded abort signal to LiveKit agent");
      } catch (error) {
        debug("Failed to forward abort signal to LiveKit:", error);
      }
      return;
    }

    // Handle function_call from mobile app - forward directly to LiveKit agent
    if (json.type === "function_call" && json.source === "mobile_app") {
      try {
        console.log(`🎵 [MOBILE] Function call received from mobile app: ${this.deviceId}`);
        console.log(`   🎯 Function: ${json.function_call?.name}`);
        console.log(`   📝 Arguments: ${JSON.stringify(json.function_call?.arguments)}`);

        // Check if bridge and room are available
        if (!this.bridge || !this.bridge.room || !this.bridge.room.localParticipant) {
          console.error(`❌ [MOBILE] No bridge/room available to handle function call`);
          return;
        }

        // First send abort signal to stop any current playback
        console.log(`🛑 [MOBILE] Sending abort signal before new playback`);
        await this.bridge.sendAbortSignal(this.udp.session_id);

        // Wait a moment for abort to process
        await new Promise(resolve => setTimeout(resolve, 100));

        // Then forward the new function call to LiveKit agent
        const messageString = JSON.stringify({
          type: "function_call",
          function_call: json.function_call,
          source: "mobile_app",
          timestamp: json.timestamp || Date.now(),
          request_id: json.request_id || `mobile_req_${Date.now()}`
        });
        const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

        await this.bridge.room.localParticipant.publishData(
          messageData,
          { reliable: true }
        );

        console.log(`✅ [MOBILE] Function call forwarded to LiveKit agent`);
      } catch (error) {
        console.error(`❌ [MOBILE] Failed to forward function call:`, error);
      }
      return;
    }

    // Handle mobile music request - forward to LiveKit bridge (legacy support)
    if (json.type === "mobile_music_request") {
      try {
        console.log(`🎵 [MOBILE] Mobile music request received from virtual device: ${this.deviceId}`);
        console.log(`   🎵 Song: ${json.song_name}`);
        console.log(`   🗂️ Type: ${json.content_type}`);
        console.log(`   🌐 Language: ${json.language || 'Not specified'}`);

        // Mark this as a mobile-initiated connection
        this.isMobileConnection = true;
        console.log(`   📱 Marked as mobile connection for MAC: ${this.macAddress}`);

        // Check if bridge and room are available
        if (!this.bridge || !this.bridge.room || !this.bridge.room.localParticipant) {
          console.error(`❌ [MOBILE] No bridge/room available to handle music request`);
          return;
        }

        // Convert to function_call format for LiveKit agent
        const functionName = json.content_type === "story" ? "play_story" : "play_music";
        const functionArguments = {};

        if (json.content_type === "music") {
          // For music: song_name and language
          if (json.song_name) {
            functionArguments.song_name = json.song_name;
          }
          if (json.language) {
            functionArguments.language = json.language;
          }
        } else if (json.content_type === "story") {
          // For stories: story_name and category
          if (json.song_name) {
            functionArguments.story_name = json.song_name;
          }
          if (json.language) {
            functionArguments.category = json.language;
          }
        }

        // Create function call message for LiveKit agent
        const functionCallMessage = {
          type: "function_call",
          function_call: {
            name: functionName,
            arguments: functionArguments
          },
          source: "mobile_app",
          timestamp: Date.now(),
          request_id: `mobile_req_${Date.now()}`
        };

        // Forward to LiveKit agent via data channel
        const messageString = JSON.stringify(functionCallMessage);
        const messageData = new Uint8Array(Buffer.from(messageString, 'utf8'));

        await this.bridge.room.localParticipant.publishData(
          messageData,
          { reliable: true }
        );

        console.log(`✅ [MOBILE] Music request forwarded to LiveKit agent`);
        console.log(`   🎯 Function: ${functionName}`);
        console.log(`   📝 Arguments: ${JSON.stringify(functionArguments)}`);

      } catch (error) {
        console.error(`❌ [MOBILE] Failed to handle mobile music request:`, error);
      }
      return;
    }

    // Handle push-to-talk messages (support both ESP32 and client formats)
    if (json.type === "listen" || json.type === "start_ptt" || json.type === "end_ptt") {
      try {
        let isPttStart = false;
        let isPttEnd = false;

        // Determine PTT action based on message format
        if (json.type === "listen") {
          // ESP32 format: {"type":"listen","state":"start/stop","mode":"manual/auto"}
          const state = json.state;
          const mode = json.mode;
          console.log(`🎤 [PTT] Received listen message - State: ${state}, Mode: ${mode}, Full JSON: ${JSON.stringify(json)}`);
          // Support both manual and auto modes for PTT start
          isPttStart = (state === "start" && (mode === "manual" || mode === "auto"));
          // PTT end works regardless of mode - just check if state is "stop"
          isPttEnd = (state === "stop");
          console.log(`🎤 [PTT] Decision - isPttStart: ${isPttStart}, isPttEnd: ${isPttEnd}`);
        } else if (json.type === "start_ptt") {
          // Client format: {"type":"start_ptt"}
          console.log(`🎤 [PTT] Received start_ptt message`);
          isPttStart = true;
        } else if (json.type === "end_ptt") {
          // Client format: {"type":"end_ptt"}
          console.log(`🎤 [PTT] Received end_ptt message`);
          isPttEnd = true;
        }

        console.log(`🎤 [PTT] Final decision - isPttStart: ${isPttStart}, isPttEnd: ${isPttEnd}`);

        // Check if bridge and room are available
        if (!this.bridge || !this.bridge.room || !this.bridge.room.localParticipant) {
          console.error(`❌ [PTT] No bridge/room available for PTT control`);
          return;
        }

        // Find the agent participant
        const participants = Array.from(this.bridge.room.remoteParticipants.values());
        const agentParticipant = participants.find(p => p.identity.includes('agent'));

        if (!agentParticipant) {
          console.error(`❌ [PTT] No agent participant found in room`);
          return;
        }

        console.log(`🎤 [PTT] Agent participant found: ${agentParticipant.identity}`);

        if (isPttStart) {
          // PTT started - enable audio input
          console.log(`🎤 [PTT] Starting push-to-talk - calling start_turn RPC`);

          const result = await this.bridge.room.localParticipant.performRpc({
            destinationIdentity: agentParticipant.identity,
            method: "start_turn",
            payload: ""
          });

          console.log(`✅ [PTT] start_turn RPC completed: ${result}`);

        } else if (isPttEnd) {
          // PTT ended - disable audio input and commit turn
          console.log(`🎤 [PTT] Stopping push-to-talk - calling end_turn RPC`);

          const result = await this.bridge.room.localParticipant.performRpc({
            destinationIdentity: agentParticipant.identity,
            method: "end_turn",
            payload: ""
          });

          console.log(`✅ [PTT] end_turn RPC completed: ${result}`);
        } else {
          console.log(`⚠️ [PTT] Neither start nor end condition met - ignoring message`);
        }

      } catch (error) {
        console.error(`❌ [PTT] Failed to handle PTT message:`, error);
      }
      return;
    }

    debug("Received other message, not forwarding to LiveKit:", json);
  }

  onUdpMessage(rinfo, message, payloadLength, timestamp, sequence) {
    // UDP messages do not reset inactivity timer - only MQTT messages do

    if (!this.bridge) {
      return;
    }

    if (this.udp.remoteAddress !== rinfo) {
      this.udp.remoteAddress = rinfo;
    }

    if (sequence < this.udp.remoteSequence) {
      return;
    }

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    const header = message.slice(0, 16);
    const encryptedPayload = message.slice(16, 16 + payloadLength);
    const payload = streamingCrypto.decrypt(
      encryptedPayload,
      this.udp.encryption,
      this.udp.key,
      header
    );

    const payloadStr = payload.toString();
    if (payloadStr.startsWith("ping:")) {
      console.log(
        `🏓 [UDP PING] Received ping: ${payloadStr} from ${rinfo.address}:${rinfo.port}`
      );
      return;
    }

    this.bridge.sendAudio(payload, timestamp);
    this.udp.remoteSequence = sequence;
  }

  async checkKeepAlive() {
    // Don't check keepalive if connection is closing
    if (this.closing) {
      return;
    }

    const now = Date.now();

    // If we're in ending phase, check for final timeout
    if (this.isEnding && this.endPromptSentTime) {
      const timeSinceEndPrompt = now - this.endPromptSentTime;
      const maxEndWaitTime = 30 * 1000; // 30 seconds max wait for end prompt audio

      if (timeSinceEndPrompt > maxEndWaitTime) {
        console.log(`🕒 [END-TIMEOUT] End prompt timeout reached, force closing virtual connection: ${this.deviceId} (waited ${Math.round(timeSinceEndPrompt / 1000)}s)`);

        // Send goodbye MQTT message before force closing
        try {
          this.sendMqttMessage(
            JSON.stringify({
              type: "goodbye",
              session_id: this.udp ? this.udp.session_id : null,
              reason: "end_prompt_timeout",
              timestamp: Date.now()
            })
          );
          console.log(`👋 [GOODBYE-MQTT] Sent goodbye MQTT message to virtual device on timeout: ${this.deviceId}`);
        } catch (error) {
          console.error(`Failed to send goodbye MQTT message: ${error.message}`);
        }

        this.close();
        return;
      }

      // Show countdown for end prompt completion
      if (timeSinceEndPrompt % 5000 < 1000) {
        const remainingSeconds = Math.round((maxEndWaitTime - timeSinceEndPrompt) / 1000);
        console.log(`⏳ [END-WAIT] Virtual device ${this.deviceId}: ${remainingSeconds}s until force disconnect`);
      }
      return; // Don't do normal timeout check while ending
    }

    // Check for inactivity timeout (1 minute of no communication)
    const timeSinceLastActivity = now - this.lastActivityTime;

    // Skip timeout check if audio is actively playing
    if (this.bridge && this.bridge.isAudioPlaying) {
      // Reset the timer while audio is playing to prevent timeout
      this.lastActivityTime = now;
      console.log(`🎵 [AUDIO-ACTIVE] Resetting timer - audio is playing for virtual device: ${this.deviceId}`);
      return;
    }

    if (timeSinceLastActivity > this.inactivityTimeoutMs) {
      // Send end prompt instead of immediate close
      if (!this.isEnding && this.bridge) {
        this.isEnding = true;
        this.endPromptSentTime = now;
        console.log(`👋 [END-PROMPT] Sending goodbye message before timeout: ${this.deviceId} (inactive for ${Math.round(timeSinceLastActivity / 1000)}s) - Last activity: ${new Date(this.lastActivityTime).toISOString()}, Now: ${new Date(now).toISOString()}`);

        try {
          // Send end prompt to agent for voice goodbye (TTS "Time flies fast...")
          // Note: Goodbye MQTT will be sent AFTER TTS finishes (in agent_state_changed handler)
          this.goodbyeSent = false; // Flag to track if goodbye MQTT was sent
          await this.bridge.sendEndPrompt(this.udp.session_id);
          console.log(`👋 [END-PROMPT-SENT] Waiting for TTS goodbye to complete before sending goodbye MQTT: ${this.deviceId}`);
        } catch (error) {
          console.error(`Failed to send end prompt: ${error.message}`);
          // If end prompt fails, close immediately
          this.close();
        }
        return;
      } else {
        // No bridge available, send goodbye message and close immediately
        console.log(`🕒 [TIMEOUT] Closing virtual connection due to 1-minute inactivity: ${this.deviceId} (inactive for ${Math.round(timeSinceLastActivity / 1000)}s)`);

        // Send goodbye MQTT message before closing
        try {
          this.sendMqttMessage(
            JSON.stringify({
              type: "goodbye",
              session_id: this.udp ? this.udp.session_id : null,
              reason: "inactivity_timeout",
              timestamp: Date.now()
            })
          );
          console.log(`👋 [GOODBYE-MQTT] Sent goodbye MQTT message to virtual device: ${this.deviceId}`);
        } catch (error) {
          console.error(`Failed to send goodbye MQTT message: ${error.message}`);
        }

        this.close();
        return;
      }
    }

    // Log remaining time until timeout (only show every 30 seconds to avoid spam)
    if (timeSinceLastActivity % 30000 < 1000) {
      const remainingSeconds = Math.round((this.inactivityTimeoutMs - timeSinceLastActivity) / 1000);
      console.log(`⏰ [TIMER-CHECK] Virtual device ${this.deviceId}: ${remainingSeconds}s until timeout`);
    }

    // Virtual connections don't need traditional keep-alive since EMQX handles it
  }

  close() {
    this.closing = true;
    if (this.bridge) {
      this.bridge.close();
      this.bridge = null;
    }
    // Remove from gateway maps
    this.gateway.connections.delete(this.connectionId);
    this.gateway.deviceConnections.delete(this.deviceId);
  }

  isAlive() {
    return this.bridge && this.bridge.isAlive();
  }
}

class MQTTGateway {
  constructor() {
    this.udpPort = parseInt(process.env.UDP_PORT) || 1883;
    this.publicIp = process.env.PUBLIC_IP || "127.0.0.1";
    this.connections = new Map(); // clientId -> VirtualMQTTConnection
    this.keepAliveTimer = null;
    this.keepAliveCheckInterval = 15000; // Check every 15 seconds
    this.headerBuffer = Buffer.alloc(16);
    this.mqttClient = null;
    this.deviceConnections = new Map(); // deviceId -> connection info
    this.clientConnections = new Map(); // clientId -> device info (for tracking EMQX clients)

    // Initialize LiveKit RoomServiceClient for room management
    try {
      const livekitConfig = configManager.get("livekit");
      if (livekitConfig && livekitConfig.url && livekitConfig.api_key && livekitConfig.api_secret) {
        this.roomService = new RoomServiceClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        console.log("✅ [INIT] RoomServiceClient initialized for session cleanup");

        // Initialize AgentDispatchClient for explicit agent dispatch
        this.agentDispatchClient = new AgentDispatchClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        console.log("✅ [INIT] AgentDispatchClient initialized for explicit agent dispatch");
      } else {
        console.warn("⚠️ [INIT] LiveKit config incomplete, room cleanup will be skipped");
        this.roomService = null;
        this.agentDispatchClient = null;
      }
    } catch (error) {
      console.error("❌ [INIT] Failed to initialize LiveKit clients:", error.message);
      this.roomService = null;
      this.agentDispatchClient = null;
    }
  }

  generateNewConnectionId() {
    // Generate a unique 32-bit integer
    let id;
    do {
      id = Math.floor(Math.random() * 0xffffffff);
    } while (this.connections.has(id));
    return id;
  }

  start() {
    // Connect to EMQX broker
    this.connectToEmqxBroker();

    this.udpServer = dgram.createSocket("udp4");
    this.udpServer.on("message", this.onUdpMessage.bind(this));
    this.udpServer.on("error", (err) => {
      console.error("UDP error", err);
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    this.udpServer.bind(this.udpPort, () => {
      console.warn(`UDP server listening on ${this.publicIp}:${this.udpPort}`);
    });

    // Start global heartbeat check timer
    this.setupKeepAliveTimer();
  }

  connectToEmqxBroker() {
    const brokerConfig = configManager.get("mqtt_broker");
    if (!brokerConfig) {
      console.error("MQTT broker configuration not found in config");
      process.exit(1);
    }

    const clientId = `mqtt-gateway-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const brokerUrl = `${brokerConfig.protocol}://${brokerConfig.host}:${brokerConfig.port}`;

    console.log(`Connecting to EMQX broker: ${brokerUrl}`);

    this.mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId,
      keepalive: brokerConfig.keepalive || 60,
      clean: brokerConfig.clean !== false,
      reconnectPeriod: brokerConfig.reconnectPeriod || 1000,
      connectTimeout: brokerConfig.connectTimeout || 30000
    });

    this.mqttClient.on('connect', () => {
      console.log(`✅ Connected to EMQX broker: ${brokerUrl}`);
      // Subscribe to gateway control topics
      this.mqttClient.subscribe('devices/+/hello', (err) => {
        if (err) {
          console.error('Failed to subscribe to device hello topic:', err);
        } else {
          console.log('📡 Subscribed to devices/+/hello');
        }
      });
      this.mqttClient.subscribe('devices/+/data', (err) => {
        if (err) {
          console.error('Failed to subscribe to device data topic:', err);
        } else {
          console.log('📡 Subscribed to devices/+/data');
        }
      });
      // Subscribe to the internal topic where EMQX republishes with client info
      this.mqttClient.subscribe('internal/server-ingest', (err) => {
        if (err) {
          console.error('Failed to subscribe to internal/server-ingest topic:', err);
        } else {
          console.log('📡 Subscribed to internal/server-ingest');
        }
      });
    });

    this.mqttClient.on('error', (err) => {
      console.error('MQTT connection error:', err);
    });

    this.mqttClient.on('offline', () => {
      console.warn('MQTT client went offline');
    });

    this.mqttClient.on('reconnect', () => {
      console.log('MQTT client reconnecting...');
    });

    this.mqttClient.on('message', (topic, message) => {
      this.handleMqttMessage(topic, message);
    });
  }

  async handleMqttMessage(topic, message) {
    // Add detailed logging for all incoming MQTT messages
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📨 [MQTT IN] *** NEW MESSAGE RECEIVED ***`);
    console.log(`📨 [MQTT IN] Topic: ${topic}`);
    console.log(`📨 [MQTT IN] Message length: ${message.length} bytes`);
    console.log(`📨 [MQTT IN] Raw message: ${message.toString()}`);

    try {
      const payload = JSON.parse(message.toString());
      const topicParts = topic.split('/');

      console.log(`📨 [MQTT IN] Parsed payload:`, JSON.stringify(payload, null, 2));
      console.log(`📨 [MQTT IN] Topic parts:`, topicParts);
      console.log(`${'='.repeat(80)}\n`);

      if (topic === 'internal/server-ingest') {
        // Handle messages republished by EMQX with client ID info
        console.log(`📨 [MQTT IN] Message from internal/server-ingest topic`);

        // Extract client ID and original payload from EMQX republish rule
        const clientId = payload.sender_client_id;
        const originalPayload = payload.orginal_payload;

        if (!clientId || !originalPayload) {
          console.error(`❌ [MQTT IN] Invalid republished message format - missing clientId or originalPayload`);
          return;
        }

        console.log(`📨 [MQTT IN] Client ID: ${clientId}`);
        console.log(`📨 [MQTT IN] Original payload:`, JSON.stringify(originalPayload, null, 2));

        // Extract device MAC from client ID
        let deviceId = 'unknown-device';
        const parts = clientId.split('@@@');
        if (parts.length >= 2) {
          deviceId = parts[1].replace(/_/g, ':'); // Convert MAC format
        }

        console.log(`📨 [MQTT IN] Device message from internal/server-ingest - Device: ${deviceId}, Message type: ${originalPayload.type}`);

        // Create enhanced payload with client connection info for VirtualMQTTConnection
        const enhancedPayload = {
          ...originalPayload,
          clientId: clientId,
          username: 'extracted_from_emqx',
          password: 'extracted_from_emqx'
        };

        // Handle MCP responses - forward to LiveKit agent
        if (originalPayload.type === 'mcp' && originalPayload.payload && originalPayload.payload.result) {
          console.log(`🔋 [MCP-RESPONSE] Processing MCP response from device ${deviceId}`);

          // Find the device connection
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection) {
            const requestId = `req_${originalPayload.payload.id}`;

            // Use the connection's method to forward the response
            await deviceInfo.connection.forwardMcpResponse(
              originalPayload.payload,
              originalPayload.session_id,
              requestId
            );
          } else {
            console.warn(`⚠️ [MCP-RESPONSE] No connection found for device ${deviceId}, cannot forward response`);
          }
        }

        if (originalPayload.type === 'hello') {
          console.log(`👋 [HELLO] Processing hello message from internal/server-ingest: ${deviceId}`);
          this.handleDeviceHello(deviceId, enhancedPayload);
        } else if (originalPayload.type === 'mode-change') {
          console.log(`🔘 [MODE-CHANGE] Processing mode change from internal/server-ingest: ${deviceId}`);
          this.handleDeviceModeChange(deviceId, enhancedPayload);
        } else if (originalPayload.type === 'abort') {
          // Special handling for abort messages - send to BOTH real and virtual devices
          console.log(`🛑 [ABORT] Processing abort message from internal/server-ingest: ${deviceId}`);

          let abortSent = false;

          // Send abort to real ESP32 connection if exists
          const realConnection = this.findRealDeviceConnection(deviceId);
          if (realConnection) {
            console.log(`🛑 [ABORT] Routing abort to real ESP32 device: ${deviceId}`);
            realConnection.handlePublish({ payload: JSON.stringify(originalPayload) });
            abortSent = true;
          }

          // ALSO send abort to virtual device connection if exists
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection) {
            console.log(`🛑 [ABORT] Routing abort to virtual device (LiveKit): ${deviceId}`);
            // Forward abort to the virtual device's handlePublish
            deviceInfo.connection.handlePublish({ payload: JSON.stringify(originalPayload) });
            abortSent = true;
          }

          if (!abortSent) {
            console.log(`⚠️ [ABORT] No connections found for device: ${deviceId}, abort cannot be processed`);
          }
        } else if (originalPayload.type === 'start_greeting') {
          // start_greeting message = ONLY enable PTT (call start_turn RPC)
          console.log(`🎤 [START-GREETING] Processing start_greeting - enabling PTT for device: ${deviceId}`);

          // Check for virtual device connection
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection && deviceInfo.connection.bridge) {
            const bridge = deviceInfo.connection.bridge;

            try {
              // Find the agent participant
              const participants = Array.from(bridge.room.remoteParticipants.values());
              const agentParticipant = participants.find(p => p.identity.includes('agent'));

              if (agentParticipant) {
                console.log(`🎤 [START-GREETING] Agent participant found, calling start_turn RPC...`);

                const result = await bridge.room.localParticipant.performRpc({
                  destinationIdentity: agentParticipant.identity,
                  method: "start_turn",
                  payload: ""
                });

                console.log(`✅ [START-GREETING] PTT enabled: ${result}`);
              } else {
                console.error(`❌ [START-GREETING] No agent participant found in room`);
              }
            } catch (pttError) {
              console.error(`❌ [START-GREETING] Failed to enable PTT:`, pttError);
            }
          } else {
            console.error(`❌ [START-GREETING] No bridge found for device ${deviceId}`);
          }
        } else {
          // ALWAYS check for real ESP32 connection FIRST (prioritize over virtual)
          const realConnection = this.findRealDeviceConnection(deviceId);

          if (realConnection) {
            console.log(`🎯 [ROUTE] Routing message from mobile to existing ESP32: ${deviceId}`);
            // Route the message to the existing ESP32 connection
            realConnection.handlePublish({ payload: JSON.stringify(originalPayload) });
          } else {
            // No real ESP32 connection - check if there's a virtual connection
            const deviceInfo = this.deviceConnections.get(deviceId);

            if (deviceInfo && deviceInfo.connection) {
              console.log(`📊 [DATA] Routing to virtual device connection: ${deviceId}`);

              // Send success message to mobile app
              const successMessage = {
                type: 'device_status',
                status: 'connected',
                message: 'song is playing',
                deviceId: deviceId,
                timestamp: Date.now()
              };

              // Publish to app/p2p/{macAddress}
              const appTopic = `app/p2p/${deviceId}`;
              console.log(`✅ [MOBILE-RESPONSE] Sending device connected status to ${appTopic}`);

              if (this.mqttClient && this.mqttClient.connected) {
                this.mqttClient.publish(appTopic, JSON.stringify(successMessage), (err) => {
                  if (err) {
                    console.error(`❌ [MOBILE-RESPONSE] Failed to send success to mobile app:`, err);
                  } else {
                    console.log(`✅ [MOBILE-RESPONSE] Device connected status sent to mobile app`);
                  }
                });
              }

              this.handleDeviceData(deviceId, enhancedPayload);
            } else {
              console.log(`⚠️ [DATA] No connection found for device: ${deviceId}, message type: ${originalPayload.type}`);

              // Send device not connected message to mobile app
              const errorMessage = {
                type: 'device_status',
                status: 'not_connected',
                message: 'Device is not connected',
                deviceId: deviceId,
                timestamp: Date.now()
              };

              // Publish to app/p2p/{macAddress}
              const appTopic = `app/p2p/${deviceId}`;
              console.log(`❌ [MOBILE-RESPONSE] Sending device not connected status to ${appTopic}`);

              if (this.mqttClient && this.mqttClient.connected) {
                this.mqttClient.publish(appTopic, JSON.stringify(errorMessage), (err) => {
                  if (err) {
                    console.error(`❌ [MOBILE-RESPONSE] Failed to send error to mobile app:`, err);
                  } else {
                    console.log(`✅ [MOBILE-RESPONSE] Device not connected status sent to mobile app`);
                  }
                });
              }
            }
          }
        }
      } else if (topicParts.length >= 3 && topicParts[0] === 'devices') {
        const deviceId = topicParts[1];
        const messageType = topicParts[2];

        console.log(`📨 [MQTT IN] Device message - Device: ${deviceId}, Type: ${messageType}`);
        debug(`📨 Received MQTT message from device ${deviceId}: ${messageType}`);

        if (messageType === 'hello') {
          console.log(`👋 [HELLO] Processing hello message from device: ${deviceId}`);
          this.handleDeviceHello(deviceId, payload);
        } else if (messageType === 'data') {
          console.log(`📊 [DATA] Processing data message from device: ${deviceId}`);
          this.handleDeviceData(deviceId, payload);
        } else {
          console.log(`❓ [UNKNOWN] Unknown message type '${messageType}' from device: ${deviceId}`);
        }
      } else {
        console.log(`❓ [MQTT IN] Message on unexpected topic format: ${topic}`);
      }
    } catch (error) {
      console.error('❌ [MQTT IN] Error processing MQTT message:', error);
      console.log(`📨 [MQTT IN] Raw message:`, message.toString());
    }
  }

  handleDeviceHello(deviceId, payload) {
    console.log(`📱 [HELLO] handleDeviceHello called for device: ${deviceId}`);

    // Create a virtual connection for this device
    const connectionId = this.generateNewConnectionId();
    console.log(`📱 [HELLO] Generated connection ID: ${connectionId}`);

    const virtualConnection = new VirtualMQTTConnection(deviceId, connectionId, this, payload);
    console.log(`📱 [HELLO] Created VirtualMQTTConnection for device: ${deviceId}`);

    this.connections.set(connectionId, virtualConnection);
    this.deviceConnections.set(deviceId, { connectionId, connection: virtualConnection });

    console.log(`📱 [HELLO] Device ${deviceId} connected via EMQX`);
    console.log(`📱 [HELLO] Now calling handlePublish to process hello message...`);

    // Manually trigger the hello message processing
    try {
      virtualConnection.handlePublish({ payload: JSON.stringify(payload) });
      console.log(`📱 [HELLO] Successfully called handlePublish for device: ${deviceId}`);
    } catch (error) {
      console.error(`❌ [HELLO] Error in handlePublish for device ${deviceId}:`, error);
    }
  }

  findRealDeviceConnection(deviceId) {
    // Find device connection (all devices now use VirtualMQTTConnection)
    const deviceInfo = this.deviceConnections.get(deviceId);
    if (deviceInfo && deviceInfo.connection) {
      console.log(`✅ [FIND-DEVICE] Found device connection for ${deviceId}`);
      return deviceInfo.connection;
    }

    console.log(`❌ [FIND-DEVICE] No device connection found for ${deviceId}`);
    return null;
  }

  handleDeviceData(deviceId, payload) {
    const deviceInfo = this.deviceConnections.get(deviceId);
    if (deviceInfo && deviceInfo.connection) {
      deviceInfo.connection.handlePublish({ payload: JSON.stringify(payload) });
    } else {
      console.warn(`📱 Received data from unknown device: ${deviceId}`);
    }
  }

  async handleDeviceModeChange(deviceId, payload) {
    try {
      console.log(`🔘 [MODE-CHANGE] Device ${deviceId} requesting mode change`);

      // Extract MAC address (remove colons for API call)
      const macAddress = deviceId.replace(/:/g, '').toLowerCase();

      // Call Manager API
      const axios = require('axios');
      const apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${macAddress}/cycle-mode`;

      console.log(`📡 [MODE-CHANGE] Calling API: ${apiUrl}`);
      const response = await axios.post(apiUrl, {}, { timeout: 5000 });

      if (response.data.code === 0 && response.data.data.success) {
        const { newModeName, oldModeName, agentId } = response.data.data;
        console.log(`✅ [MODE-CHANGE] Mode updated: ${oldModeName} → ${newModeName}`);

        // Load audio map
        const fs = require('fs');
        const path = require('path');
        const audioMapPath = path.join(__dirname, 'audio', 'mode_change', 'audio_map.json');
        const audioMap = JSON.parse(fs.readFileSync(audioMapPath, 'utf8'));

        // Get audio file for mode (use PCM extension instead of Opus)
        const audioFileName = audioMap.modes[newModeName] || audioMap.default;
        const pcmFileName = audioFileName.replace('.opus', '.pcm');
        const audioFilePath = path.join(__dirname, 'audio', 'mode_change', pcmFileName);

        if (!fs.existsSync(audioFilePath)) {
          console.error(`❌ [MODE-CHANGE] Audio file not found: ${audioFilePath}`);
          return;
        }

        console.log(`🎵 [MODE-CHANGE] Streaming audio: ${pcmFileName}`);

        // Stream audio via UDP
        await this.streamAudioViaUdp(deviceId, audioFilePath, newModeName);

      } else {
        console.error(`❌ [MODE-CHANGE] API error:`, response.data);
      }

    } catch (error) {
      console.error(`❌ [MODE-CHANGE] Error:`, error.message);
    }
  }

  async streamAudioViaUdp(deviceId, audioFilePath, modeName) {
    try {
      const fs = require('fs');
      const path = require('path');
      const connection = this.deviceConnections.get(deviceId)?.connection;

      if (!connection) {
        console.error(`❌ [MODE-CHANGE] No active connection for device: ${deviceId}`);
        return;
      }

      // Get client ID for publishing MQTT messages
      const clientId = connection.clientId;
      if (!clientId) {
        console.error(`❌ [MODE-CHANGE] No client ID found for device: ${deviceId}`);
        return;
      }

      // Check if we need to convert Opus file to PCM first
      const pcmFilePath = audioFilePath.replace('.opus', '.pcm');

      if (!fs.existsSync(pcmFilePath)) {
        console.log(`⚠️ [MODE-CHANGE] PCM file not found. Please convert Opus to PCM:`);
        console.log(`   ffmpeg -i ${audioFilePath} -f s16le -ar 24000 -ac 1 ${pcmFilePath}`);
        console.error(`❌ [MODE-CHANGE] Cannot stream without PCM file`);
        return;
      }

      // Read PCM file (24kHz, mono, 16-bit signed)
      const pcmData = fs.readFileSync(pcmFilePath);
      console.log(`📦 [MODE-CHANGE] Loaded ${pcmData.length} bytes PCM from ${pcmFilePath}`);

      const controlTopic = `devices/p2p/${clientId}`;

      // Send TTS start via MQTT
      const ttsStartMsg = {
        type: 'tts',
        state: 'start',
        text: `Switched to ${modeName} mode`,
        timestamp: Date.now()
      };
      this.mqttClient.publish(controlTopic, JSON.stringify(ttsStartMsg), (err) => {
        if (err) {
          console.error(`❌ [MODE-CHANGE] Failed to publish TTS start:`, err);
        } else {
          console.log(`📤 [MODE-CHANGE] TTS start sent to ${deviceId} via ${controlTopic}`);
        }
      });

      // Wait a bit for TTS start to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Stream PCM in 60ms frames, encode to Opus, send via UDP
      // Same as LiveKit audio: 24kHz, 60ms = 1440 samples = 2880 bytes PCM
      const FRAME_SIZE_SAMPLES = 1440; // 24000 Hz * 0.06s
      const FRAME_SIZE_BYTES = FRAME_SIZE_SAMPLES * 2; // 2 bytes per sample
      let offset = 0;
      let frameCount = 0;

      // Calculate relative timestamp
      const startTime = connection.udp?.startTime || Date.now();
      let baseTimestamp = (Date.now() - startTime) & 0xffffffff;

      while (offset < pcmData.length) {
        const frameData = pcmData.slice(offset, Math.min(offset + FRAME_SIZE_BYTES, pcmData.length));

        // Pad last frame if incomplete
        let frameTosend = frameData;
        if (frameData.length < FRAME_SIZE_BYTES) {
          frameTosend = Buffer.alloc(FRAME_SIZE_BYTES);
          frameData.copy(frameTosend);
          // Rest is zeros (silence padding)
        }

        // Calculate timestamp for this frame
        const timestamp = (baseTimestamp + (frameCount * 60)) & 0xffffffff;

        // Encode to Opus (same as LiveKit audio streaming)
        if (opusEncoder) {
          try {
            const opusBuffer = opusEncoder.encode(frameTosend, FRAME_SIZE_SAMPLES);

            if (frameCount % 20 === 0) {
              console.log(`🎵 [MODE-CHANGE] Frame ${frameCount}: PCM ${frameTosend.length}B → Opus ${opusBuffer.length}B`);
            }

            // Send via UDP (will be encrypted automatically)
            connection.sendUdpMessage(opusBuffer, timestamp);
          } catch (err) {
            console.error(`❌ [MODE-CHANGE] Opus encode error:`, err.message);
            // Fallback to PCM
            connection.sendUdpMessage(frameTosend, timestamp);
          }
        } else {
          // No Opus encoder available, send PCM directly
          console.warn(`⚠️ [MODE-CHANGE] No Opus encoder, sending PCM`);
          connection.sendUdpMessage(frameTosend, timestamp);
        }

        offset += FRAME_SIZE_BYTES;
        frameCount++;

        // Wait 60ms for next frame (match frame duration)
        await new Promise(resolve => setTimeout(resolve, 60));
      }

      console.log(`📦 [MODE-CHANGE] Streamed ${frameCount} frames (${pcmData.length} bytes PCM)`);

      // Wait a bit before sending TTS stop
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send TTS stop
      const ttsStopMsg = {
        type: 'tts',
        state: 'stop',
        timestamp: Date.now()
      };
      this.mqttClient.publish(controlTopic, JSON.stringify(ttsStopMsg), (err) => {
        if (err) {
          console.error(`❌ [MODE-CHANGE] Failed to publish TTS stop:`, err);
        } else {
          console.log(`📤 [MODE-CHANGE] TTS stop sent to ${deviceId} via ${controlTopic}`);
        }
      });

      // Wait a bit to ensure TTS stop is processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Send goodbye message to close the LiveKit session after mode change
      const goodbyeMsg = {
        type: "goodbye",
        session_id: connection.udp?.session_id || null,
        reason: "mode_change",
        timestamp: Date.now()
      };

      this.mqttClient.publish(controlTopic, JSON.stringify(goodbyeMsg), (err) => {
        if (err) {
          console.error(`❌ [MODE-CHANGE] Failed to publish goodbye:`, err);
        } else {
          console.log(`👋 [MODE-CHANGE] Goodbye sent to ${deviceId} - LiveKit session will close`);
        }
      });

    } catch (error) {
      console.error(`❌ [MODE-CHANGE] Audio streaming error:`, error.message);
      console.error(error.stack);
    }
  }

  publishToDevice(clientIdOrDeviceId, message) {
  console.log(`📤 [MQTT OUT] publishToDevice called - Client/Device: ${clientIdOrDeviceId}`);
  console.log(`📤 [MQTT OUT] Message:`, JSON.stringify(message, null, 2));

  if (this.mqttClient && this.mqttClient.connected) {
    // Use the full client ID directly in the topic
    const topic = `devices/p2p/${clientIdOrDeviceId}`;
    console.log(`📤 [MQTT OUT] Publishing to topic: ${topic}`);

    this.mqttClient.publish(topic, JSON.stringify(message), (err) => {
      if (err) {
        console.error(`❌ [MQTT OUT] Failed to publish to client ${clientIdOrDeviceId}:`, err);
      } else {
        console.log(`✅ [MQTT OUT] Successfully published to client ${clientIdOrDeviceId} on topic ${topic}`);
        debug(`📤 Published to client ${clientIdOrDeviceId}: ${JSON.stringify(message)}`);
      }
    });
  } else {
    console.error('❌ [MQTT OUT] MQTT client not connected, cannot publish message');
    console.log(`📊 [MQTT OUT] Client connected: ${this.mqttClient ? this.mqttClient.connected : 'null'}`);
  }
}

  /**
   * Set up global heartbeat check timer
   */
  setupKeepAliveTimer() {
    // Clear existing timer
    this.clearKeepAliveTimer();
    this.lastConnectionCount = 0;
    this.lastActiveConnectionCount = 0;

    // Set new timer
    this.keepAliveTimer = setInterval(async () => {
      // Check heartbeat status of all connections
      for (const connection of this.connections.values()) {
        await connection.checkKeepAlive();
      }

      const activeCount = Array.from(this.connections.values()).filter(
        (connection) => connection.isAlive()
      ).length;
      if (
        activeCount !== this.lastActiveConnectionCount ||
        this.connections.size !== this.lastConnectionCount
      ) {
        // console.log(
        //   `Connections: ${this.connections.size}, Active: ${activeCount}`
        // );
        this.lastActiveConnectionCount = activeCount;
        this.lastConnectionCount = this.connections.size;
      }
    }, this.keepAliveCheckInterval);
  }

  /**
   * Clear heartbeat check timer
   */
  clearKeepAliveTimer() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  addConnection(connection) {
    // Check if a connection with the same clientId already exists
    for (const [key, value] of this.connections.entries()) {
      if (value.clientId === connection.clientId) {
        debug(
          `${connection.clientId} connection already exists, closing old connection`
        );
        value.close();
      }
    }
    this.connections.set(connection.connectionId, connection);
  }

  removeConnection(connection) {
    debug(`Closing connection: ${connection.connectionId}`);
    if (this.connections.has(connection.connectionId)) {
      this.connections.delete(connection.connectionId);
    }
  }

  sendUdpMessage(message, remoteAddress) {
    this.udpServer.send(message, remoteAddress.port, remoteAddress.address);
  }

  onUdpMessage(message, rinfo) {
    // message format: [type: 1u, flag: 1u, payloadLength: 2u, cookie: 4u, timestamp: 4u, sequence: 4u, payload: n]
    if (message.length < 16) {
      //console.warn(
      //`📡 [UDP SERVER] Received incomplete UDP header from ${rinfo.address}:${rinfo.port}, length=${message.length}`
      // );
      return;
    }

    try {
      const type = message.readUInt8(0);
      if (type !== 1) {
        // console.warn(
        //   `📡 [UDP SERVER] Invalid packet type: ${type} from ${rinfo.address}:${rinfo.port}`
        // );
        return;
      }

      const payloadLength = message.readUInt16BE(2);
      if (message.length < 16 + payloadLength) {
        // console.warn(
        //   `📡 [UDP SERVER] Incomplete message from ${rinfo.address}:${rinfo.port}, expected=${16 + payloadLength}, got=${message.length}`
        // );
        return;
      }

      const connectionId = message.readUInt32BE(4);
      const connection = this.connections.get(connectionId);
      if (!connection) {
        // console.warn(`📡 [UDP SERVER] No connection found for ID: ${connectionId} from ${rinfo.address}:${rinfo.port}`);
        return;
      }

      const timestamp = message.readUInt32BE(8);
      const sequence = message.readUInt32BE(12);

      // console.log(
      //   `📡 [UDP SERVER] Routing message to connection ${connectionId} (${connection.clientId})`
      // );
      connection.onUdpMessage(
        rinfo,
        message,
        payloadLength,
        timestamp,
        sequence
      );
    } catch (error) {
      // console.error(
      //   `📡 [UDP SERVER] Message processing error from ${rinfo.address}:${rinfo.port}:`,
      //   error
      // );
    }
  }

  /**
   * Stop server
   */
  async stop() {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    // Clear heartbeat check timer
    this.clearKeepAliveTimer();

    if (this.connections.size > 0) {
      console.warn(`Waiting for ${this.connections.size} connections to close`);
      for (const connection of this.connections.values()) {
        connection.close();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    debug("Waiting for connections to close");
    this.connections.clear();
    this.deviceConnections.clear();

    if (this.udpServer) {
      this.udpServer.close();
      this.udpServer = null;
      console.warn("UDP server stopped");
    }

    // Close MQTT client
    if (this.mqttClient) {
      this.mqttClient.end();
      this.mqttClient = null;
      console.warn("MQTT client disconnected");
    }

    process.exit(0);
  }
}

// Create and start gateway
const gateway = new MQTTGateway();
gateway.start();

// Handle unhandled errors from LiveKit SDK
process.on("uncaughtException", (error) => {
  if (error.message && error.message.includes("InvalidState - failed to capture frame")) {
    console.warn(`⚠️ [GLOBAL] Caught InvalidState error (non-fatal), continuing operation...`);
    console.warn(`💡 [INFO] This occurs when audio frames arrive during room disconnect - now handled gracefully`);
    // Don't exit - the error is non-fatal and now prevented by room connection checks
  } else {
    console.error(`❌ [FATAL] Uncaught exception:`, error);
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(`❌ [FATAL] Unhandled rejection at:`, promise, `reason:`, reason);
});

process.on("SIGINT", () => {
  console.warn("Received SIGINT signal, starting shutdown");
  gateway.stop();
});
