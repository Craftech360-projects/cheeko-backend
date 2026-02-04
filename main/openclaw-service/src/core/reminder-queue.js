/**
 * Reminder Queue Manager
 * Handles persistent reminders with retry logic and parent notifications
 */

const logger = require('../utils/logger');
const messageRouter = require('./message-router');

class ReminderQueue {
    constructor() {
        this.pendingReminders = new Map(); // deviceMac -> [reminders]
        this.deliveryAttempts = new Map(); // reminderId -> attemptCount
        this.maxRetries = 3;
        this.retryInterval = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Add reminder to queue for delivery
     * @param {Object} reminder - Reminder details
     */
    addReminder(reminder) {
        const {
            reminderId,
            deviceMac,
            text,
            scheduledTime,
            priority = 'medium',
        } = reminder;

        // Initialize queue for device if not exists
        if (!this.pendingReminders.has(deviceMac)) {
            this.pendingReminders.set(deviceMac, []);
        }

        // Add to queue
        this.pendingReminders.get(deviceMac).push({
            reminderId,
            text,
            scheduledTime,
            priority,
            addedAt: new Date().toISOString(),
            status: 'pending',
        });

        // Initialize attempt counter
        this.deliveryAttempts.set(reminderId, 0);

        logger.info(`[REMINDER-QUEUE] Added reminder ${reminderId} for ${deviceMac}`);

        // Try immediate delivery
        this.attemptDelivery(deviceMac, reminderId);
    }

    /**
     * Attempt to deliver reminder to device
     * @param {string} deviceMac - Device MAC address
     * @param {string} reminderId - Reminder ID
     */
    async attemptDelivery(deviceMac, reminderId) {
        const queue = this.pendingReminders.get(deviceMac);
        if (!queue) return;

        const reminder = queue.find(r => r.reminderId === reminderId);
        if (!reminder) return;

        const attempts = this.deliveryAttempts.get(reminderId) || 0;

        try {
            logger.info(`[REMINDER-QUEUE] Attempting delivery ${attempts + 1}/${this.maxRetries} for ${reminderId}`);

            // Check if device is online (via MQTT or LiveKit)
            const isOnline = await this.checkDeviceOnline(deviceMac);

            if (isOnline) {
                // Send reminder to device
                await this.sendToDevice(deviceMac, reminder.text);

                // Mark as delivered
                reminder.status = 'delivered';
                reminder.deliveredAt = new Date().toISOString();

                logger.info(`[REMINDER-QUEUE] ✅ Reminder ${reminderId} delivered successfully`);

                // Remove from queue
                this.removeReminder(deviceMac, reminderId);
                return true;
            } else {
                // Device offline - increment attempts
                this.deliveryAttempts.set(reminderId, attempts + 1);

                if (attempts + 1 >= this.maxRetries) {
                    // Max retries reached - notify parent via WhatsApp
                    logger.warn(`[REMINDER-QUEUE] Max retries reached for ${reminderId}, notifying parent`);
                    await this.notifyParent(deviceMac, reminder);

                    // Mark as failed
                    reminder.status = 'failed_notified_parent';
                    this.removeReminder(deviceMac, reminderId);
                } else {
                    // Schedule retry
                    setTimeout(() => {
                        this.attemptDelivery(deviceMac, reminderId);
                    }, this.retryInterval);

                    logger.info(`[REMINDER-QUEUE] Device offline, will retry in ${this.retryInterval / 1000}s`);
                }
            }
        } catch (error) {
            logger.error(`[REMINDER-QUEUE] Error delivering reminder ${reminderId}:`, error);

            // Increment attempts
            this.deliveryAttempts.set(reminderId, attempts + 1);

            if (attempts + 1 < this.maxRetries) {
                // Retry
                setTimeout(() => {
                    this.attemptDelivery(deviceMac, reminderId);
                }, this.retryInterval);
            }
        }
    }

    /**
     * Check if device is online
     * @param {string} deviceMac - Device MAC address
     * @returns {boolean} - Online status
     */
    async checkDeviceOnline(deviceMac) {
        // TODO: Integrate with MQTT gateway or LiveKit to check device status
        // For now, return false to simulate offline device

        // This should check:
        // 1. MQTT connection status
        // 2. LiveKit room participation
        // 3. Last heartbeat timestamp

        return false; // Placeholder
    }

    /**
     * Send reminder to device
     * @param {string} deviceMac - Device MAC address
     * @param {string} text - Reminder text
     */
    async sendToDevice(deviceMac, text) {
        // TODO: Send via MQTT to device
        // The device will play the reminder audio

        logger.info(`[REMINDER-QUEUE] 🔔 Sending to device ${deviceMac}: ${text}`);

        // Placeholder - will be implemented with MQTT integration
    }

    /**
     * Notify parent via WhatsApp when device is offline
     * @param {string} deviceMac - Device MAC address
     * @param {Object} reminder - Reminder details
     */
    async notifyParent(deviceMac, reminder) {
        try {
            const message = `⚠️ Reminder Alert\n\nYour child's device was offline and missed this reminder:\n\n"${reminder.text}"\n\nScheduled for: ${new Date(reminder.scheduledTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

            // Send via message router (will look up parent contact)
            await messageRouter.sendToParent(deviceMac, message);

            logger.info(`[REMINDER-QUEUE] ✅ Parent notified for missed reminder ${reminder.reminderId}`);
        } catch (error) {
            logger.error(`[REMINDER-QUEUE] Failed to notify parent:`, error);
        }
    }

    /**
     * Remove reminder from queue
     * @param {string} deviceMac - Device MAC address
     * @param {string} reminderId - Reminder ID
     */
    removeReminder(deviceMac, reminderId) {
        const queue = this.pendingReminders.get(deviceMac);
        if (!queue) return;

        const index = queue.findIndex(r => r.reminderId === reminderId);
        if (index !== -1) {
            queue.splice(index, 1);
        }

        this.deliveryAttempts.delete(reminderId);

        logger.info(`[REMINDER-QUEUE] Removed reminder ${reminderId} from queue`);
    }

    /**
     * Get pending reminders for a device
     * @param {string} deviceMac - Device MAC address
     * @returns {Array} - Pending reminders
     */
    getPendingReminders(deviceMac) {
        return this.pendingReminders.get(deviceMac) || [];
    }

    /**
     * Device came online - deliver all pending reminders
     * @param {string} deviceMac - Device MAC address
     */
    async onDeviceOnline(deviceMac) {
        logger.info(`[REMINDER-QUEUE] Device ${deviceMac} came online, delivering pending reminders`);

        const queue = this.pendingReminders.get(deviceMac);
        if (!queue || queue.length === 0) {
            logger.info(`[REMINDER-QUEUE] No pending reminders for ${deviceMac}`);
            return;
        }

        // Deliver all pending reminders
        for (const reminder of queue) {
            if (reminder.status === 'pending') {
                await this.attemptDelivery(deviceMac, reminder.reminderId);
            }
        }
    }
}

module.exports = new ReminderQueue();
