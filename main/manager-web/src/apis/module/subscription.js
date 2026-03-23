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
    }
}
