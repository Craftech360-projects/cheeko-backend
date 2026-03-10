/**
 * Cleanup Helper
 *
 * Tracks created resources during tests and deletes them in teardown.
 * Ensures no test data pollution in the database.
 */

const axios = require('axios');
const config = require('../../test.config');
const { getBearerHeaders } = require('./auth.helper');

class CleanupTracker {
  constructor() {
    this.resources = [];
  }

  /**
   * Track a resource for cleanup
   * @param {string} type - Resource type (device, content, playlist, profile, rfid-card, rfid-series)
   * @param {string|number} id - Resource ID
   */
  track(type, id) {
    if (id) {
      this.resources.push({ type, id });
    }
  }

  /**
   * Delete all tracked resources in reverse order (LIFO)
   */
  async cleanAll() {
    const headers = getBearerHeaders();
    const baseUrl = config.managerApi.baseUrl;
    const errors = [];

    // Reverse order — delete children before parents
    for (const resource of [...this.resources].reverse()) {
      try {
        await this._deleteResource(baseUrl, headers, resource.type, resource.id);
      } catch (err) {
        errors.push(`Failed to delete ${resource.type}/${resource.id}: ${err.message}`);
      }
    }

    this.resources = [];

    if (errors.length > 0) {
      console.warn('Cleanup warnings:', errors.join('; '));
    }
  }

  async _deleteResource(baseUrl, headers, type, id) {
    const opts = { headers, timeout: 10000, validateStatus: () => true };
    switch (type) {
      case 'device':
        await axios.post(`${baseUrl}/device/unbind`, { deviceId: id }, opts);
        break;
      case 'content':
        await axios.delete(`${baseUrl}/content/library/${id}`, opts);
        break;
      case 'rfid-card':
        await axios.delete(`${baseUrl}/admin/rfid/card`, { ...opts, data: [id] });
        break;
      case 'rfid-series':
        await axios.delete(`${baseUrl}/admin/rfid/series`, { ...opts, data: [id] });
        break;
      case 'profile':
        await axios.delete(`${baseUrl}/admin/kids/${id}`, opts);
        break;
      case 'agent':
        await axios.delete(`${baseUrl}/agent/${id}`, opts);
        break;
      case 'agent-template':
        await axios.delete(`${baseUrl}/agent/template/${id}`, opts);
        break;
      case 'model':
        await axios.delete(`${baseUrl}/models/delete/${id}`, opts);
        break;
      case 'tts-voice':
        await axios.delete(`${baseUrl}/models/tts-voices/delete/${id}`, opts);
        break;
      case 'ota':
        await axios.delete(`${baseUrl}/device/ota/firmware/${id}`, opts);
        break;
      default:
        console.warn(`Unknown cleanup type: ${type}`);
    }
  }
}

function createCleanup() {
  return new CleanupTracker();
}

module.exports = { createCleanup, CleanupTracker };
