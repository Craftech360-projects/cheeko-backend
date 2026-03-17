// Import request modules
import admin from './module/admin.js'
import agent from './module/agent.js'
import analytics from './module/analytics.js'
import content from './module/content.js'
import device from './module/device.js'
import dict from './module/dict.js'
import model from './module/model.js'
import ota from './module/ota.js'
import timbre from "./module/timbre.js"
import user from './module/user.js'
import rfid from './module/rfid.js'
import profile from './module/profile.js'
import emailReport from './module/emailReport.js'
import game from './module/game.js'

/**
 * API URL
 * Development: automatically reads .env.development file
 * Production: automatically reads .env.production file
 */
const DEV_API_SERVICE = process.env.VUE_APP_API_BASE_URL

/**
 * Get API URL based on environment
 * @returns {string}
 */
export function getServiceUrl() {
    // In production, if using relative path, need to dynamically construct full URL pointing to backend port
    if (process.env.NODE_ENV === 'production' && DEV_API_SERVICE === '/toy') {
        // Get current page hostname but use backend port 8002
        const currentHost = window.location.hostname;
        const protocol = window.location.protocol;
        return `${protocol}//${currentHost}:8002/toy`;
    }
    return DEV_API_SERVICE
}

/** Request service wrapper */
export default {
    getServiceUrl,
    user,
    admin,
    agent,
    analytics,
    content,
    device,
    model,
    timbre,
    ota,
    dict,
    rfid,
    profile,
    emailReport,
    game
}
