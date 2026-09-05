import axios from 'axios';
import store from '../store/index';
import Constant from '../utils/constant';
import { goToPage, isNotNull, showDanger, showWarning } from '../utils/index';

const http = axios.create();
http.defaults.timeout = 30000;

// In-flight GET dedup: identical concurrent GETs share one HTTP request
const inFlightGets = new Map();

// Method of the request that just failed, so reAjaxFun can refuse to
// auto-retry non-idempotent writes (a retried POST can double-create rows)
let lastFailedMethod = 'GET';

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
        _dispatch() {
            const authToken = getLatestAuthToken();
            if (isNotNull(authToken)) {
                this._header.Authorization = 'Bearer ' + authToken
            }

            if (typeof FormData !== 'undefined' && this._data instanceof FormData) {
                delete this._header['content-type']
                delete this._header['Content-Type']
            }

            const method = (this._method || 'GET').toUpperCase()
            const isGet = method === 'GET'
            const dedupKey = isGet
                ? `${method} ${this._url} ${JSON.stringify(this._data || {})}`
                : null

            const raw = http.request({
                url: this._url,
                method,
                data: this._data,
                headers: this._header,
                responseType: this._responseType
            })

            if (dedupKey && inFlightGets.has(dedupKey)) {
                // Same GET already in flight: piggyback on it instead of re-sending
                inFlightGets.get(dedupKey)
                    .then((res) => {
                        const error = httpHandlerError(res, this._failCallback, this._networkFailCallback);
                        if (!error && this._sucCallback) {
                            this._sucCallback(res)
                        }
                    })
                    .catch((err) => {
                        lastFailedMethod = method
                        httpHandlerError(err, this._failCallback, this._networkFailCallback)
                    })
                return
            }

            const tracked = raw.finally(() => {
                if (dedupKey) inFlightGets.delete(dedupKey)
            })
            if (dedupKey) inFlightGets.set(dedupKey, tracked)

            raw.then((res) => {
                const error = httpHandlerError(res, this._failCallback, this._networkFailCallback);
                if (!error && this._sucCallback) {
                    this._sucCallback(res)
                }
            }).catch((err) => {
                lastFailedMethod = method
                httpHandlerError(err, this._failCallback, this._networkFailCallback)
            })
        },
        'send'() {
            this._dispatch()
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

    // Never auto-retry a failed write — the first request may have landed and a
    // retry would duplicate the mutation. Surface the failure and stop.
    if (lastFailedMethod !== 'GET') {
        showWarning('Request failed. Please try again.')
        clearRequestTime()
        return
    }

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
