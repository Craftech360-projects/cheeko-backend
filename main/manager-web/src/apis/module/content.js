import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get content library list with pagination and filters
    getLibraryList({ page = 1, limit = 20, contentType, category, isActive }, callback) {
        let url = `${getServiceUrl()}/content/library?page=${page}&limit=${limit}`;
        if (contentType) url += `&contentType=${encodeURIComponent(contentType)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (isActive !== undefined) url += `&isActive=${isActive}`;

        RequestService.sendRequest()
            .url(url)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get content library:', err);
                RequestService.reAjaxFun(() => {
                    this.getLibraryList({ page, limit, contentType, category, isActive }, callback);
                });
            }).send();
    },

    // Get content library categories
    getLibraryCategories(contentType, callback) {
        let url = `${getServiceUrl()}/content/library/categories`;
        if (contentType) url += `?contentType=${encodeURIComponent(contentType)}`;

        RequestService.sendRequest()
            .url(url)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get categories:', err);
                callback({ data: { code: -1, data: [] } });
            }).send();
    },

    // Get content library item by ID
    getLibraryById(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library/${id}`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get content item:', err);
                callback({ data: { code: -1, data: null } });
            }).send();
    },

    // Batch create content library items
    batchCreateLibraryItems(items, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library/batch`)
            .method('POST')
            .data({ items })
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to batch create content items:', err);
                callback({ data: { code: -1, msg: 'Failed to batch create content items' } });
            }).send();
    }
}
