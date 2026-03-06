/**
 * Custom Jest Reporter — saves results as JSON for the unified dashboard.
 *
 * Writes to reports/jest/{module}/{timestamp}/results.json
 * Module is determined from the test file path (api/ or mqtt/).
 */

const fs = require('fs');
const path = require('path');

class JsonDashboardReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
  }

  onRunComplete(contexts, results) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Group test results by module (api, mqtt)
    const modules = {};

    for (const suite of results.testResults) {
      // Determine module from file path
      const relPath = path.relative(
        path.resolve(__dirname, '..'),
        suite.testFilePath
      ).replace(/\\/g, '/');

      let moduleName = 'other';
      if (relPath.startsWith('api/')) moduleName = 'api';
      else if (relPath.startsWith('mqtt/')) moduleName = 'mqtt';
      else if (relPath.startsWith('livekit/')) moduleName = 'livekit';

      if (!modules[moduleName]) modules[moduleName] = [];

      const suiteName = path.basename(suite.testFilePath, '.spec.js')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      for (const test of suite.testResults) {
        modules[moduleName].push({
          title: test.title,
          suite: suiteName,
          fullName: test.fullName,
          status: test.status, // 'passed', 'failed', 'pending'
          duration: test.duration || 0,
          failureMessages: test.failureMessages || [],
          screenshots: [],
        });
      }
    }

    // Write a results file per module
    for (const [moduleName, tests] of Object.entries(modules)) {
      const outDir = path.resolve(__dirname, '..', 'reports', 'jest', moduleName, timestamp);
      fs.mkdirSync(outDir, { recursive: true });

      const stats = {
        passed: tests.filter(t => t.status === 'passed').length,
        failed: tests.filter(t => t.status === 'failed').length,
        skipped: tests.filter(t => t.status === 'pending').length,
        total: tests.length,
        duration: tests.reduce((sum, t) => sum + t.duration, 0),
      };

      fs.writeFileSync(
        path.join(outDir, 'results.json'),
        JSON.stringify({ stats, tests }, null, 2)
      );
    }

    // Update the unified report index
    try {
      require('./update-report-index');
    } catch (_) {}
  }
}

module.exports = JsonDashboardReporter;
