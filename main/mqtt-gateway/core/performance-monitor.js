/**
 * Performance Monitor
 * 
 * Tracks latency, throughput, CPU, memory, and resource usage
 * for audio processing operations.
 */

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
            heapUsage: [],
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
        const cpuPercent =
            ((currentCpuUsage.user + currentCpuUsage.system) / 1000 / timeDelta) *
            100;

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
            timestamp: Date.now(),
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
        return this.metrics.cpuUsage.length > 0
            ? Math.max(...this.metrics.cpuUsage)
            : 0;
    }

    getAverageMemoryUsage() {
        const heap = this.metrics.heapUsage;
        return heap.length > 0 ? heap.reduce((a, b) => a + b) / heap.length : 0;
    }

    getMaxMemoryUsage() {
        return this.metrics.heapUsage.length > 0
            ? Math.max(...this.metrics.heapUsage)
            : 0;
    }

    getCurrentMemoryUsage() {
        return this.metrics.memoryUsage.length > 0
            ? this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1]
            : null;
    }

    getStats() {
        const runtime = Date.now() - this.metrics.startTime;
        const currentMem = this.getCurrentMemoryUsage() || {
            rss: 0,
            heapUsed: 0,
            heapTotal: 0,
        };

        return {
            // Performance metrics
            framesProcessed: this.metrics.frameCount,
            errors: this.metrics.errorCount,
            avgLatency: this.getAverageProcessingTime().toFixed(2) + "ms",
            maxLatency: this.getMaxProcessingTime().toFixed(2) + "ms",
            avgQueueSize: this.getAverageQueueSize().toFixed(1),
            runtime: (runtime / 1000).toFixed(1) + "s",
            framesPerSecond: ((this.metrics.frameCount / runtime) * 1000).toFixed(1),

            // CPU metrics
            avgCpuUsage: this.getAverageCpuUsage().toFixed(2) + "%",
            maxCpuUsage: this.getMaxCpuUsage().toFixed(2) + "%",
            currentCpuUsage:
                this.metrics.cpuUsage.length > 0
                    ? this.metrics.cpuUsage[this.metrics.cpuUsage.length - 1].toFixed(2) +
                    "%"
                    : "0%",

            // Memory metrics
            avgMemoryUsage: this.getAverageMemoryUsage().toFixed(2) + "MB",
            maxMemoryUsage: this.getMaxMemoryUsage().toFixed(2) + "MB",
            currentMemory: {
                rss: currentMem.rss.toFixed(2) + "MB",
                heapUsed: currentMem.heapUsed.toFixed(2) + "MB",
                heapTotal: currentMem.heapTotal.toFixed(2) + "MB",
            },
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
                latencySamples: this.metrics.processingTime.length,
            },
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
            heapUsage: [],
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

module.exports = {
    PerformanceMonitor,
};
