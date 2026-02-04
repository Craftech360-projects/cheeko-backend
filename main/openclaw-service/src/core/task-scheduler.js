/**
 * Task Scheduler for OpenClaw Service
 * Handles cron-based scheduled tasks and reminders
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../config/openclaw.config');
const messageRouter = require('./message-router');

class TaskScheduler {
    constructor() {
        this.tasks = new Map(); // taskId -> { cronJob, metadata }
        this.taskCounter = 0;
        this.enabled = config.scheduler.enabled;
    }

    /**
     * Schedule a new task
     * @param {Object} taskConfig - Task configuration
     * @returns {Object} - Task details
     */
    scheduleTask(taskConfig) {
        if (!this.enabled) {
            throw new Error('Task scheduler is disabled');
        }

        const {
            schedule,      // Cron expression (e.g., "0 20 * * *" for 8 PM daily)
            action,        // { type, text, deviceMac, platform, recipient }
            metadata = {}, // { title, category, priority }
        } = taskConfig;

        // Validate cron expression
        if (!cron.validate(schedule)) {
            throw new Error(`Invalid cron expression: ${schedule}`);
        }

        // Generate task ID
        const taskId = `task_${++this.taskCounter}_${Date.now()}`;

        logger.info(`[SCHEDULER] Creating task: ${taskId}`);

        // Create cron job
        const cronJob = cron.schedule(
            schedule,
            async () => {
                await this.executeTask(taskId, action);
            },
            {
                scheduled: true,
                timezone: config.scheduler.timezone,
            }
        );

        // Store task
        this.tasks.set(taskId, {
            cronJob,
            schedule,
            action,
            metadata,
            createdAt: new Date().toISOString(),
            lastRun: null,
            nextRun: this.getNextRunTime(schedule),
        });

        logger.info(`[SCHEDULER] ✅ Task scheduled: ${taskId} - ${metadata.title || 'Untitled'}`);

        return {
            taskId,
            schedule,
            nextRun: this.getNextRunTime(schedule),
            metadata,
        };
    }

    /**
     * Execute a scheduled task
     * @param {string} taskId - Task ID
     * @param {Object} action - Action to execute
     */
    async executeTask(taskId, action) {
        try {
            logger.info(`[SCHEDULER] Executing task: ${taskId}`);

            const task = this.tasks.get(taskId);
            if (!task) {
                logger.error(`[SCHEDULER] Task not found: ${taskId}`);
                return;
            }

            // Update last run time
            task.lastRun = new Date().toISOString();
            task.nextRun = this.getNextRunTime(task.schedule);

            // Execute action based on type
            switch (action.type) {
                case 'speak':
                    // Send reminder via MQTT to device
                    await this.sendDeviceReminder(action.deviceMac, action.text);
                    break;

                case 'message':
                    // Send message via WhatsApp/Telegram
                    await messageRouter.sendMessage(
                        action.platform || 'whatsapp',
                        action.recipient,
                        action.text
                    );
                    break;

                default:
                    logger.warn(`[SCHEDULER] Unknown action type: ${action.type}`);
            }

            logger.info(`[SCHEDULER] ✅ Task executed successfully: ${taskId}`);
        } catch (error) {
            logger.error(`[SCHEDULER] Error executing task ${taskId}:`, error);
        }
    }

    /**
     * Send reminder to device via MQTT
     * @param {string} deviceMac - Device MAC address
     * @param {string} text - Reminder text
     */
    async sendDeviceReminder(deviceMac, text) {
        const mqttClient = require('./mqtt-client');

        logger.info(`[SCHEDULER] 🔔 Sending reminder to ${deviceMac}: ${text}`);

        try {
            const success = await mqttClient.sendReminder(deviceMac, text);
            if (success) {
                logger.info(`[SCHEDULER] ✅ Reminder sent successfully via MQTT`);
            } else {
                logger.warn(`[SCHEDULER] ⚠️ Failed to send reminder via MQTT`);
            }
        } catch (error) {
            logger.error(`[SCHEDULER] Error sending reminder:`, error);
        }
    }

    /**
     * Get next run time for a cron schedule
     * @param {string} schedule - Cron expression
     * @returns {string} - ISO timestamp of next run
     */
    getNextRunTime(schedule) {
        try {
            const cronJob = cron.schedule(schedule, () => { }, { scheduled: false });
            // This is a simplified version - in production, use a cron parser library
            return new Date(Date.now() + 60000).toISOString(); // Placeholder
        } catch (error) {
            return null;
        }
    }

    /**
     * Cancel a scheduled task
     * @param {string} taskId - Task ID
     * @returns {boolean} - Success status
     */
    cancelTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return false;
        }

        task.cronJob.stop();
        this.tasks.delete(taskId);

        logger.info(`[SCHEDULER] ❌ Task cancelled: ${taskId}`);
        return true;
    }

    /**
     * List all scheduled tasks
     * @returns {Array} - List of tasks
     */
    listTasks() {
        const tasks = [];
        for (const [taskId, task] of this.tasks.entries()) {
            tasks.push({
                taskId,
                schedule: task.schedule,
                metadata: task.metadata,
                createdAt: task.createdAt,
                lastRun: task.lastRun,
                nextRun: task.nextRun,
                status: task.cronJob.running ? 'running' : 'stopped',
            });
        }
        return tasks;
    }

    /**
     * Get task details
     * @param {string} taskId - Task ID
     * @returns {Object} - Task details
     */
    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }

        return {
            taskId,
            schedule: task.schedule,
            action: task.action,
            metadata: task.metadata,
            createdAt: task.createdAt,
            lastRun: task.lastRun,
            nextRun: task.nextRun,
            status: task.cronJob.running ? 'running' : 'stopped',
        };
    }

    /**
     * Shutdown scheduler
     */
    shutdown() {
        logger.info('[SCHEDULER] Shutting down...');
        for (const [taskId, task] of this.tasks.entries()) {
            task.cronJob.stop();
        }
        this.tasks.clear();
        logger.info('[SCHEDULER] ✅ Shutdown complete');
    }
}

module.exports = new TaskScheduler();
