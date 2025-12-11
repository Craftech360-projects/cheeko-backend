import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get daily usage summary across all devices
    getDailySummary(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/analytics/daily-summary`)
            .method('GET')
            .data(params)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDailySummary(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get per-device daily usage
    getPerDeviceDailyUsage(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/analytics/per-device`)
            .method('GET')
            .data(params)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getPerDeviceDailyUsage(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get overall totals
    getOverallTotals(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/analytics/totals`)
            .method('GET')
            .data(params)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getOverallTotals(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get token usage history for a specific device
    getDeviceUsageHistory(macAddress, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/tokens/${macAddress}/history`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceUsageHistory(macAddress, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get total usage for a specific device
    getDeviceTotalUsage(macAddress, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/tokens/${macAddress}/total`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceTotalUsage(macAddress, callback, errorCallback);
                    });
                }
            }).send();
    }
}
