import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get current quota settings
    getQuotaSettings(callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/quota-settings`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getQuotaSettings(callback, errorCallback);
                    });
                }
            }).send();
    },

    // Update quota settings
    updateQuotaSettings(data, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/quota-settings`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // List all subscription plans
    getPlans(callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/plans`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // Get user subscription status
    getUserSubscription(userId, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/user/${userId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // Subscribe user to a plan
    subscribeUser(userId, planId, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/user/${userId}/subscribe`)
            .method('POST')
            .data({ planId })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // Cancel user subscription
    cancelSubscription(userId, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/user/${userId}/cancel`)
            .method('POST')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // ========== AI Card Subscription ==========

    // Get AI card quota settings (fail mode)
    getAiCardQuotaSettings(callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-card-quota-settings`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getAiCardQuotaSettings(callback, errorCallback);
                    });
                }
            }).send();
    },

    // Update AI card quota settings
    updateAiCardQuotaSettings(data, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-card-quota-settings`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // List all AI cards with usage summary (paginated)
    getAiCardsSummary(page, limit, monthKey, callback, errorCallback) {
        const params = { page, limit };
        if (monthKey) params.monthKey = monthKey;
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-cards/summary`)
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
                        this.getAiCardsSummary(page, limit, monthKey, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get AI cards linked to users/devices (with user_id, mac_address, remaining time)
    getAiCardsLinked(page, limit, monthKey, callback, errorCallback) {
        const params = { page, limit };
        if (monthKey) params.monthKey = monthKey;
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-cards/linked`)
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
                        this.getAiCardsLinked(page, limit, monthKey, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get AI card analytics
    getAiCardAnalytics(monthKey, callback, errorCallback) {
        const params = {};
        if (monthKey) params.monthKey = monthKey;
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-card-analytics`)
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
                        this.getAiCardAnalytics(monthKey, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get single AI card status
    getAiCardStatus(rfidUid, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/ai-card-status/${rfidUid}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getAiCardStatus(rfidUid, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Recharge an AI card
    rechargeAiCard(rfidUid, amount, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/subscription/recharge/${rfidUid}`)
            .method('POST')
            .data({ amount })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    }
}
