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
    getOverallTotals(callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/usage/analytics/totals`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getOverallTotals(callback, errorCallback);
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
    },

    // =============================================
    // Game Analytics Dashboard APIs
    // =============================================

    // Get dashboard summary (aggregate stats across all devices)
    getDashboardSummary(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/summary`)
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
                        this.getDashboardSummary(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get sessions per day for trend chart
    getSessionsPerDay(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/sessions-per-day`)
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
                        this.getSessionsPerDay(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get game accuracy by type
    getGameAccuracy(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/game-accuracy`)
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
                        this.getGameAccuracy(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get difficulty distribution
    getDifficultyDistribution(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/difficulty-distribution`)
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
                        this.getDifficultyDistribution(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get TTFT/response time trend
    getTtftTrend(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/ttft-trend`)
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
                        this.getTtftTrend(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get top active devices
    getTopDevices(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/dashboard/top-devices`)
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
                        this.getTopDevices(params, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get recent sessions (paginated)
    getRecentSessions(params, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/sessions`)
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
                        this.getRecentSessions(params, callback, errorCallback);
                    });
                }
            }).send();
    }
}
