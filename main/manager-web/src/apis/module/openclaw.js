import { getServiceUrl } from '../api'
import RequestService from '../httpRequest'

export default {
    // Get OpenClaw config
    getConfig(callback, failCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/user/openclaw-config`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .fail((err) => {
                RequestService.clearRequestTime()
                if (failCallback) failCallback(err)
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getConfig(callback, failCallback)
                })
            }).send()
    },

    // Set OpenClaw config
    setConfig(data, callback, failCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/user/openclaw-config`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .fail((err) => {
                RequestService.clearRequestTime()
                if (failCallback) failCallback(err)
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.setConfig(data, callback, failCallback)
                })
            }).send()
    },

    // Test OpenClaw connection
    testConnection(url, callback, failCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/user/openclaw-config/test`)
            .method('POST')
            .data({ url })
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .fail((err) => {
                RequestService.clearRequestTime()
                if (failCallback) failCallback(err)
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.testConnection(url, callback, failCallback)
                })
            }).send()
    },

    // Generate pairing token
    generatePairToken(callback, failCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/user/openclaw-pair/generate`)
            .method('POST')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .fail((err) => {
                RequestService.clearRequestTime()
                if (failCallback) failCallback(err)
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.generatePairToken(callback, failCallback)
                })
            }).send()
    },

    // Check pairing status
    getPairStatus(token, callback, failCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/user/openclaw-pair/status?token=${token}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .fail((err) => {
                RequestService.clearRequestTime()
                if (failCallback) failCallback(err)
            })
            .networkFail(() => {
                // Don't retry polling - just fail silently
            }).send()
    }
}
