/**
 * Worker Pool Manager
 * 
 * Manages a pool of worker threads for parallel audio processing.
 * Implements dynamic auto-scaling (4-8 workers) based on load.
 * Uses least-loaded selection for load balancing.
 */

const { Worker } = require("worker_threads");
const path = require("path");
const { PerformanceMonitor } = require("./performance-monitor");

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
        this.minWorkers = 4; // Minimum workers (always keep at least 4)
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
            this.workerCount = this.minWorkers;
        }

        this.startAutoScaling();
    }

    initializeWorkers() {
        const workerPath = path.join(__dirname, "../audio-worker.js");

        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(workerPath);

            worker.on("message", this.handleWorkerMessage.bind(this));
            worker.on("error", (error) => {
                console.error(`❌ [WORKER-${i}] Error:`, error);
                this.restartWorker(i);
            });
            worker.on("exit", (code) => {
                if (code !== 0) {
                    console.error(`❌ [WORKER-${i}] Exited with code ${code}, restarting...`);
                    this.restartWorker(i);
                }
            });

            this.workers.push({ worker, id: i, active: true });
            this.workerPendingCount.push(0);
        }

        // console.log(`✅ [WORKER-POOL] Created pool with ${this.workerCount} workers`);
    }

    restartWorker(index) {
        const workerPath = path.join(__dirname, "../audio-worker.js");

        if (this.workers[index]) {
            try {
                this.workers[index].worker.terminate();
            } catch (e) {
                // Ignore termination errors
            }

            const newWorker = new Worker(workerPath);
            newWorker.on("message", this.handleWorkerMessage.bind(this));
            newWorker.on("error", (error) => {
                console.error(`❌ [WORKER-${index}] Error:`, error);
            });

            this.workers[index] = { worker: newWorker, id: index, active: true };
            // console.log(`🔄 [WORKER-POOL] Worker ${index} restarted`);
        }
    }

    async initializeWorker(type, params) {
        // Initialize encoder/decoder in all workers
        // Use longer timeout for initialization (500ms instead of 50ms)
        const promises = this.workers.map((w) => {
            return this.sendMessage(
                w.worker,
                {
                    type: type,
                    data: params,
                },
                500
            ); // 500ms timeout for init
        });

        await Promise.all(promises);
    }

    async encodeOpus(pcmData, frameSize) {
        const { worker, index } = this.getNextWorker();
        const startTime = process.hrtime.bigint();

        // Track pending request count
        this.workerPendingCount[index]++;

        try {
            const result = await this.sendMessage(
                worker,
                {
                    type: "encode",
                    data: { pcmData, frameSize },
                },
                150
            ); // 150ms timeout (increased from 50ms to handle load spikes)

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
            const result = await this.sendMessage(
                worker,
                {
                    type: "decode",
                    data: { opusData },
                },
                150
            ); // 150ms timeout (increased from 50ms to handle load spikes)

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
                    reject(
                        new Error(
                            `Worker request ${requestId} timeout after ${timeoutMs}ms`
                        )
                    );
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
            activeWorkers: this.workers.filter((w) => w.active).length,
            pendingRequests: this.pendingRequests.size,
            performance: this.performanceMonitor.getStats(),
        };
    }

    /**
     * Get detailed stats including CPU and memory
     */
    getDetailedStats() {
        return {
            workers: this.workers.length,
            activeWorkers: this.workers.filter((w) => w.active).length,
            pendingRequests: this.pendingRequests.size,
            performance: this.performanceMonitor.getDetailedStats(),
        };
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

        // console.log(`🔄 [AUTO-SCALE] Starting dynamic scaling (${this.minWorkers}-${this.maxWorkers} workers)`);

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
            // console.log("🛑 [AUTO-SCALE] Stopped dynamic scaling");
        }
    }

    /**
     * Check current load and scale workers if needed
     */
    checkAndScale() {
        const currentWorkerCount = this.workers.length;
        const timeSinceLastScale = Date.now() - this.lastScaleAction;

        // Get current load metrics
        const avgPendingPerWorker =
            this.workerPendingCount.reduce((a, b) => a + b, 0) / currentWorkerCount;
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
            (loadRatio > this.scaleUpThreshold || // Workers are overloaded
                avgCpu > this.scaleUpCpuThreshold || // CPU is high
                maxLatency > 50 || // Latency is getting bad
                totalPending > currentWorkerCount * 3); // Queue is building up

        // SCALE DOWN CONDITIONS
        const shouldScaleDown =
            currentWorkerCount > this.minWorkers &&
            timeSinceLastScale >= this.scaleDownCooldown &&
            loadRatio < this.scaleDownThreshold && // Workers are underutilized
            avgCpu < 30 && // CPU is low
            maxLatency < 10 && // Latency is excellent
            totalPending === 0; // No queue buildup

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

        // console.log(`📈 [AUTO-SCALE] Scaling UP: ${currentCount} → ${targetCount} workers`);

        const workerPath = path.join(__dirname, "../audio-worker.js");

        for (let i = 0; i < workersToAdd; i++) {
            const workerId = this.workers.length;
            const worker = new Worker(workerPath);

            worker.on("message", this.handleWorkerMessage.bind(this));
            worker.on("error", (error) => {
                console.error(`❌ [WORKER-${workerId}] Error:`, error);
                this.restartWorker(workerId);
            });
            worker.on("exit", (code) => {
                if (code !== 0) {
                    console.error(`❌ [WORKER-${workerId}] Exited with code ${code}, restarting...`);
                    this.restartWorker(workerId);
                }
            });

            this.workers.push({ worker, id: workerId, active: true });
            this.workerPendingCount.push(0);
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

        // console.log(`📉 [AUTO-SCALE] Scaling DOWN: ${currentCount} → ${targetCount} workers`);

        // Remove workers from the end (newest first)
        for (let i = 0; i < workersToRemove; i++) {
            const workerIndex = this.workers.length - 1;
            const workerInfo = this.workers[workerIndex];

            // Wait for any pending operations on this worker
            const maxWaitTime = 5000;
            const startWait = Date.now();

            while (this.workerPendingCount[workerIndex] > 0 && Date.now() - startWait < maxWaitTime) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            // Terminate worker
            try {
                await workerInfo.worker.terminate();
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
            await Promise.all(
                workersToInit.map((w) =>
                    this.sendMessage(w.worker, { type: "init_encoder", data: { sampleRate: 24000, channels: 1 } }, 500)
                )
            );

            await Promise.all(
                workersToInit.map((w) =>
                    this.sendMessage(w.worker, { type: "init_decoder", data: { sampleRate: 16000, channels: 1 } }, 500)
                )
            );

            // console.log(`✅ [AUTO-SCALE] New workers initialized (${startIndex}-${endIndex - 1})`);
        } catch (error) {
            console.error(`❌ [AUTO-SCALE] Failed to initialize new workers:`, error);
        }
    }

    // ========================================
    // END DYNAMIC SCALING METHODS
    // ========================================

    async terminate() {
        // console.log("🛑 [WORKER-POOL] Terminating all workers...");

        // Stop auto-scaling
        this.stopAutoScaling();

        // Stop performance monitor
        this.performanceMonitor.stop();

        // Terminate all workers
        await Promise.all(this.workers.map((w) => w.worker.terminate()));
        this.workers = [];
    }
}

module.exports = {
    WorkerPoolManager,
};
