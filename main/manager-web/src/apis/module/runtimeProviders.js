import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
  getProviders(callback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/livekit/providers`)
      .method('GET')
      .success((res) => {
        RequestService.clearRequestTime();
        callback(res);
      })
      .networkFail((err) => {
        console.error('Failed to get runtime providers:', err);
        RequestService.reAjaxFun(() => {
          this.getProviders(callback);
        });
      }).send();
  },

  updateProvider(type, id, data, callback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/livekit/providers/${type}/${id}`)
      .method('PUT')
      .data(data)
      .success((res) => {
        RequestService.clearRequestTime();
        callback(res);
      })
      .networkFail((err) => {
        console.error('Failed to update runtime provider:', err);
        RequestService.reAjaxFun(() => {
          this.updateProvider(type, id, data, callback);
        });
      }).send();
  },

  activateProvider(type, id, callback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/livekit/providers/${type}/${id}/active`)
      .method('PUT')
      .success((res) => {
        RequestService.clearRequestTime();
        callback(res);
      })
      .networkFail((err) => {
        console.error('Failed to activate runtime provider:', err);
        RequestService.reAjaxFun(() => {
          this.activateProvider(type, id, callback);
        });
      }).send();
  }
};
