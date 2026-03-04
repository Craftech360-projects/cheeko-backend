/**
 * Dashboard Server
 *
 * Tiny Express server that serves the dashboard + API for reports.
 * Usage: node server.js [port]
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.argv[2] || 3333;

// Reports directory (from api-tests)
const REPORTS_DIR = path.resolve(__dirname, '..', 'api-tests', 'reports');

// Serve static dashboard files
app.use(express.static(__dirname));

// API: Get test history
app.get('/api/history', (req, res) => {
  const historyPath = path.join(REPORTS_DIR, 'test-history.json');
  if (!fs.existsSync(historyPath)) {
    return res.json([]);
  }
  try {
    const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// API: Get a specific report by runId
app.get('/api/report/:runId', (req, res) => {
  const runId = req.params.runId;
  // Sanitize: only allow alphanumeric, dashes, underscores
  if (!/^[\w\-]+$/.test(runId)) {
    return res.status(400).json({ error: 'Invalid runId' });
  }

  const reportPath = path.join(REPORTS_DIR, 'runs', `${runId}.json`);
  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read report' });
  }
});

// API: List all reports
app.get('/api/reports', (req, res) => {
  const runsDir = path.join(REPORTS_DIR, 'runs');
  if (!fs.existsSync(runsDir)) {
    return res.json([]);
  }
  const files = fs.readdirSync(runsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
  res.json(files);
});

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Cheeko Test Dashboard                    ║');
  console.log(`║  http://localhost:${PORT}`.padEnd(44) + '║');
  console.log('║                                          ║');
  console.log('║  Reading reports from:                    ║');
  console.log(`║  ${REPORTS_DIR.length > 40 ? '...' + REPORTS_DIR.slice(-37) : REPORTS_DIR}`.padEnd(44) + '║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});
