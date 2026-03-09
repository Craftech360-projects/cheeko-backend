/**
 * Unified Report Index Generator
 *
 * Scans all report sources and writes a single reports.json:
 *   - reports/playwright/{timestamp}/  → module: "ui" (manager-web)
 *   - reports/jest/api/{timestamp}/    → module: "api" (manager-api-node)
 *   - reports/jest/mqtt/{timestamp}/   → module: "mqtt" (mqtt-gateway)
 */

const fs = require('fs');
const path = require('path');

const REPORTS_ROOT = path.resolve(__dirname, '..', 'reports');
const OUTPUT_FILE = path.join(REPORTS_ROOT, 'reports.json');

const MODULE_LABELS = {
  ui: 'manager-web (UI)',
  api: 'manager-api-node (API)',
  mqtt: 'mqtt-gateway (MQTT)',
  livekit: 'livekit-server (Media API)',
};

const allReports = [];

// ── 1. Playwright UI reports ─────────────────────────────────────────────────
const playwrightDir = path.join(REPORTS_ROOT, 'playwright');
if (fs.existsSync(playwrightDir)) {
  const folders = fs.readdirSync(playwrightDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name));

  for (const d of folders) {
    const resultsPath = path.join(playwrightDir, d.name, 'results.json');
    let stats = { passed: 0, failed: 0, skipped: 0, total: 0, duration: 0 };
    let tests = [];

    if (fs.existsSync(resultsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

        function extractTests(suites) {
          for (const suite of suites || []) {
            for (const spec of suite.specs || []) {
              for (const test of spec.tests || []) {
                const result = test.results && test.results[0];
                if (!result) continue;

                const screenshots = (result.attachments || [])
                  .filter(a => a.contentType && a.contentType.startsWith('image/'))
                  .map(a => {
                    if (!a.path) return null;
                    const abs = path.resolve(path.join(playwrightDir, d.name), a.path);
                    const e2eRoot = path.resolve(__dirname, '..');
                    return path.relative(e2eRoot, abs).replace(/\\/g, '/');
                  })
                  .filter(Boolean);

                tests.push({
                  title: spec.title,
                  suite: suite.title,
                  status: result.status,
                  duration: result.duration,
                  screenshots,
                  failureMessages: [],
                });
              }
            }
            extractTests(suite.suites);
          }
        }

        for (const suite of data.suites || []) {
          extractTests([suite]);
        }

        stats.passed = tests.filter(t => t.status === 'passed').length;
        stats.failed = tests.filter(t => t.status === 'failed').length;
        stats.skipped = tests.filter(t => t.status === 'skipped').length;
        stats.total = tests.length;
        stats.duration = tests.reduce((sum, t) => sum + t.duration, 0);
      } catch (_) {}
    }

    allReports.push({
      folder: d.name,
      module: 'ui',
      moduleLabel: MODULE_LABELS.ui,
      source: 'playwright',
      stats,
      tests,
    });
  }
}

// ── 2. Jest API + MQTT reports ───────────────────────────────────────────────
const jestDir = path.join(REPORTS_ROOT, 'jest');
if (fs.existsSync(jestDir)) {
  for (const moduleName of ['api', 'mqtt', 'livekit']) {
    const moduleDir = path.join(jestDir, moduleName);
    if (!fs.existsSync(moduleDir)) continue;

    const folders = fs.readdirSync(moduleDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name));

    for (const d of folders) {
      const resultsPath = path.join(moduleDir, d.name, 'results.json');
      let stats = { passed: 0, failed: 0, skipped: 0, total: 0, duration: 0 };
      let tests = [];

      if (fs.existsSync(resultsPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
          stats = data.stats || stats;
          tests = (data.tests || []).map(t => ({
            ...t,
            // Normalize 'pending' → 'skipped' for consistency
            status: t.status === 'pending' ? 'skipped' : t.status,
          }));
        } catch (_) {}
      }

      allReports.push({
        folder: d.name,
        module: moduleName,
        moduleLabel: MODULE_LABELS[moduleName] || moduleName,
        source: 'jest',
        stats,
        tests,
      });
    }
  }
}

// Sort all reports by timestamp descending
allReports.sort((a, b) => b.folder.localeCompare(a.folder));

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allReports, null, 2));
console.log(`  Report index updated: ${allReports.length} report(s)`);
