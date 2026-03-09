/**
 * Data Loader
 *
 * Fetches JSON reports and history from the api-tests/reports/ directory.
 */

const DataLoader = {
  baseUrl: '',
  cache: {},

  init(baseUrl) {
    this.baseUrl = baseUrl || '';
  },

  async loadHistory() {
    try {
      const res = await fetch(`${this.baseUrl}/api/history`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error('Failed to load history:', e);
      return [];
    }
  },

  async loadReport(runId) {
    if (this.cache[runId]) return this.cache[runId];

    try {
      const res = await fetch(`${this.baseUrl}/api/report/${runId}`);
      if (!res.ok) return null;
      const report = await res.json();
      this.cache[runId] = report;
      return report;
    } catch (e) {
      console.error('Failed to load report:', e);
      return null;
    }
  },

  async loadLatestReport() {
    const history = await this.loadHistory();
    if (!history.length) return null;
    const latest = history[history.length - 1];
    return await this.loadReport(latest.runId);
  }
};
