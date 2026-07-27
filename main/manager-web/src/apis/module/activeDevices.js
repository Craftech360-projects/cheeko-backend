import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get devices active on a given IST date (RFID tap or voice session)
    getActiveDevices(date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/active-devices`)
            .method('GET')
            .data({ date })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getActiveDevices(date, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get per-device RFID tap breakdown for a given IST date
    getDeviceRfid(mac, date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/active-devices/${mac}/rfid`)
            .method('GET')
            .data({ date })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceRfid(mac, date, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get date-scoped chat history for a device
    getDeviceChat(mac, date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/active-devices/${mac}/chat`)
            .method('GET')
            .data({ date })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceChat(mac, date, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get date-scoped game plays for a device
    getDeviceGames(mac, date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/active-devices/${mac}/games`)
            .method('GET')
            .data({ date })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceGames(mac, date, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get date-scoped radio plays for a device
    getDeviceRadio(mac, date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/analytics/active-devices/${mac}/radio`)
            .method('GET')
            .data({ date })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceRadio(mac, date, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Get AI-generated images for a device, optionally scoped to an IST date
    getDeviceImages(mac, date, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/imagine/device/${mac}/images`)
            .method('GET')
            .data(date ? { date } : {})
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceImages(mac, date, callback, errorCallback);
                    });
                }
            }).send();
    }
}
