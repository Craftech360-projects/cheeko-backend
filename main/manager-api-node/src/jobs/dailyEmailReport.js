/**
 * Daily Email Report Cron Job
 *
 * Schedules and executes daily email report generation and sending.
 * Default schedule: 8 AM in the configured timezone.
 *
 * Usage:
 * - Import and call startEmailReportCron() when the server starts
 * - The cron job will check the database config for schedule and recipients
 * - Reports are generated for the previous day's data
 *
 * Note: Requires node-cron package to be installed
 */

const logger = require('../utils/logger');

let cronJob = null;
let isRunning = false;

/**
 * Start the email report cron job
 * @param {Object} options - Configuration options
 * @param {number} options.defaultHour - Default hour to run (0-23), default 8
 * @param {string} options.timezone - Timezone for scheduling, default 'Asia/Kolkata'
 */
const startEmailReportCron = async (options = {}) => {
  // Check if node-cron is available
  let cron;
  try {
    cron = require('node-cron');
  } catch (error) {
    logger.warn('node-cron not installed. Daily email reports will not be scheduled automatically.');
    logger.info('Install with: npm install node-cron');
    logger.info('Email reports can still be sent manually via the API.');
    return;
  }

  const { defaultHour = 8, timezone = 'Asia/Kolkata' } = options;

  // Stop existing job if any
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  try {
    // Get configuration from database
    const emailReportService = require('../services/emailReport.service');
    const config = await emailReportService.getConfig();

    if (!config.enabled) {
      logger.info('Daily email reports are disabled in configuration');
      return;
    }

    const hour = config.scheduleHour ?? defaultHour;
    const tz = config.scheduleTimezone || timezone;

    // Cron expression: "0 <hour> * * *" = At minute 0 of the specified hour, every day
    const cronExpression = `0 ${hour} * * *`;

    logger.info(`Scheduling daily email report at ${hour}:00 ${tz}`);

    cronJob = cron.schedule(cronExpression, async () => {
      if (isRunning) {
        logger.warn('Daily email report is already running, skipping this execution');
        return;
      }

      isRunning = true;
      logger.info('Starting daily email report generation...');

      try {
        const result = await emailReportService.generateAndSendDailyReport();
        if (result.success) {
          logger.info('Daily email report sent successfully');
        } else {
          logger.warn('Daily email report not sent:', result.message);
        }
      } catch (error) {
        logger.error('Failed to generate/send daily email report:', error);
      } finally {
        isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: tz
    });

    logger.info('Daily email report cron job started');

  } catch (error) {
    logger.error('Failed to start email report cron job:', error);
  }
};

/**
 * Stop the email report cron job
 */
const stopEmailReportCron = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Daily email report cron job stopped');
  }
};

/**
 * Restart the cron job with updated configuration
 * Call this after config changes to apply new schedule
 */
const restartEmailReportCron = async () => {
  stopEmailReportCron();
  await startEmailReportCron();
};

/**
 * Check if cron job is currently running
 * @returns {boolean}
 */
const isCronRunning = () => {
  return cronJob !== null;
};

/**
 * Get cron job status
 * @returns {Object} Status info
 */
const getCronStatus = async () => {
  try {
    const emailReportService = require('../services/emailReport.service');
    const config = await emailReportService.getConfig();

    return {
      scheduled: cronJob !== null,
      enabled: config.enabled,
      scheduleHour: config.scheduleHour,
      scheduleTimezone: config.scheduleTimezone,
      recipients: config.recipients?.length || 0,
      isExecuting: isRunning
    };
  } catch (error) {
    return {
      scheduled: cronJob !== null,
      enabled: false,
      error: error.message
    };
  }
};

module.exports = {
  startEmailReportCron,
  stopEmailReportCron,
  restartEmailReportCron,
  isCronRunning,
  getCronStatus
};
