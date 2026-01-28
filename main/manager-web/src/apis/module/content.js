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

    // Search content library
    searchLibrary({ query, page = 1, limit = 20, contentType, category }, callback) {
        let url = `${getServiceUrl()}/content/library/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
        if (contentType) url += `&contentType=${encodeURIComponent(contentType)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;

        RequestService.sendRequest()
            .url(url)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to search content library:', err);
                callback({ data: { code: -1, data: { list: [], total: 0 } } });
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

    // Create content library item
    createLibraryItem(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to create content item:', err);
                callback({ data: { code: -1, msg: 'Failed to create content item' } });
            }).send();
    },

    // Update content library item
    updateLibraryItem(id, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library/${id}`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to update content item:', err);
                callback({ data: { code: -1, msg: 'Failed to update content item' } });
            }).send();
    },

    // Delete content library item
    deleteLibraryItem(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library/${id}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to delete content item:', err);
                callback({ data: { code: -1, msg: 'Failed to delete content item' } });
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
    },

    // Get content library statistics
    getStatistics(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library/statistics`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get content statistics:', err);
                callback({ data: { code: -1, data: { total: 0, byType: {}, byCategory: {} } } });
            }).send();
    }
}
