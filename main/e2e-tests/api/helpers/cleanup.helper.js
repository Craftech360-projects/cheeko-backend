/**
 * Cleanup Helper
 *
 * Tracks created resources during tests and deletes them in teardown.
 * Ensures no test data pollution in the database.
 */

const axios = require('axios');
const config = require('../../test.config');
const { getServiceKeyHeaders } = require('./auth.helper');

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
    const headers = getServiceKeyHeaders();
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
    // Some endpoints use DELETE with body instead of URL param
    switch (type) {
      case 'device':
        // No direct device delete; unbind instead
        await axios.post(`${baseUrl}/device/unbind`, { deviceId: id }, { headers, timeout: 10000, validateStatus: () => true });
        break;
      case 'content':
        await axios.delete(`${baseUrl}/content/library/${id}`, { headers, timeout: 10000, validateStatus: () => true });
        break;
      case 'rfid-card':
        // DELETE /admin/rfid/card expects array of IDs in body
        await axios.delete(`${baseUrl}/admin/rfid/card`, { headers, timeout: 10000, data: [id], validateStatus: () => true });
        break;
      case 'rfid-series':
        // DELETE /admin/rfid/series expects array of IDs in body
        await axios.delete(`${baseUrl}/admin/rfid/series`, { headers, timeout: 10000, data: [id], validateStatus: () => true });
        break;
      case 'profile':
        // Profile deletion via admin route
        await axios.delete(`${baseUrl}/admin/kids/${id}`, { headers, timeout: 10000, validateStatus: () => true });
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
