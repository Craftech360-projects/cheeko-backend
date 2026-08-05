import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Derived quiz state for every device: band, current level, today's count
    getDeviceProgress(callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/devices`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceProgress(callback, errorCallback);
                    });
                }
            }).send();
    },

    // Force a device onto a level. Destructive - rewrites its answer log for the band.
    // No retry: a repeated write is worse than a reported failure.
    setLevel(mac, level, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/set-level`)
            .method('POST')
            .data({ device_mac: mac, level })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // Backdate today's answers so the Daily Ten re-opens without losing progress.
    resetDay(mac, callback, errorCallback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/reset-day`)
            .method('POST')
            .data({ device_mac: mac })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    }
}
