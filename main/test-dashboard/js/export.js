/**
 * Export functionality
 *
 * PDF (window.print), HTML (self-contained), JSON (raw data)
 */

const Export = {
  downloadPDF() {
    window.print();
  },

  downloadJSON(report) {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-report-${report.meta.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadHTML(report) {
    if (!report) return;

    const categories = Utils.groupTestsByCategory(report.tests);
    const failed = report.tests.filter(t => t.status === 'failed');
    const statusColor = Utils.getStatusColor(report.summary.successRate);
    const isAllPassed = report.summary.failed === 0;

    let html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Cheeko Test Report — ${report.meta.runId}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 40px 32px; color: #0f172a; background: #fff; }
  .mono { font-family: 'JetBrains Mono', monospace; }

  /* Header */
  .report-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
  .report-header h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
  .report-meta { display: flex; gap: 16px; font-size: 13px; color: #64748b; flex-wrap: wrap; }
  .report-meta span { display: flex; align-items: center; gap: 4px; }

  /* Scorecards */
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  .card-value { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; line-height: 1; }
  .card-label { font-size: 13px; color: #64748b; margin-top: 6px; font-weight: 500; }

  .green { color: #10b981; } .red { color: #ef4444; } .blue { color: #0ea5e9; }

  /* Section */
  h2 { font-size: 16px; font-weight: 700; color: #0f172a; margin: 32px 0 12px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
  th { text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #f8fafc; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; }
  .fail-row { background: #fef2f2; }
  .pass-badge { color: #10b981; font-weight: 600; font-size: 12px; background: #d1fae5; padding: 2px 8px; border-radius: 4px; }
  .fail-badge { color: #ef4444; font-weight: 600; font-size: 12px; background: #fee2e2; padding: 2px 8px; border-radius: 4px; }
  .error-msg { color: #ef4444; font-size: 11px; font-family: 'JetBrains Mono', monospace; margin-top: 4px; }

  /* Category header */
  .cat-header { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 14px; }
  .cat-badge { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 12px; }

  /* Success banner */
  .success-banner { background: linear-gradient(135deg, #ecfdf5, #d1fae5); border: 1px solid #a7f3d0; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; }
  .success-banner .title { font-size: 18px; font-weight: 700; color: #065f46; }
  .success-banner .subtitle { font-size: 13px; color: #059669; margin-top: 4px; }

  /* Footer */
  .report-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
</style>
</head><body>

<div class="report-header">
  <h1>Cheeko API Test Report</h1>
  <div class="report-meta">
    <span><strong>Run:</strong> ${report.meta.runId}</span>
    <span><strong>Env:</strong> ${report.meta.environment.toUpperCase()}</span>
    <span><strong>Date:</strong> ${Utils.formatDate(report.meta.timestamp)}</span>
    <span><strong>Duration:</strong> ${Utils.formatDuration(report.meta.durationMs)}</span>
  </div>
</div>

<div class="cards">
  <div class="card">
    <div class="card-value" style="color:${statusColor.bg}">${report.summary.successRate}%</div>
    <div class="card-label">Pass Rate</div>
  </div>
  <div class="card">
    <div class="card-value green">${report.summary.passed}</div>
    <div class="card-label">Passed</div>
  </div>
  <div class="card">
    <div class="card-value ${report.summary.failed > 0 ? 'red' : ''}" style="${report.summary.failed === 0 ? 'color:#cbd5e1' : ''}">${report.summary.failed}</div>
    <div class="card-label">Failed</div>
  </div>
  <div class="card">
    <div class="card-value blue">${Utils.formatDuration(report.meta.durationMs)}</div>
    <div class="card-label">Duration</div>
  </div>
</div>`;

    if (isAllPassed) {
      html += `
<div class="success-banner">
  <div class="title">All Tests Passed</div>
  <div class="subtitle">Every endpoint is responding correctly</div>
</div>`;
    }

    if (failed.length > 0) {
      html += `<h2 style="color:#ef4444">Failed Tests (${failed.length})</h2>
<table><tr><th>#</th><th>Category</th><th>Test</th><th>Error</th></tr>`;
      failed.forEach((t, i) => {
        const cat = (t.ancestorTitles && t.ancestorTitles[0]) || '-';
        const err = t.failureMessages && t.failureMessages[0] ? t.failureMessages[0].split('\n')[0] : '';
        html += `<tr class="fail-row"><td>${i+1}</td><td>${Utils.escapeHtml(cat)}</td><td>${Utils.escapeHtml(t.name)}</td><td class="error-msg">${Utils.escapeHtml(err)}</td></tr>`;
      });
      html += '</table>';
    }

    html += '<h2>All Tests by Category</h2>';
    categories.forEach(cat => {
      const total = cat.passed + cat.failed + cat.skipped;
      const pct = total > 0 ? ((cat.passed / total) * 100).toFixed(1) : 0;
      const color = Utils.getStatusColor(parseFloat(pct));

      html += `<div class="cat-header">
        <span>${Utils.escapeHtml(cat.name)}</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="mono" style="font-size:13px">${cat.passed}/${total}</span>
          <span class="cat-badge" style="background:${color.light};color:${color.bg}">${pct}%</span>
        </div>
      </div>`;
      html += '<table><tr><th style="width:40px">#</th><th>Test</th><th style="width:70px">Status</th><th style="width:70px;text-align:right">Time</th></tr>';
      cat.tests.forEach((t, i) => {
        const cls = t.status === 'failed' ? 'fail-row' : '';
        const badge = t.status === 'passed'
          ? '<span class="pass-badge">PASS</span>'
          : t.status === 'failed'
          ? '<span class="fail-badge">FAIL</span>'
          : t.status;
        const error = t.status === 'failed' && t.failureMessages && t.failureMessages[0]
          ? `<div class="error-msg">${Utils.escapeHtml(t.failureMessages[0].split('\n')[0])}</div>`
          : '';
        html += `<tr class="${cls}"><td>${i+1}</td><td>${Utils.escapeHtml(t.name)}${error}</td><td>${badge}</td><td style="text-align:right" class="mono" style="font-size:12px;color:#64748b">${t.durationMs||0}ms</td></tr>`;
      });
      html += '</table>';
    });

    html += `
<div class="report-footer">
  Cheeko Auto-Discovery Test Suite | Generated ${new Date().toISOString()}
</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-report-${report.meta.runId}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
};
