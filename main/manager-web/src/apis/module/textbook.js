import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get textbook list with pagination and filters
    getTextbooks(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 0,
            size: params.size || 20,
            grade: params.grade || '',
            subject: params.subject || '',
            status: params.status || '',
            search: params.search || ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Load textbooks failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getTextbooks(params, callback)
                })
            }).send()
    },

    // Get textbook statistics
    getTextbookStats(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/stats`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Load statistics failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getTextbookStats(callback)
                })
            }).send()
    },

    // Delete textbook
    deleteTextbook(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/${id}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Delete textbook failed:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteTextbook(id, callback)
                })
            }).send()
    },

    // Process textbook
    processTextbook(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/${id}/process`)
            .method('POST')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Process textbook failed:', err)
                RequestService.reAjaxFun(() => {
                    this.processTextbook(id, callback)
                })
            }).send()
    },

    // Get textbook chunks
    getTextbookChunks(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/${id}/chunks`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Load chunks failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getTextbookChunks(id, callback)
                })
            }).send()
    },

    // Get textbook topics (for topics dialog)
    getTextbookTopics(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/${id}/topics`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Load topics failed:', err)
                RequestService.reAjaxFun(() => {
                    this.getTextbookTopics(id, callback)
                })
            }).send()
    },

    // Upload textbook
    uploadTextbook(formData, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/upload`)
            .method('POST')
            .data(formData)
            .header({ 'content-type': 'multipart/form-data' })
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Upload textbook failed:', err)
                RequestService.reAjaxFun(() => {
                    this.uploadTextbook(formData, callback)
                })
            }).send()
    },

    // RAG testing
    testRAGQuery(queryData, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/api/textbooks/test-rag`)
            .method('POST')
            .data(queryData)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('RAG test failed:', err)
                RequestService.reAjaxFun(() => {
                    this.testRAGQuery(queryData, callback)
                })
            }).send()
    }
}