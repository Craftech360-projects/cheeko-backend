import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

// Subscription admin (SUB-11): search / comp / trial re-grant / audit / metrics.
export default {
    searchSubscriptions(q, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/search?q=${encodeURIComponent(q)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Subscription search failed:', err)
                RequestService.reAjaxFun(() => {
                    this.searchSubscriptions(q, callback)
                })
            }).send()
    },
    compExtend(mac, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/comp`)
            .method('POST')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Comp/extend failed:', err)
                RequestService.reAjaxFun(() => {
                    this.compExtend(mac, payload, callback)
                })
            }).send()
    },
    regrantTrial(mac, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/regrant-trial`)
            .method('POST')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Trial re-grant failed:', err)
                RequestService.reAjaxFun(() => {
                    this.regrantTrial(mac, payload, callback)
                })
            }).send()
    },
    getAuditLog(params, callback) {
        const query = new URLSearchParams(params).toString()
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/audit?${query}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Audit log fetch failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getAuditLog(params, callback)
                })
            }).send()
    },
    getMetrics(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/metrics`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Metrics fetch failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getMetrics(callback)
                })
            }).send()
    },
}
