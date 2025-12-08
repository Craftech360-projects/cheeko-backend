// 引入各个模块的请求
import admin from './module/admin.js'
import agent from './module/agent.js'
import analytics from './module/analytics.js'
import device from './module/device.js'
import dict from './module/dict.js'
import model from './module/model.js'
import ota from './module/ota.js'
import timbre from "./module/timbre.js"
import user from './module/user.js'

/**
 * 接口地址
 * 开发时自动读取使用.env.development文件
 * 编译时自动读取使用.env.production文件
 */
const DEV_API_SERVICE = process.env.VUE_APP_API_BASE_URL

/**
 * 根据开发环境返回接口url
 * @returns {string}
 */
export function getServiceUrl() {
    // 在生产环境中，如果使用相对路径，需要动态构造完整URL指向后端端口
    if (process.env.NODE_ENV === 'production' && DEV_API_SERVICE === '/toy') {
        // 获取当前页面的hostname，但使用后端端口8002
        const currentHost = window.location.hostname;
        const protocol = window.location.protocol;
        return `${protocol}//${currentHost}:8002/toy`;
    }
    return DEV_API_SERVICE
}

/** request服务封装 */
export default {
    getServiceUrl,
    user,
    admin,
    agent,
    analytics,
    device,
    model,
    timbre,
    ota,
    dict
}
