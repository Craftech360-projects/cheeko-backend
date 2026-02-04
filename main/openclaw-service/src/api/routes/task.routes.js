/**
 * Task Routes
 * API endpoints for managing scheduled tasks and reminders
 */

const express = require('express');
const router = express.Router();
const taskScheduler = require('../../core/task-scheduler');
const logger = require('../../utils/logger');
const Joi = require('joi');

// Validation schemas
const scheduleTaskSchema = Joi.object({
    schedule: Joi.string().required(), // Cron expression
    action: Joi.object({
        type: Joi.string().valid('speak', 'message').required(),
        text: Joi.string().required(),
        deviceMac: Joi.string().optional(),
        platform: Joi.string().valid('whatsapp', 'telegram').optional(),
        recipient: Joi.string().optional(),
    }).required(),
    metadata: Joi.object({
        title: Joi.string().optional(),
        category: Joi.string().optional(),
        priority: Joi.string().valid('low', 'medium', 'high').optional(),
    }).optional(),
});

/**
 * POST /api/task/schedule
 * Schedule a new task
 */
router.post('/schedule', async (req, res) => {
    try {
        // Validate request
        const { error, value } = scheduleTaskSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                code: 400,
                msg: error.details[0].message,
                data: null,
            });
        }

        // Schedule task
        const result = taskScheduler.scheduleTask(value);

        res.json({
            code: 0,
            msg: 'success',
            data: result,
        });
    } catch (error) {
        logger.error('[API] Error scheduling task:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to schedule task',
            data: null,
        });
    }
});

/**
 * GET /api/task/list
 * List all scheduled tasks
 */
router.get('/list', async (req, res) => {
    try {
        const tasks = taskScheduler.listTasks();

        res.json({
            code: 0,
            msg: 'success',
            data: {
                tasks,
                total: tasks.length,
            },
        });
    } catch (error) {
        logger.error('[API] Error listing tasks:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to list tasks',
            data: null,
        });
    }
});

/**
 * GET /api/task/:taskId
 * Get task details
 */
router.get('/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = taskScheduler.getTask(taskId);

        if (!task) {
            return res.status(404).json({
                code: 404,
                msg: 'Task not found',
                data: null,
            });
        }

        res.json({
            code: 0,
            msg: 'success',
            data: task,
        });
    } catch (error) {
        logger.error('[API] Error getting task:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to get task',
            data: null,
        });
    }
});

/**
 * DELETE /api/task/:taskId
 * Cancel a scheduled task
 */
router.delete('/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const success = taskScheduler.cancelTask(taskId);

        if (!success) {
            return res.status(404).json({
                code: 404,
                msg: 'Task not found',
                data: null,
            });
        }

        res.json({
            code: 0,
            msg: 'success',
            data: { taskId, cancelled: true },
        });
    } catch (error) {
        logger.error('[API] Error cancelling task:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to cancel task',
            data: null,
        });
    }
});

module.exports = router;
