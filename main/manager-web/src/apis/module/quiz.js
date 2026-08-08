import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Derived quiz state for every device: band, current level, today's count.
    // bank picks quiz or riddle; omitted, the API serves the quiz bank, so a
    // client deployed before the API change keeps working.
    getDeviceProgress(bank, callback, errorCallback) {
        const query = bank ? `?bank=${encodeURIComponent(bank)}` : '';
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/devices${query}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
                else {
                    RequestService.reAjaxFun(() => {
                        this.getDeviceProgress(bank, callback, errorCallback);
                    });
                }
            }).send();
    },

    // Force a device onto a level. Destructive - rewrites its answer log for the band.
    // No retry: a repeated write is worse than a reported failure.
    setLevel(mac, level, bank, callback, errorCallback) {
        const data = { device_mac: mac, level };
        if (bank) data.bank = bank;
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/set-level`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    },

    // Backdate today's answers so the Daily Ten re-opens without losing progress.
    resetDay(mac, bank, callback, errorCallback) {
        const data = { device_mac: mac };
        if (bank) data.bank = bank;
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/quiz/admin/reset-day`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                if (errorCallback) errorCallback(err);
            }).send();
    }
}
