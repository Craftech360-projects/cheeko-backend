import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';


export default {
    // User list
    getUserList(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page,
            limit: params.limit,
            mobile: params.mobile
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Request failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getUserList(callback)
                })
            }).send()
    },
    // Delete user
    deleteUser(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users/${id}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Delete failed:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteUser(id, callback)
                })
            }).send()
    },
    // Get user info (by user ID) - uses user list API and filters on client side
    getUserById(userId, callback) {
        // Use existing user list API, get all users then filter on client side
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users?page=1&limit=1000`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                console.log('getUserById API response:', res);

                // Check response structure and find specified user
                if (res.data && res.data.code === 0 && res.data.data && res.data.data.list && Array.isArray(res.data.data.list)) {
                    // Find user with specified ID in user list (note: field name is userid, not id)
                    const userInfo = res.data.data.list.find(user =>
                        user.userid === userId || user.userid === parseInt(userId) || user.userid === String(userId)
                    );

                    if (userInfo) {
                        console.log('Found user info:', userInfo);
                        const formattedResponse = {
                            data: {
                                code: 0,
                                msg: 'success',
                                data: userInfo
                            }
                        };
                        callback(formattedResponse);
                    } else {
                        console.log('User not found in list, userId:', userId);
                        console.log('Available user IDs:', res.data.data.list.map(u => u.userid));
                        // User does not exist
                        const errorResponse = {
                            data: {
                                code: 1,
                                msg: 'User not found',
                                data: null
                            }
                        };
                        callback(errorResponse);
                    }
                } else {
                    console.error('Invalid response structure for getUserById:', res);
                    const errorResponse = {
                        data: {
                            code: 1,
                            msg: 'Invalid response structure',
                            data: null
                        }
                    };
                    callback(errorResponse);
                }
            })
            .networkFail((err) => {
                console.error('Failed to get user info:', err)
                RequestService.reAjaxFun(() => {
                    this.getUserById(userId, callback)
                })
            }).send()
    },
    // Reset user password
    resetUserPassword(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users/${id}`)
            .method('PUT')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to reset password:', err)
                RequestService.reAjaxFun(() => {
                    this.resetUserPassword(id, callback)
                })
            }).send()
    },
    // Get params list
    getParamsList(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page,
            limit: params.limit,
            paramCode: params.paramCode || ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/params/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get params list:', err)
                RequestService.reAjaxFun(() => {
                    this.getParamsList(params, callback)
                })
            }).send()
    },
    // Add param
    addParam(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/params`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add param:', err)
                RequestService.reAjaxFun(() => {
                    this.addParam(data, callback)
                })
            }).send()
    },
    // Update param
    updateParam(data, callback) {
        // Check if this is a WebSocket parameter that needs validation skip
        const isWebSocketParam = data.paramCode && data.paramCode === 'server.websocket';
        let url = `${getServiceUrl()}/admin/params`;

        // Add skipValidation=true for WebSocket parameters to avoid connection validation
        if (isWebSocketParam) {
            url += '?skipValidation=true';
            console.log('Detected WebSocket parameter, adding skipValidation=true to URL:', url);
        }

        RequestService.sendRequest()
            .url(url)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update param:', err)
                RequestService.reAjaxFun(() => {
                    this.updateParam(data, callback)
                })
            }).send()
    },
    // Delete param
    deleteParam(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/params/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to delete param:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteParam(ids, callback)
                })
            }).send()
    },
    // Get all devices (Admin only)
    getAllDevices(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 100,
            keywords: params.keywords || ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/all?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device list:', err)
                RequestService.reAjaxFun(() => {
                    this.getAllDevices(params, callback)
                })
            }).send()
    },
    // Get device settings sync data by MAC (Admin dashboard)
    getDeviceSettingsByMac(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/settings`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device settings:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Patch device settings by MAC (Admin dashboard)
    updateDeviceSettingsByMac(macAddress, payload, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/settings`)
            .method('PATCH')
            .data(payload)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update device settings:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get runtime state by MAC (Admin dashboard)
    getDeviceRuntimeStateByMac(macAddress, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/state`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device runtime state:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get sync events by MAC (Admin dashboard)
    getDeviceSyncEventsByMac(macAddress, params, callback) {
        const queryParams = new URLSearchParams({
            limit: params?.limit || 20
        }).toString();
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/sync-events?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device sync events:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get firmware analytics overview by MAC (Admin dashboard)
    getDeviceAnalyticsOverviewByMac(macAddress, params, callback) {
        const queryParams = new URLSearchParams({
            from: params?.from || '',
            to: params?.to || ''
        }).toString();
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/analytics/overview?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device analytics overview:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get firmware analytics timeseries by MAC (Admin dashboard)
    getDeviceAnalyticsTimeseriesByMac(macAddress, params, callback) {
        const queryParams = new URLSearchParams({
            from: params?.from || '',
            to: params?.to || ''
        }).toString();
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/analytics/timeseries?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device analytics timeseries:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get firmware analytics events by MAC (Admin dashboard)
    getDeviceAnalyticsEventsByMac(macAddress, params, callback) {
        const queryParams = new URLSearchParams({
            limit: params?.limit || 100
        }).toString();
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/analytics/events?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device analytics events:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get firmware battery trend by MAC (Admin dashboard)
    getDeviceAnalyticsBatteryByMac(macAddress, params, callback) {
        const queryParams = new URLSearchParams({
            from: params?.from || '',
            to: params?.to || ''
        }).toString();
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/device/${encodeURIComponent(macAddress)}/analytics/battery?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get device analytics battery:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },
    // Get WebSocket server list
    getWsServerList(params, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/server/server-list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get WS server list:', err)
                RequestService.reAjaxFun(() => {
                    this.getWsServerList(params, callback)
                })
            }).send();
    },
    // Send WebSocket server action command
    sendWsServerAction(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/server/emit-action`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                RequestService.reAjaxFun(() => {
                    this.sendWsServerAction(data, callback)
                })
            }).send();
    },

    // Get kid profiles for a user (Admin only)
    getUserKidProfiles(userId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users/${userId}/kids`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get kid profiles:', err)
                RequestService.reAjaxFun(() => {
                    this.getUserKidProfiles(userId, callback)
                })
            }).send();
    },

    // Create kid profile for a user (Admin only)
    createKidProfileForUser(userId, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/users/${userId}/kids`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to create kid profile:', err)
                RequestService.reAjaxFun(() => {
                    this.createKidProfileForUser(userId, data, callback)
                })
            }).send();
    },

    // Update kid profile (Admin only)
    updateKidProfile(kidId, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/kids/${kidId}`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update kid profile:', err)
                RequestService.reAjaxFun(() => {
                    this.updateKidProfile(kidId, data, callback)
                })
            }).send();
    },

    // Delete kid profile (Admin only)
    deleteKidProfile(kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/kids/${kidId}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete kid profile:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteKidProfile(kidId, callback)
                })
            }).send();
    },

    // Assign kid to device (Admin only)
    assignKidToDeviceAdmin(deviceId, kidId, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/devices/${deviceId}/kid`)
            .method('PUT')
            .data({ kidId })
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to assign kid to device:', err)
                RequestService.reAjaxFun(() => {
                    this.assignKidToDeviceAdmin(deviceId, kidId, callback)
                })
            }).send();
    },

    // Get system-wide statistics (Admin only)
    getSystemStats(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/stats/overview`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get system stats:', err)
                // Return default values on failure
                callback({
                    data: {
                        code: 0,
                        data: {
                            totalUsers: 0,
                            totalDevices: 0,
                            totalAgents: 0,
                            totalSessions: 0
                        }
                    }
                })
            }).send();
    }

}
