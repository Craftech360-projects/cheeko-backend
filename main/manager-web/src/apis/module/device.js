import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Bound devices
    getAgentBindDevices(agentId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/bind/${agentId}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get device list:', err);
                RequestService.reAjaxFun(() => {
                    this.getAgentBindDevices(agentId, callback);
                });
            }).send();
    },
    // Unbind device
    unbindDevice(device_id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/unbind`)
            .method('POST')
            .data({ deviceId: device_id })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to unbind device:', err);
                RequestService.reAjaxFun(() => {
                    this.unbindDevice(device_id, callback);
                });
            }).send();
    },
    // Bind device
    bindDevice(agentId, deviceCode, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/bind/${agentId}/${deviceCode}`)
            .method('POST')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to bind device:', err);
                RequestService.reAjaxFun(() => {
                    this.bindDevice(agentId, deviceCode, callback);
                });
            }).send();
    },
    updateDeviceInfo(id, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/update/${id}`)
            .method('PUT')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update OTA status:', err)
                this.$message.error(err.msg || 'Failed to update OTA status')
                RequestService.reAjaxFun(() => {
                    this.updateDeviceInfo(id, payload, callback)
                })
            }).send()
    },
    // Manual add device
    manualAddDevice(params, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/manual-add`)
            .method('POST')
            .data(params)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to manually add device:', err);
                RequestService.reAjaxFun(() => {
                    this.manualAddDevice(params, callback);
                });
            }).send();
    },
    // Get device by MAC address
    getDeviceByMac(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get device:', err);
                RequestService.reAjaxFun(() => {
                    this.getDeviceByMac(macAddress, callback);
                });
            }).send();
    },
    // Get device current mode
    getDeviceMode(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/mode`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get device mode:', err);
                // Don't retry for mode - just fail silently
                callback({ data: { code: -1, data: { mode: 'idle' } } });
            }).send();
    },

    // Get device music playlist
    getMusicPlaylist(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/music`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get music playlist:', err);
                callback({ data: { code: -1, data: [] } });
            }).send();
    },

    // Get device story playlist
    getStoryPlaylist(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/story`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get story playlist:', err);
                callback({ data: { code: -1, data: [] } });
            }).send();
    },

    // Remove item from music playlist
    removeFromMusicPlaylist(macAddress, contentId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/music/${contentId}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to remove from music playlist:', err);
                callback({ data: { code: -1, msg: 'Network error' } });
            }).send();
    },

    // Remove item from story playlist
    removeFromStoryPlaylist(macAddress, contentId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/story/${contentId}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to remove from story playlist:', err);
                callback({ data: { code: -1, msg: 'Network error' } });
            }).send();
    },

    // Clear music playlist
    clearMusicPlaylist(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/music/clear`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to clear music playlist:', err);
                callback({ data: { code: -1, msg: 'Network error' } });
            }).send();
    },

    // Clear story playlist
    clearStoryPlaylist(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/device/${encodeURIComponent(macAddress)}/playlist/story/clear`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to clear story playlist:', err);
                callback({ data: { code: -1, msg: 'Network error' } });
            }).send();
    },
}
