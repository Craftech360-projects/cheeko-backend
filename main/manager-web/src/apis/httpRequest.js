import Fly from 'flyio/dist/npm/fly';
import store from '../store/index';
import Constant from '../utils/constant';
import { goToPage, isNotNull, showDanger, showWarning } from '../utils/index';

const fly = new Fly()
// Set timeout
fly.config.timeout = 30000

/**
 * Request service wrapper
 */
export default {
    sendRequest,
    reAjaxFun,
    clearRequestTime
}

function getLatestAuthToken() {
    const storedToken = localStorage.getItem('token');
    const rawToken = storedToken || store.state.token;

    if (!rawToken) {
        return null;
    }

    if (storedToken && storedToken !== store.state.token) {
        store.commit('setToken', storedToken);
    }

    try {
        const parsed = JSON.parse(rawToken);
        if (parsed && typeof parsed === 'object' && parsed.token) {
            return parsed.token;
        }
    } catch (error) {
        // Fall back to raw token format for backward compatibility.
    }

    return rawToken;
}

function sendRequest() {
    return {
        _sucCallback: null,
        _failCallback: null,
        _networkFailCallback: null,
        _method: 'GET',
        _data: {},
        _header: { 'content-type': 'application/json; charset=utf-8' },
        _url: '',
        _responseType: undefined, // Response type field
        'send'() {
            const authToken = getLatestAuthToken();
            if (isNotNull(authToken)) {
                this._header.Authorization = 'Bearer ' + authToken
            }

            if (typeof FormData !== 'undefined' && this._data instanceof FormData) {
                delete this._header['content-type']
                delete this._header['Content-Type']
            }

            // Send request
            fly.request(this._url, this._data, {
                method: this._method,
                headers: this._header,
                responseType: this._responseType
            }).then((res) => {
                const error = httpHandlerError(res, this._failCallback, this._networkFailCallback);
                if (error) {
                    return
                }

                if (this._sucCallback) {
                    this._sucCallback(res)
                }
            }).catch((res) => {
                // Print failure response
                console.log('catch', res)
                httpHandlerError(res, this._failCallback, this._networkFailCallback)
            })
            return this
        },
        'success'(callback) {
            this._sucCallback = callback
            return this
        },
        'fail'(callback) {
            this._failCallback = callback
            return this
        },
        'networkFail'(callback) {
            this._networkFailCallback = callback
            return this
        },
        'url'(url) {
            if (url) {
                url = url.replaceAll('$', '/')
            }
            this._url = url
            return this
        },
        'data'(data) {
            this._data = data
            return this
        },
        'method'(method) {
            this._method = method
            return this
        },
        'header'(header) {
            this._header = header
            return this
        },
        'showLoading'(showLoading) {
            this._showLoading = showLoading
            return this
        },
        'async'(flag) {
            this.async = flag
        },
        // Set response type method
        'type'(responseType) {
            this._responseType = responseType;
            return this;
        }
    }
}

/**
 * Info: response info after request completes
 * failCallback: callback function
 * networkFailCallback: callback function
 */
// Add logging in error handling function
function httpHandlerError(info, failCallback, networkFailCallback) {
    const status = info?.status || info?.response?.status || 0
    const responseData = info?.data || info?.response?.data || null

    /** Request successful, exit this function. Can be adjusted based on project requirements. Here status 200 means success */
    let networkError = false
    if (status === 200) {
        if (responseData?.code === 'success' || responseData?.code === 0 || responseData?.code === undefined) {
            return networkError
        } else if (responseData?.code === 401 || responseData?.code === 403) {
            store.commit('clearAuth');
            goToPage(Constant.PAGE.LOGIN, true);
            return true
        } else {
            if (failCallback) {
                failCallback(info)
            } else {
                showDanger(responseData?.msg)
            }
            return true
        }
    }
    if (status === 401 || status === 403) {
        store.commit('clearAuth');
        goToPage(Constant.PAGE.LOGIN, true);
        return true
    }
    if (status >= 400 && status < 500) {
        if (failCallback) {
            failCallback(info)
        } else {
            showDanger(responseData?.msg || `Request failed [${status}]`)
        }
        return true
    }
    if (networkFailCallback) {
        networkFailCallback(info)
    } else {
        showDanger(`Network request error [${status || 'unknown'}]`)
    }
    return true
}

let requestTime = 0
let reAjaxSec = 2

function reAjaxFun(fn) {
    let nowTimeSec = new Date().getTime() / 1000
    if (requestTime === 0) {
        requestTime = nowTimeSec
    }
    let ajaxIndex = parseInt((nowTimeSec - requestTime) / reAjaxSec)
    if (ajaxIndex > 10) {
        showWarning('Unable to connect to server')
    } else {
        showWarning('Connecting to server(' + ajaxIndex + ')')
    }
    if (ajaxIndex < 10 && fn) {
        setTimeout(() => {
            fn()
        }, reAjaxSec * 1000)
    }
}

function clearRequestTime() {
    requestTime = 0
}
