import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get all game progress for a kid
    getProgress(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/game/admin/progress/${kidId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getProgress(kidId, callback);
                });
            }).send();
    },

    // Get streak info for a kid
    getStreak(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/game/admin/streak/${kidId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getStreak(kidId, callback);
                });
            }).send();
    },

    // Get all achievements for a kid
    getAchievements(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/game/admin/achievements/${kidId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getAchievements(kidId, callback);
                });
            }).send();
    },

    // Get recent session logs for a kid
    getSessions(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/game/admin/sessions/${kidId}?limit=20`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getSessions(kidId, callback);
                });
            }).send();
    }
}
