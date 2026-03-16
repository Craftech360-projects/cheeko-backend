import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // ==================== QUESTIONS ====================

    // Get question page list
    getQuestionPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            code: params.code || '',
            category: params.category || '',
            language: params.language || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get question list:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionPage(params, callback)
                })
            }).send()
    },

    // Get all questions list
    getQuestionList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get question list:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionList(callback)
                })
            }).send()
    },

    // Get question by ID
    getQuestionById(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get question detail:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionById(id, callback)
                })
            }).send()
    },

    // Add question
    addQuestion(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add question:', err)
                RequestService.reAjaxFun(() => {
                    this.addQuestion(data, callback)
                })
            }).send()
    },

    // Update question
    updateQuestion(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update question:', err)
                RequestService.reAjaxFun(() => {
                    this.updateQuestion(data, callback)
                })
            }).send()
    },

    // Delete questions
    deleteQuestion(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete question:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteQuestion(ids, callback)
                })
            }).send()
    },

    // ==================== PACKS ====================

    // Get pack page list
    getPackPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            packCode: params.packCode || '',
            name: params.name || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getPackPage(params, callback)
                })
            }).send()
    },

    // Get all packs list
    getPackList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getPackList(callback)
                })
            }).send()
    },

    // Get pack by ID
    getPackById(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get pack detail:', err)
                RequestService.reAjaxFun(() => {
                    this.getPackById(id, callback)
                })
            }).send()
    },

    // Add pack
    addPack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add pack:', err)
                RequestService.reAjaxFun(() => {
                    this.addPack(data, callback)
                })
            }).send()
    },

    // Update pack
    updatePack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update pack:', err)
                RequestService.reAjaxFun(() => {
                    this.updatePack(data, callback)
                })
            }).send()
    },

    // Delete packs
    deletePack(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/pack/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete pack:', err)
                RequestService.reAjaxFun(() => {
                    this.deletePack(ids, callback)
                })
            }).send()
    },

    // ==================== CARDS ====================

    // Get card page list
    getCardPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            rfidUid: params.rfidUid || '',
            packCode: params.packCode || '',
            questionId: params.questionId || '',
            contentPackId: params.contentPackId || '',
            categoryId: params.categoryId || '',
            cardType: params.cardType || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get card list:', err)
                RequestService.reAjaxFun(() => {
                    this.getCardPage(params, callback)
                })
            }).send()
    },

    // Get all cards list
    getCardList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get card list:', err)
                RequestService.reAjaxFun(() => {
                    this.getCardList(callback)
                })
            }).send()
    },

    // Get card by ID
    getCardById(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get card detail:', err)
                RequestService.reAjaxFun(() => {
                    this.getCardById(id, callback)
                })
            }).send()
    },

    // Get card by RFID UID
    getCardByUid(rfidUid, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/uid/${rfidUid}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get card by UID:', err)
                RequestService.reAjaxFun(() => {
                    this.getCardByUid(rfidUid, callback)
                })
            }).send()
    },

    // Add card
    addCard(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add card:', err)
                RequestService.reAjaxFun(() => {
                    this.addCard(data, callback)
                })
            }).send()
    },

    // Update card
    updateCard(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update card:', err)
                RequestService.reAjaxFun(() => {
                    this.updateCard(data, callback)
                })
            }).send()
    },

    // Delete cards
    deleteCard(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete card:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteCard(ids, callback)
                })
            }).send()
    },

    // ==================== SERIES ====================

    // Get series page list
    getSeriesPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            packId: params.packId || '',
            questionId: params.questionId || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get series list:', err)
                RequestService.reAjaxFun(() => {
                    this.getSeriesPage(params, callback)
                })
            }).send()
    },

    // Get all series list
    getSeriesList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get series list:', err)
                RequestService.reAjaxFun(() => {
                    this.getSeriesList(callback)
                })
            }).send()
    },

    // Get series by ID
    getSeriesById(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get series detail:', err)
                RequestService.reAjaxFun(() => {
                    this.getSeriesById(id, callback)
                })
            }).send()
    },

    // Add series
    addSeries(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add series:', err)
                RequestService.reAjaxFun(() => {
                    this.addSeries(data, callback)
                })
            }).send()
    },

    // Update series
    updateSeries(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update series:', err)
                RequestService.reAjaxFun(() => {
                    this.updateSeries(data, callback)
                })
            }).send()
    },

    // Delete series
    deleteSeries(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete series:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteSeries(ids, callback)
                })
            }).send()
    },

    // ==================== CONTENT PACKS ====================

    // Get content pack page list
    getContentPackPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            packCode: params.packCode || '',
            contentType: params.contentType || '',
            language: params.language || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get content pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getContentPackPage(params, callback)
                })
            }).send()
    },

    // Get all content packs list
    getContentPackList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get content pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getContentPackList(callback)
                })
            }).send()
    },

    // Get active content packs
    getContentPackActive(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack/active`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get active content packs:', err)
                RequestService.reAjaxFun(() => {
                    this.getContentPackActive(callback)
                })
            }).send()
    },

    // Get content pack by code
    getContentPackByCode(packCode, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get content pack:', err)
                RequestService.reAjaxFun(() => {
                    this.getContentPackByCode(packCode, callback)
                })
            }).send()
    },

    // Add content pack
    addContentPack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add content pack:', err)
                RequestService.reAjaxFun(() => {
                    this.addContentPack(data, callback)
                })
            }).send()
    },

    // Update content pack
    updateContentPack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update content pack:', err)
                RequestService.reAjaxFun(() => {
                    this.updateContentPack(data, callback)
                })
            }).send()
    },

    // Delete content packs
    deleteContentPack(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/content-pack/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete content pack:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteContentPack(ids, callback)
                })
            }).send()
    },

    // ==================== QUESTION PACKS (NEW) ====================

    // Get question pack page list
    getQuestionPackPage(params, callback) {
        const queryParams = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 10,
            packCode: params.packCode || '',
            name: params.name || '',
            category: params.category || '',
            language: params.language || '',
            active: params.active !== undefined ? params.active : ''
        }).toString();

        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack/page?${queryParams}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get question pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionPackPage(params, callback)
                })
            }).send()
    },

    // Get all question packs list
    getQuestionPackList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack/list`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get question pack list:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionPackList(callback)
                })
            }).send()
    },

    // Get active question packs
    getQuestionPackActive(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack/active`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get active question packs:', err)
                RequestService.reAjaxFun(() => {
                    this.getQuestionPackActive(callback)
                })
            }).send()
    },

    // Add question pack
    addQuestionPack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to add question pack:', err)
                RequestService.reAjaxFun(() => {
                    this.addQuestionPack(data, callback)
                })
            }).send()
    },

    // Update question pack
    updateQuestionPack(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to update question pack:', err)
                RequestService.reAjaxFun(() => {
                    this.updateQuestionPack(data, callback)
                })
            }).send()
    },

    // Delete question packs
    deleteQuestionPack(ids, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/question-pack/delete`)
            .method('POST')
            .data(ids)
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to delete question packs:', err)
                RequestService.reAjaxFun(() => {
                    this.deleteQuestionPack(ids, callback)
                })
            }).send()
    },

    // ==================== LOOKUP (Console) ====================

    // Lookup card by RFID UID
    lookupCard(rfidUid, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/lookup/${encodeURIComponent(rfidUid)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to lookup card:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Lookup series by RFID UID
    lookupSeries(rfidUid, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/series/lookup/${encodeURIComponent(rfidUid)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to lookup series:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Lookup content by RFID UID with sequence
    lookupContent(rfidUid, sequence, callback) {
        const seqParam = sequence ? `?sequence=${sequence}` : '';
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/lookup/${encodeURIComponent(rfidUid)}${seqParam}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to lookup content:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    },

    // Get content download manifest
    getContentDownload(rfidUid, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/admin/rfid/card/content/download/${encodeURIComponent(rfidUid)}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime()
                callback(res)
            })
            .networkFail((err) => {
                console.error('Failed to get content download:', err)
                callback({ data: { code: -1, msg: 'Network error', data: null } })
            }).send()
    }
}
