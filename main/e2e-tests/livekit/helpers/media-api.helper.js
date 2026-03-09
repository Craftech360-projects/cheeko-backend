/**
 * Media API Helper
 *
 * Checks if the livekit media_api (port 8003) is available.
 * All livekit scenario tests gracefully skip when the API is not running.
 */

const axios = require('axios');
const config = require('../../test.config');

const BASE_URL = config.mediaApi.baseUrl;

async function isMediaApiAvailable() {
  try {
    const res = await axios.get(`${BASE_URL}/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function mediaGet(path, opts = {}) {
  return axios.get(`${BASE_URL}${path}`, {
    timeout: opts.timeout || 10000,
    validateStatus: () => true,
    ...opts,
  });
}

async function mediaPost(path, body = {}, opts = {}) {
  return axios.post(`${BASE_URL}${path}`, body, {
    timeout: opts.timeout || 10000,
    validateStatus: () => true,
    ...opts,
  });
}

module.exports = { isMediaApiAvailable, mediaGet, mediaPost, BASE_URL };
