/**
 * Unified E2E Test Report Dashboard Server
 *
 * Single dashboard for all test modules:
 * - manager-web (UI) — Playwright
 * - manager-api-node (API) — Jest/PactumJS
 * - mqtt-gateway (MQTT) — Jest
 * - livekit-server (LiveKit) — Jest
 *
 * Usage: node scripts/report-server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 3000;
const E2E_ROOT = path.resolve(__dirname, '..');
const REPORTS_JSON = path.join(E2E_ROOT, 'reports', 'reports.json');

const MIME_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.json': 'application/json', '.html': 'text/html',
};

function getMime(f) { return MIME_TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream'; }

const DASHBOARD_HTML = /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E Test Reports - Cheeko</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --module-color: #3B82F6;
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --text: #1E293B;
      --text-muted: #64748B;
      --text-faint: #94A3B8;
      --border: #E2E8F0;
      --border-light: #F1F5F9;
      --green: #10B981;
      --green-dark: #059669;
      --red: #EF4444;
      --red-dark: #DC2626;
      --amber: #F59E0B;
      --amber-dark: #D97706;
      --blue: #3B82F6;
      --blue-dark: #2563EB;
      --orange: #F97316;
      --orange-dark: #EA580C;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 15px; line-height: 1.5; }

    /* ── Header ─────────────────────────────────────────── */
    .header { background: #0F172A; color: white; padding: 20px 40px 0; position: sticky; top: 0; z-index: 100; }
    .header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .header h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header-module { font-size: 13px; color: var(--module-color); font-weight: 500; opacity: 0.9; }

    .tabs { display: flex; gap: 8px; padding-bottom: 16px; }
    .tab {
      padding: 8px 20px; border-radius: 6px; cursor: pointer;
      font-size: 13px; font-weight: 500;
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
      transition: all 200ms ease; user-select: none;
    }
    .tab:hover { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.85); }
    .tab:focus-visible { outline: 2px solid var(--module-color); outline-offset: 2px; }
    .tab.active { background: var(--module-color); color: white; }
    .tab-count {
      display: inline-block; background: rgba(255,255,255,0.2);
      padding: 1px 8px; border-radius: 10px; font-size: 11px;
      margin-left: 6px; font-family: 'Fira Code', monospace;
    }
    .tab.active .tab-count { background: rgba(255,255,255,0.3); }

    .shimmer-bar {
      height: 3px; width: 100%;
      background: linear-gradient(90deg, transparent, var(--module-color), transparent);
      background-size: 200% 100%;
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }

    /* ── Controls ───────────────────────────────────────── */
    .controls {
      background: var(--surface); padding: 16px 40px;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 16px;
    }
    select {
      padding: 10px 16px; border-radius: 8px;
      border: 2px solid var(--border); font-size: 14px;
      font-family: 'Fira Code', monospace; cursor: pointer;
      min-width: 320px; background: var(--surface); color: var(--text);
      transition: border-color 200ms, box-shadow 200ms;
    }
    select:focus { outline: none; border-color: var(--module-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--module-color) 20%, transparent); }
    .report-info { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-muted); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-dot.ok { background: var(--green); }
    .status-dot.fail { background: var(--red); }

    /* ── Container ──────────────────────────────────────── */
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }

    /* ── Stat Cards ─────────────────────────────────────── */
    .stats-grid {
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: var(--surface); border-radius: 12px; padding: 16px 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid var(--border);
      transition: transform 200ms, box-shadow 200ms;
    }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; }
    .stat-value { font-size: 36px; font-weight: 800; font-family: 'Fira Code', monospace; }

    .stat-passed { border-left-color: var(--green); }
    .stat-passed .stat-value { color: var(--green-dark); }
    .stat-failed { border-left-color: var(--red); }
    .stat-failed .stat-value { color: var(--red-dark); }
    .stat-failed.has-failures { background: #FEF2F2; }
    .stat-skipped { border-left-color: var(--amber); }
    .stat-skipped .stat-value { color: var(--amber-dark); }
    .stat-total { border-left-color: var(--blue); }
    .stat-total .stat-value { color: var(--blue-dark); }
    .stat-duration { border-left-color: var(--orange); }
    .stat-duration .stat-value { color: var(--orange-dark); font-size: 24px; }

    /* ── Pass Rate Bar ──────────────────────────────────── */
    .pass-rate-container { margin-bottom: 32px; }
    .pass-rate-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; display: flex; }
    .pass-rate-fill-passed { background: var(--green); transition: width 300ms ease; }
    .pass-rate-fill-failed { background: var(--red); transition: width 300ms ease; }
    .pass-rate-fill-skipped { background: var(--amber); transition: width 300ms ease; }
    .pass-rate-text { font-family: 'Fira Code', monospace; font-size: 13px; color: var(--text-muted); margin-top: 8px; }
    .pass-rate-text strong { color: var(--text); }

    /* ── Suite Groups ───────────────────────────────────── */
    .suite-group { margin-bottom: 24px; }
    .suite-header {
      background: var(--border-light); border-radius: 8px;
      padding: 10px 16px; margin-bottom: 2px;
      display: flex; justify-content: space-between; align-items: center;
      cursor: pointer; user-select: none;
      border-left: 4px solid var(--module-color);
      transition: background 200ms;
    }
    .suite-header:hover { background: #E8ECF1; }
    .suite-header:focus-visible { outline: 2px solid var(--module-color); outline-offset: -2px; }
    .suite-header-left { display: flex; align-items: center; gap: 10px; }
    .suite-chevron {
      width: 0; height: 0;
      border-left: 5px solid var(--text-muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent;
      transition: transform 200ms;
    }
    .suite-chevron.open { transform: rotate(90deg); }
    .suite-name { font-size: 14px; font-weight: 700; color: var(--text); text-transform: uppercase; letter-spacing: 0.5px; }
    .suite-stats { font-family: 'Fira Code', monospace; font-size: 12px; color: var(--text-muted); display: flex; gap: 12px; }
    .suite-stats .s-passed { color: var(--green-dark); }
    .suite-stats .s-failed { color: var(--red-dark); font-weight: 600; }
    .suite-body { overflow: hidden; }
    .suite-body.collapsed { display: none; }

    /* ── Test Rows ──────────────────────────────────────── */
    .test-row {
      display: grid; grid-template-columns: 28px 1fr 80px 32px;
      padding: 8px 16px; align-items: center;
      border-bottom: 1px solid var(--border-light);
      cursor: pointer; transition: background 200ms;
      background: var(--surface);
    }
    .test-row:focus-visible { outline: 2px solid var(--module-color); outline-offset: -2px; }
    .test-row:first-child { border-radius: 8px 8px 0 0; }
    .test-row:last-child, .test-row:has(+ .test-detail:last-child) { border-radius: 0 0 8px 8px; }
    .test-row:hover { background: var(--bg); }
    .test-row.status-failed { background: #FEF2F2; border-left: 3px solid var(--red); padding-left: 17px; }
    .test-row.status-failed:hover { background: #FEE2E2; }

    .test-dot { width: 10px; height: 10px; border-radius: 50%; }
    .test-dot.passed { background: var(--green); }
    .test-dot.failed { background: var(--red); }
    .test-dot.skipped { background: var(--amber); }

    .test-name { font-size: 15px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .test-row.status-passed .test-name { color: var(--text-muted); font-weight: 400; }
    .test-row.status-failed .test-name { color: var(--text); font-weight: 600; }

    .test-duration { font-family: 'Fira Code', monospace; font-size: 13px; color: var(--text-faint); text-align: right; }

    .test-arrow {
      width: 0; height: 0;
      border-left: 4px solid var(--text-faint); border-top: 3px solid transparent; border-bottom: 3px solid transparent;
      transition: transform 200ms; justify-self: center;
    }
    .test-arrow.open { transform: rotate(90deg); }

    /* ── Test Detail (expanded) ─────────────────────────── */
    .test-detail {
      display: none; padding: 16px 20px 16px 48px;
      background: var(--bg); border-bottom: 1px solid var(--border);
    }
    .test-detail.open { display: block; }

    .screenshots { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
    .screenshot-thumb {
      border: 2px solid var(--border); border-radius: 8px;
      cursor: pointer; transition: all 200ms;
      max-width: 300px; max-height: 200px;
    }
    .screenshot-thumb:hover { border-color: var(--module-color); transform: scale(1.02); }
    .no-details { color: var(--text-faint); font-size: 13px; font-style: italic; }

    .failure-msg {
      background: #1E293B; border-radius: 8px; padding: 16px;
      margin-top: 8px; font-family: 'Fira Code', monospace;
      font-size: 12px; color: #FCA5A5; white-space: pre-wrap;
      max-height: 250px; overflow: auto; line-height: 1.6;
    }

    /* ── Modal ──────────────────────────────────────────── */
    .modal-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85); backdrop-filter: blur(4px);
      z-index: 200; justify-content: center; align-items: center;
      cursor: zoom-out; animation: fadeIn 200ms ease;
    }
    .modal-overlay.open { display: flex; }
    .modal-overlay img { max-width: 95vw; max-height: 95vh; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.4); }
    .modal-close {
      position: fixed; top: 20px; right: 24px;
      width: 40px; height: 40px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 28px; font-weight: 300;
      border: 1px solid rgba(255,255,255,0.2); border-radius: 8px;
      background: rgba(255,255,255,0.1); transition: background 200ms;
    }
    .modal-close:hover { background: rgba(255,255,255,0.2); }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* ── Empty / Loading States ─────────────────────────── */
    .empty-state { text-align: center; padding: 80px 0; }
    .empty-icon { margin-bottom: 16px; }
    .empty-title { font-size: 18px; font-weight: 500; color: var(--text-muted); margin-bottom: 4px; }
    .empty-subtitle { font-size: 14px; color: var(--text-faint); }

    .skeleton { animation: pulse 1.5s ease-in-out infinite; background: var(--border); border-radius: 12px; }
    .skeleton-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
    .skeleton-card { height: 100px; }
    .skeleton-bar { height: 8px; margin-bottom: 32px; border-radius: 4px; }
    .skeleton-suite { height: 48px; margin-bottom: 8px; }
    .skeleton-row { height: 48px; margin-bottom: 2px; border-radius: 8px; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* ── Responsive ─────────────────────────────────────── */
    @media (max-width: 768px) {
      .header { padding: 16px 20px 0; }
      .controls { padding: 12px 20px; }
      select { min-width: 200px; font-size: 12px; }
      .container { padding: 20px 16px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-duration { grid-column: span 2; }
      .test-row { grid-template-columns: 24px 1fr 60px 24px; padding: 10px 14px; }
      .test-name { font-size: 13px; }
      .tabs { flex-wrap: wrap; }
    }

    @media (prefers-reduced-motion: reduce) {
      .shimmer-bar { animation: none; }
      * { transition-duration: 0ms !important; animation-duration: 0ms !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <h1>Cheeko E2E Test Reports</h1>
      <span class="header-module" id="headerModule"></span>
    </div>
    <div class="tabs" id="tabs"></div>
    <div class="shimmer-bar"></div>
  </div>
  <div class="controls">
    <select id="reportSelect" onchange="loadReport(this.value)">
      <option value="">Loading...</option>
    </select>
    <div class="report-info" id="reportInfo"></div>
  </div>
  <div class="container" id="content">
    <div class="skeleton-stats">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
    <div class="skeleton skeleton-bar"></div>
    <div class="skeleton skeleton-suite"></div>
    <div class="skeleton skeleton-row"></div>
    <div class="skeleton skeleton-row"></div>
    <div class="skeleton skeleton-row"></div>
  </div>
  <div class="modal-overlay" id="modal" onclick="closeModal()">
    <div class="modal-close" onclick="closeModal()">&times;</div>
    <img id="modalImg" src="" alt="" />
  </div>

  <script>
    let allReports = [];
    let currentModule = 'all';

    const MODULE_COLORS = {
      all: '#3B82F6',
      ui: '#60A5FA',
      api: '#8B5CF6',
      mqtt: '#10B981',
      livekit: '#F97316'
    };

    function setModuleColor(mod) {
      const color = MODULE_COLORS[mod] || MODULE_COLORS.all;
      document.documentElement.style.setProperty('--module-color', color);
    }

    async function init() {
      const res = await fetch('/api/reports');
      allReports = await res.json();
      buildTabs();
      filterByModule('all');
    }

    function buildTabs() {
      const counts = { all: allReports.length };
      allReports.forEach(r => { counts[r.module] = (counts[r.module] || 0) + 1; });

      const modules = [
        { key: 'all', label: 'All Reports' },
        { key: 'ui', label: 'manager-web' },
        { key: 'api', label: 'manager-api-node' },
        { key: 'mqtt', label: 'mqtt-gateway' },
        { key: 'livekit', label: 'livekit-server' },
      ];

      document.getElementById('tabs').innerHTML = modules
        .filter(m => m.key === 'all' || counts[m.key])
        .map(m =>
          '<div class="tab' + (m.key === currentModule ? ' active' : '') + '" onclick="filterByModule(\\'' + m.key + '\\')" tabindex="0" onkeydown="if(event.key === \\'Enter\\' || event.key === \\' \\') { event.preventDefault(); filterByModule(\\'' + m.key + '\\'); }">' +
          m.label + '<span class="tab-count">' + (counts[m.key] || 0) + '</span></div>'
        ).join('');
    }

    function filterByModule(mod) {
      currentModule = mod;
      setModuleColor(mod);
      buildTabs();

      const modLabels = { all: 'All Modules', ui: 'manager-web (UI)', api: 'manager-api-node (API)', mqtt: 'mqtt-gateway (MQTT)', livekit: 'livekit-server (Media API)' };
      document.getElementById('headerModule').textContent = modLabels[mod] || mod;

      const filtered = mod === 'all' ? allReports : allReports.filter(r => r.module === mod);
      const select = document.getElementById('reportSelect');

      if (filtered.length === 0) {
        select.innerHTML = '<option value="">No reports found</option>';
        document.getElementById('reportInfo').innerHTML = '';
        document.getElementById('content').innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5h6"/><path d="M9 14l2 2 4-4"/></svg></div>' +
            '<div class="empty-title">No reports for this module yet</div>' +
            '<div class="empty-subtitle">Run tests to generate reports</div>' +
          '</div>';
        return;
      }

      select.innerHTML = filtered.map((r, i) => {
        const date = formatDate(r.folder);
        const icon = r.stats.failed > 0 ? ' [FAIL]' : ' [PASS]';
        const tag = r.moduleLabel || r.module;
        const label = i === 0 ? ' (Latest)' : '';
        return '<option value="' + r.module + '::' + r.folder + '">[' + tag + '] ' + date + icon + label + '</option>';
      }).join('');

      loadReport(filtered[0].module + '::' + filtered[0].folder);
    }

    function formatDate(folder) {
      const p = folder.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})$/);
      if (!p) return folder;
      const utc = new Date(Date.UTC(+p[1], +p[2]-1, +p[3], +p[4], +p[5], +p[6]));
      const ist = new Date(utc.getTime() + 5.5 * 60 * 60 * 1000);
      const dd = String(ist.getUTCDate()).padStart(2, '0');
      const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = ist.getUTCFullYear();
      var hr = ist.getUTCHours();
      const ampm = hr >= 12 ? 'PM' : 'AM';
      hr = hr % 12 || 12;
      const hh = String(hr).padStart(2, '0');
      const mi = String(ist.getUTCMinutes()).padStart(2, '0');
      const ss = String(ist.getUTCSeconds()).padStart(2, '0');
      return dd + '/' + mm + '/' + yyyy + '  ' + hh + ':' + mi + ':' + ss + ' ' + ampm;
    }

    function timeAgo(folder) {
      const p = folder.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})$/);
      if (!p) return '';
      const d = new Date(Date.UTC(+p[1], +p[2]-1, +p[3], +p[4], +p[5], +p[6]));
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (sec < 60) return 'just now';
      if (sec < 3600) return Math.floor(sec/60) + ' min ago';
      if (sec < 86400) return Math.floor(sec/3600) + ' hours ago';
      return Math.floor(sec/86400) + ' days ago';
    }

    function formatDuration(ms) {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms/1000).toFixed(1) + 's';
      return (ms/60000).toFixed(1) + 'm';
    }

    function loadReport(key) {
      const [mod, folder] = key.split('::');
      const report = allReports.find(r => r.module === mod && r.folder === folder);
      if (!report) return;

      const hasFail = report.stats.failed > 0;
      document.getElementById('reportInfo').innerHTML =
        '<span class="status-dot ' + (hasFail ? 'fail' : 'ok') + '"></span> ' + timeAgo(folder);

      const s = report.stats;
      const passRate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
      const failRate = s.total > 0 ? Math.round((s.failed / s.total) * 100) : 0;
      const skipRate = s.total > 0 ? Math.round((s.skipped / s.total) * 100) : 0;

      let html = '';

      // Stat cards
      html += '<div class="stats-grid">' +
        '<div class="stat-card stat-passed"><div class="stat-label">Passed</div><div class="stat-value">' + s.passed + '</div></div>' +
        '<div class="stat-card stat-failed' + (s.failed > 0 ? ' has-failures' : '') + '"><div class="stat-label">Failed</div><div class="stat-value">' + s.failed + '</div></div>' +
        '<div class="stat-card stat-skipped"><div class="stat-label">Skipped</div><div class="stat-value">' + s.skipped + '</div></div>' +
        '<div class="stat-card stat-total"><div class="stat-label">Total</div><div class="stat-value">' + s.total + '</div></div>' +
        '<div class="stat-card stat-duration"><div class="stat-label">Duration</div><div class="stat-value">' + formatDuration(s.duration) + '</div></div>' +
      '</div>';

      // Pass rate bar
      html += '<div class="pass-rate-container">' +
        '<div class="pass-rate-bar">' +
          '<div class="pass-rate-fill-passed" style="width:' + passRate + '%"></div>' +
          '<div class="pass-rate-fill-failed" style="width:' + failRate + '%"></div>' +
          '<div class="pass-rate-fill-skipped" style="width:' + skipRate + '%"></div>' +
        '</div>' +
        '<div class="pass-rate-text"><strong>' + passRate + '%</strong> pass rate' +
          (s.failed > 0 ? ' &middot; <span style="color:var(--red-dark)">' + s.failed + ' failed</span>' : '') +
          (s.skipped > 0 ? ' &middot; <span style="color:var(--amber-dark)">' + s.skipped + ' skipped</span>' : '') +
        '</div>' +
      '</div>';

      if (report.tests.length === 0) {
        html += '<div class="empty-state">' +
          '<div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5h6"/></svg></div>' +
          '<div class="empty-title">No test data for this report</div>' +
          '<div class="empty-subtitle">Reports before the dashboard update have no detailed data</div>' +
        '</div>';
        document.getElementById('content').innerHTML = html;
        return;
      }

      // Group by suite
      const suites = {};
      for (const test of report.tests) {
        const suite = test.suite || 'Other';
        if (!suites[suite]) suites[suite] = [];
        suites[suite].push(test);
      }

      for (const [suiteName, tests] of Object.entries(suites)) {
        const suiteId = 's' + Math.random().toString(36).slice(2, 8);
        const sp = tests.filter(t => t.status === 'passed').length;
        const sf = tests.filter(t => t.status === 'failed').length;
        const ss = tests.filter(t => t.status === 'skipped' || t.status === 'pending').length;

        let statsHtml = '<span class="s-passed">' + sp + ' passed</span>';
        if (sf > 0) statsHtml += '<span class="s-failed">' + sf + ' failed</span>';
        if (ss > 0) statsHtml += '<span>' + ss + ' skipped</span>';

        html += '<div class="suite-group">' +
          '<div class="suite-header" onclick="toggleSuite(\\'' + suiteId + '\\')" tabindex="0" onkeydown="if(event.key === \\'Enter\\' || event.key === \\' \\') { event.preventDefault(); toggleSuite(\\'' + suiteId + '\\'); }">' +
            '<div class="suite-header-left">' +
              '<div class="suite-chevron open" id="chev-' + suiteId + '"></div>' +
              '<div class="suite-name">' + escHtml(suiteName) + '</div>' +
            '</div>' +
            '<div class="suite-stats">' + statsHtml + '</div>' +
          '</div>' +
          '<div class="suite-body" id="suite-' + suiteId + '">';

        for (const test of tests) {
          const tid = 't' + Math.random().toString(36).slice(2, 8);
          const statusClass = 'status-' + test.status;

          let detailHtml = '';
          if (test.screenshots && test.screenshots.length > 0) {
            detailHtml += '<div class="screenshots">' + test.screenshots.map(function(s) {
              return '<img class="screenshot-thumb" src="/screenshot/' + s + '" onclick="event.stopPropagation(); openModal(this.src)" loading="lazy" />';
            }).join('') + '</div>';
          }
          if (test.failureMessages && test.failureMessages.length > 0) {
            detailHtml += '<div class="failure-msg">' + test.failureMessages.join('\\n').replace(/</g, '&lt;') + '</div>';
          }
          if (!detailHtml) {
            detailHtml = '<div class="no-details">No additional details</div>';
          }

          html += '<div class="test-row ' + statusClass + '" onclick="toggleTest(\\'' + tid + '\\')" tabindex="0" onkeydown="if(event.key === \\'Enter\\' || event.key === \\' \\') { event.preventDefault(); toggleTest(\\'' + tid + '\\'); }">' +
              '<div class="test-dot ' + test.status + '"></div>' +
              '<div class="test-name">' + escHtml(test.title) + '</div>' +
              '<div class="test-duration">' + formatDuration(test.duration) + '</div>' +
              '<div class="test-arrow" id="arrow-' + tid + '"></div>' +
            '</div>' +
            '<div class="test-detail" id="detail-' + tid + '">' + detailHtml + '</div>';
        }

        html += '</div></div>';
      }

      document.getElementById('content').innerHTML = html;
    }

    function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function toggleTest(id) {
      document.getElementById('detail-' + id).classList.toggle('open');
      document.getElementById('arrow-' + id).classList.toggle('open');
    }

    function toggleSuite(id) {
      document.getElementById('suite-' + id).classList.toggle('collapsed');
      document.getElementById('chev-' + id).classList.toggle('open');
    }

    function openModal(src) {
      document.getElementById('modalImg').src = src;
      document.getElementById('modal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('open');
    }

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

    init();
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (url.pathname === '/api/reports') {
    try {
      const data = fs.readFileSync(REPORTS_JSON, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  if (url.pathname.startsWith('/screenshot/')) {
    const relative = decodeURIComponent(url.pathname.replace('/screenshot/', ''));
    const filePath = path.resolve(E2E_ROOT, relative);

    if (!filePath.startsWith(E2E_ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': getMime(filePath), 'Cache-Control': 'public, max-age=86400' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  Port ${PORT} already in use — dashboard may already be running at http://localhost:${PORT}\n`);
    console.log(`  To restart: kill the process on port ${PORT} and run again.\n`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  E2E Report Dashboard: http://localhost:${PORT}\n`);
});
