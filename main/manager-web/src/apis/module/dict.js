import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get dictionary type list
    getDictTypeList(params, callback) {
        const queryParams = new URLSearchParams({
            dictType: params.dictType || '',
            dictName: params.dictName || '',
            page: params.page || 1,
            limit: params.limit || 10
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/type/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get dictionary type list:', err)
                this.$message.error(err.msg || 'Failed to get dictionary type list')
                RequestService.reAjaxFun(() => {
                    this.getDictTypeList(params, callback)
                })
            }).send()
    },

    // Get dictionary type detail
    getDictTypeDetail(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/type/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get dictionary type detail:', err)
                this.$message.error(err.msg || 'Failed to get dictionary type detail')
                RequestService.reAjaxFun(() => {
                    this.getDictTypeDetail(id, callback)
                })
            }).send()
    },

    // Add dictionary type
    addDictType(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/type/save`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add dictionary type:', err)
                this.$message.error(err.msg || 'Failed to add dictionary type')
                RequestService.reAjaxFun(() => {
                    this.addDictType(data, callback)
                })
            }).send()
    },

    // Update dictionary type
    updateDictType(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/type/update`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update dictionary type:', err)
                this.$message.error(err.msg || 'Failed to update dictionary type')
                RequestService.reAjaxFun(() => {
                    this.updateDictType(data, callback)
                })
            }).send()
    },

    // Delete dictionary type
    deleteDictType(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/type/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete dictionary type:', err)
                this.$message.error(err.msg || 'Failed to delete dictionary type')
                RequestService.reAjaxFun(() => {
                    this.deleteDictType(ids, callback)
                })
            }).send()
    },

    // Get dictionary data list
    getDictDataList(params, callback) {
        const queryParams = new URLSearchParams({
            dictTypeId: params.dictTypeId,
            dictLabel: params.dictLabel || '',
            dictValue: params.dictValue || '',
            page: params.page || 1,
            limit: params.limit || 10
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/data/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get dictionary data list:', err)
                this.$message.error(err.msg || 'Failed to get dictionary data list')
                RequestService.reAjaxFun(() => {
                    this.getDictDataList(params, callback)
                })
            }).send()
    },

    // Get dictionary data detail
    getDictDataDetail(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/data/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get dictionary data detail:', err)
                this.$message.error(err.msg || 'Failed to get dictionary data detail')
                RequestService.reAjaxFun(() => {
                    this.getDictDataDetail(id, callback)
                })
            }).send()
    },

    // Add dictionary data
    addDictData(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/data/save`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add dictionary data:', err)
                this.$message.error(err.msg || 'Failed to add dictionary data')
                RequestService.reAjaxFun(() => {
                    this.addDictData(data, callback)
                })
            }).send()
    },

    // Update dictionary data
    updateDictData(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/data/update`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update dictionary data:', err)
                this.$message.error(err.msg || 'Failed to update dictionary data')
                RequestService.reAjaxFun(() => {
                    this.updateDictData(data, callback)
                })
            }).send()
    },

    // Delete dictionary data
    deleteDictData(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/dict/data/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete dictionary data:', err)
                this.$message.error(err.msg || 'Failed to delete dictionary data')
                RequestService.reAjaxFun(() => {
                    this.deleteDictData(ids, callback)
                })
            }).send()
    },

    // Get dictionary data by type
    getDictDataByType(dictType) {
        return new Promise((resolve, reject) => {
            RequestService.sendRequest()
                .url(`${getServiceUrl()}/admin/dict/data/type/${dictType}`)
                .method('GET')
                .success((res) => {
                    RequestService.clearRequestTime()
                    if (res.data && res.data.code === 0) {
                        resolve(res.data)
                    } else {
                        reject(new Error(res.data?.msg || 'Failed to get dictionary data list'))
                    }
                })
                .networkFail((err) => {
                    console.error('Failed to get dictionary data list:', err)
                    reject(err)
                }).send()
        })
    }

}
