import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get email report configuration
    getConfig(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/config`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get email report config:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Update email report configuration
    updateConfig(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/config`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update email report config:', err)
                RequestService.reAjaxFun(() => {
                    this.updateConfig(data, callback)
                })
            }).send()
    },

    // Send test email
    sendTestEmail(recipient, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/test`)
            .method('POST')
            .data({ recipient })
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to send test email:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Get email send history
    getHistory(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 20
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/history?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get email history:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Preview report
    previewReport(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/preview`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to preview report:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Manually trigger report generation
    generateReport(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/email-reports/generate`)
            .method('POST')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to generate report:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    }
}
