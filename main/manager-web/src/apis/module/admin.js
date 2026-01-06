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
    }

}
