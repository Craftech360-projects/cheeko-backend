import { Message } from 'element-ui'
import router from '../router'
import Constant from '../utils/constant'

/**
 * Check if user is logged in
 */
export function checkUserLogin(fn) {
    let token = localStorage.getItem(Constant.STORAGE_KEY.TOKEN)
    let userType = localStorage.getItem(Constant.STORAGE_KEY.USER_TYPE)
    if (isNull(token) || isNull(userType)) {
        goToPage('console', true)
        return
    }
    if (fn) {
        fn()
    }
}

/**
 * Check if value is null/empty
 * @param data
 * @returns {boolean}
 */
export function isNull(data) {
    if (data === undefined) {
        return true
    } else if (data === null) {
        return true
    } else if (typeof data === 'string' && (data.length === 0 || data === '' || data === 'undefined' || data === 'null')) {
        return true
    } else if ((data instanceof Array) && data.length === 0) {
        return true
    }
    return false
}

/**
 * Check if value is not null/empty
 * @param data
 * @returns {boolean}
 */
export function isNotNull(data) {
    return !isNull(data)
}

/**
 * Show top red notification (error)
 * @param msg
 */
export function showDanger(msg) {
    if (isNull(msg)) {
        return
    }
    Message({
        message: msg,
        type: 'error',
        showClose: true
    })
}

/**
 * Show top orange notification (warning)
 * @param msg
 */
export function showWarning(msg) {
    if (isNull(msg)) {
        return
    }
    Message({
        message: msg,
        type: 'warning',
        showClose: true
    });
}



/**
 * Show top green notification (success)
 * @param msg
 */
export function showSuccess(msg) {
    Message({
        message: msg,
        type: 'success',
        showClose: true
    })
}



/**
 * Navigate to page
 * @param path
 * @param isRepalce
 */
export function goToPage(path, isRepalce) {
    if (isRepalce) {
        router.replace(path)
    } else {
        router.push(path)
    }
}

/**
 * Get current vue page name
 * @param path
 * @param isRepalce
 */
export function getCurrentPage() {
    let hash = location.hash.replace('#', '')
    if (hash.indexOf('?') > 0) {
        hash = hash.substring(0, hash.indexOf('?'))
    }
    return hash
}

/**
 * Generate random number from [min, max]
 * @param min
 * @param max
 * @returns {number}
 */
export function randomNum(min, max) {
    return Math.round(Math.random() * (max - min) + min)
}


/**
 * Get UUID
 */
export function getUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        return (c === 'x' ? (Math.random() * 16 | 0) : ('r&0x3' | '0x8')).toString(16)
    })
}

/**
 * Validate mobile phone number format
 * @param {string} mobile Phone number
 * @param {string} areaCode Area code
 * @returns {boolean}
 */
export function validateMobile(mobile, areaCode) {
    // Remove all non-digit characters
    const cleanMobile = mobile.replace(/\D/g, '');

    // Use different validation rules based on area code
    switch (areaCode) {
        case '+86': // China Mainland
            return /^1[3-9]\d{9}$/.test(cleanMobile);
        case '+852': // Hong Kong
            return /^[569]\d{7}$/.test(cleanMobile);
        case '+853': // Macau
            return /^6\d{7}$/.test(cleanMobile);
        case '+886': // Taiwan
            return /^9\d{8}$/.test(cleanMobile);
        case '+1': // USA/Canada
            return /^[2-9]\d{9}$/.test(cleanMobile);
        case '+44': // UK
            return /^7[1-9]\d{8}$/.test(cleanMobile);
        case '+81': // Japan
            return /^[7890]\d{8}$/.test(cleanMobile);
        case '+82': // South Korea
            return /^1[0-9]\d{7}$/.test(cleanMobile);
        case '+65': // Singapore
            return /^[89]\d{7}$/.test(cleanMobile);
        case '+61': // Australia
            return /^[4578]\d{8}$/.test(cleanMobile);
        case '+49': // Germany
            return /^1[5-7]\d{8}$/.test(cleanMobile);
        case '+33': // France
            return /^[67]\d{8}$/.test(cleanMobile);
        case '+39': // Italy
            return /^3[0-9]\d{8}$/.test(cleanMobile);
        case '+34': // Spain
            return /^[6-9]\d{8}$/.test(cleanMobile);
        case '+55': // Brazil
            return /^[1-9]\d{10}$/.test(cleanMobile);
        case '+91': // India
            return /^[6-9]\d{9}$/.test(cleanMobile);
        case '+971': // UAE
            return /^[5]\d{8}$/.test(cleanMobile);
        case '+966': // Saudi Arabia
            return /^[5]\d{8}$/.test(cleanMobile);
        case '+880': // Bangladesh
            return /^1[3-9]\d{8}$/.test(cleanMobile);
        case '+234': // Nigeria
            return /^[789]\d{9}$/.test(cleanMobile);
        case '+254': // Kenya
            return /^[17]\d{8}$/.test(cleanMobile);
        case '+255': // Tanzania
            return /^[67]\d{8}$/.test(cleanMobile);
        case '+7': // Kazakhstan
            return /^[67]\d{9}$/.test(cleanMobile);
        default:
            // Other international numbers: at least 5 digits, max 15 digits
            return /^\d{5,15}$/.test(cleanMobile);
    }
}

