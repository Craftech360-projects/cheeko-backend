import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Paginated query for OTA firmware info
    getOtaList(params, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag`)
            .method('GET')
            .data(params)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get OTA firmware list:', err);
                RequestService.reAjaxFun(() => {
                    this.getOtaList(params, callback);
                });
            }).send();
    },
    // Get single OTA firmware info
    getOtaInfo(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get OTA firmware info:', err);
                RequestService.reAjaxFun(() => {
                    this.getOtaInfo(id, callback);
                });
            }).send();
    },
    // Save OTA firmware info
    saveOta(entity, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag`)
            .method('POST')
            .data(entity)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to save OTA firmware info:', err);
                RequestService.reAjaxFun(() => {
                    this.saveOta(entity, callback);
                });
            }).send();
    },
    // Update OTA firmware info
    updateOta(id, entity, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/${id}`)
            .method('PUT')
            .data(entity)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to update OTA firmware info:', err);
                RequestService.reAjaxFun(() => {
                    this.updateOta(id, entity, callback);
                });
            }).send();
    },
    // Delete OTA firmware
    deleteOta(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/${id}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to delete OTA firmware:', err);
                RequestService.reAjaxFun(() => {
                    this.deleteOta(id, callback);
                });
            }).send();
    },
    // Upload firmware file
    uploadFirmware(file, callback) {
        const formData = new FormData();
        formData.append('file', file);
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/upload`)
            .method('POST')
            .data(formData)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to upload firmware file:', err);
                RequestService.reAjaxFun(() => {
                    this.uploadFirmware(file, callback);
                });
            }).send();
    },
    // Get firmware download URL
    getDownloadUrl(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/getDownloadUrl/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get download URL:', err);
                RequestService.reAjaxFun(() => {
                    this.getDownloadUrl(id, callback);
                });
            }).send();
    },
    // Set firmware force update
    setForceUpdate(id, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/otaMag/forceUpdate/${id}`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to set force update:', err);
                RequestService.reAjaxFun(() => {
                    this.setForceUpdate(id, data, callback);
                });
            }).send();
    }
}
