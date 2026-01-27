import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get all kid profiles for current user
    getKidProfiles(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/mobile/kids`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getKidProfiles(callback);
                });
            }).send();
    },

    // Get kid profile by ID
    getKidById(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/mobile/kids/${kidId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.getKidById(kidId, callback);
                });
            }).send();
    },

    // Create kid profile
    createKid(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/mobile/kids/create`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.createKid(data, callback);
                });
            }).send();
    },

    // Update kid profile
    updateKid(kidId, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/mobile/kids/${kidId}`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.updateKid(kidId, data, callback);
                });
            }).send();
    },

    // Delete kid profile
    deleteKid(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/mobile/kids/${kidId}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.deleteKid(kidId, callback);
                });
            }).send();
    },

    // Assign kid to device
    assignKidToDevice(deviceId, kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/assign-kid/${deviceId}`)
            .method('PUT')
            .data({ kidId })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res.data);
            })
            .networkFail(() => {
                RequestService.reAjaxFun(() => {
                    this.assignKidToDevice(deviceId, kidId, callback);
                });
            }).send();
    }
}
