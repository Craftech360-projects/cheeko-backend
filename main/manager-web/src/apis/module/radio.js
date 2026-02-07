import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
    // Get full radio schedule (all days, all items) for admin dashboard
    getScheduleAll(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/config/radio-schedule/all`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get radio schedule:', err);
                callback({ data: { code: -1, data: [] } });
            }).send();
    },

    // Create a new schedule item
    createScheduleItem(data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/config/radio-schedule`)
            .method('POST')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to create schedule item:', err);
                callback({ data: { code: -1, msg: 'Failed to create schedule item' } });
            }).send();
    },

    // Update a schedule item
    updateScheduleItem(id, data, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/config/radio-schedule/${id}`)
            .method('PUT')
            .data(data)
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to update schedule item:', err);
                callback({ data: { code: -1, msg: 'Failed to update schedule item' } });
            }).send();
    },

    // Get podcast list from content library for radio schedule picker
    getPodcastList(callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/content/library?contentType=podcast&limit=100&isActive=true`)
            .method('GET')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to get podcast list:', err);
                callback({ data: { code: -1, data: { list: [] } } });
            }).send();
    },

    // Delete a schedule item
    deleteScheduleItem(id, callback) {
        RequestService.sendRequest()
            .url(`${getServiceUrl()}/config/radio-schedule/${id}`)
            .method('DELETE')
            .success((res) => {
                RequestService.clearRequestTime();
                callback(res);
            })
            .networkFail((err) => {
                console.error('Failed to delete schedule item:', err);
                callback({ data: { code: -1, msg: 'Failed to delete schedule item' } });
            }).send();
    }
}
