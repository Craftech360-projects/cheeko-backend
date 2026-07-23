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
    listByStatus(status, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/list?status=${encodeURIComponent(status)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Subscription list failed:', err)
                RequestService.reAjaxFun(() => {
                    this.listByStatus(status, callback)
                })
            }).send()
    },
    getDetail(mac, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/detail`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Subscription detail failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getDetail(mac, callback)
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
    setCancel(mac, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/cancel`)
            .method('POST')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Set-cancel failed:', err)
                RequestService.reAjaxFun(() => {
                    this.setCancel(mac, payload, callback)
                })
            }).send()
    },
    setStatus(mac, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/status`)
            .method('POST')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Status override failed:', err)
                RequestService.reAjaxFun(() => {
                    this.setStatus(mac, payload, callback)
                })
            }).send()
    },
    changePlan(mac, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/${encodeURIComponent(mac)}/plan`)
            .method('POST')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Change-plan failed:', err)
                RequestService.reAjaxFun(() => {
                    this.changePlan(mac, payload, callback)
                })
            }).send()
    },
    getPlans(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/plans`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Plans fetch failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getPlans(callback)
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
    getMetrics(params, callback) {
        const query = new URLSearchParams(params).toString()
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/metrics${query ? `?${query}` : ''}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Metrics fetch failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getMetrics(params, callback)
                })
            }).send()
    },
    getGateHits(params, callback) {
        const query = new URLSearchParams(params).toString()
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/subscriptions/gate-hits?${query}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Gate-hits fetch failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getGateHits(params, callback)
                })
            }).send()
    },
}
