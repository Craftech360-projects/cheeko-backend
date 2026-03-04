/**
 * UI Components — Founder-Friendly Design
 *
 * Big numbers, clear hierarchy, zero clutter.
 * Every element answers: "Are we healthy?"
 */

const Components = {

  /**
   * Hero scorecard row — the first thing founders see.
   * Giant pass rate on the left, 3 stat cards on the right.
   */
  renderScorecards(container, summary, meta) {
    const pct = summary.successRate;
    const statusColor = Utils.getStatusColor(pct);
    const isAllPassed = summary.failed === 0;

    // Determine hero gradient based on health
    let heroGradient, heroAccent;
    if (pct >= 95) {
      heroGradient = 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)';
      heroAccent = 'rgba(16, 185, 129, 0.2)';
    } else if (pct >= 80) {
      heroGradient = 'linear-gradient(135deg, #451a03 0%, #78350f 50%, #92400e 100%)';
      heroAccent = 'rgba(245, 158, 11, 0.2)';
    } else {
      heroGradient = 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 50%, #991b1b 100%)';
      heroAccent = 'rgba(239, 68, 68, 0.2)';
    }

    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <!-- Hero: Pass Rate -->
        <div class="lg:col-span-4 hero-scorecard" style="background: ${heroGradient}">
          <div style="position:absolute;top:-50%;right:-20%;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle, ${heroAccent} 0%, transparent 70%)"></div>
          <div class="relative">
            <div class="flex items-center gap-2 mb-3">
              <svg class="w-5 h-5" style="color: ${statusColor.bg}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                ${pct >= 95
                  ? '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>'
                  : '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>'}
              </svg>
              <span class="text-xs font-semibold uppercase tracking-wider" style="color: ${statusColor.bg}">${statusColor.label}</span>
            </div>
            <div class="hero-rate" style="color: ${statusColor.bg}">${pct}%</div>
            <div class="hero-label">Pass Rate</div>
            <div class="mt-4 flex items-center gap-3">
              <div class="stat-progress" style="background: rgba(255,255,255,0.1)">
                <div class="stat-progress-fill" style="width: ${pct}%; background: ${statusColor.bg}"></div>
              </div>
              <span class="text-xs font-mono" style="color: rgba(255,255,255,0.5)">${summary.passed}/${summary.total}</span>
            </div>
          </div>
        </div>

        <!-- Right: 3 Stat Cards -->
        <div class="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-5">
          <!-- Passed -->
          <div class="stat-card">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: ${isAllPassed ? '#ecfdf5' : '#f0fdf4'}">
                <svg class="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                </svg>
              </div>
              ${isAllPassed ? '<span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">ALL PASS</span>' : ''}
            </div>
            <div class="stat-value text-emerald-600">${summary.passed}</div>
            <div class="stat-label">Tests Passed</div>
            <div class="stat-progress">
              <div class="stat-progress-fill" style="width: ${(summary.passed / summary.total * 100)}%; background: var(--color-pass)"></div>
            </div>
          </div>

          <!-- Failed -->
          <div class="stat-card" ${summary.failed > 0 ? 'style="border-color: #fca5a5"' : ''}>
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: ${summary.failed > 0 ? '#fef2f2' : '#f8fafc'}">
                <svg class="w-5 h-5 ${summary.failed > 0 ? 'text-red-500' : 'text-slate-300'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </div>
              ${summary.failed > 0 ? `<span class="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">NEEDS FIX</span>` : ''}
            </div>
            <div class="stat-value ${summary.failed > 0 ? 'text-red-500' : 'text-slate-300'}">${summary.failed}</div>
            <div class="stat-label">Tests Failed</div>
            <div class="stat-meta">
              ${summary.skipped ? `${summary.skipped} skipped` : 'No skipped tests'}
            </div>
          </div>

          <!-- Duration -->
          <div class="stat-card">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-sky-50">
                <svg class="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
            </div>
            <div class="stat-value text-sky-600">${Utils.formatDuration(meta.durationMs)}</div>
            <div class="stat-label">Total Duration</div>
            <div class="stat-meta">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"/>
              </svg>
              <span>${meta.environment} server</span>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // Track which category detail panel is open
  _openCatIdx: null,
  _categories: [],
  _serviceFilter: 'all',

  /**
   * Service Tabs — tab bar above category grid
   */
  renderServiceTabs(container, services, allCategories, activeService) {
    // Only show tabs if there's more than 1 service (or always show for future-proofing)
    const serviceGroups = Utils.groupCategoriesByService(allCategories);
    const serviceKeys = Object.keys(serviceGroups);

    // If only 1 service, still show tab bar so UI is consistent when more are added
    let html = '<div class="service-tabs">';

    // "All Services" tab
    const allTotal = allCategories.reduce((s, c) => s + c.passed + c.failed + c.skipped, 0);
    const allPassed = allCategories.reduce((s, c) => s + c.passed, 0);
    const allPct = allTotal > 0 ? ((allPassed / allTotal) * 100).toFixed(0) : 0;
    const allColor = Utils.getStatusColor(parseFloat(allPct));

    html += `
      <button class="service-tab ${activeService === 'all' ? 'active' : ''}"
              onclick="App.onServiceChange('all')">
        <span class="service-tab-dot" style="background: ${allColor.bg}"></span>
        <span class="service-tab-name">All Services</span>
        <span class="service-tab-count">${allCategories.length}</span>
      </button>
    `;

    // Per-service tabs
    for (const svcKey of serviceKeys) {
      const svc = serviceGroups[svcKey];
      const info = Utils.getServiceInfo(svcKey);
      const svcTotal = svc.total;
      const svcPct = svcTotal > 0 ? ((svc.passed / svcTotal) * 100).toFixed(0) : 0;
      const svcColor = Utils.getStatusColor(parseFloat(svcPct));

      html += `
        <button class="service-tab ${activeService === svcKey ? 'active' : ''}"
                onclick="App.onServiceChange('${svcKey}')">
          <span class="service-tab-dot" style="background: ${info.color}"></span>
          <span class="service-tab-name">${info.name}</span>
          <span class="service-tab-count">${svc.categories.length}</span>
        </button>
      `;
    }

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Category Card Grid — compact cards with SVG progress rings.
   * Click a card to expand a detail table below it.
   * When serviceFilter = 'all' and multiple services exist, show grouped sections.
   */
  renderAccordion(container, categories, serviceFilter) {
    this._categories = categories;
    this._openCatIdx = null;
    this._serviceFilter = serviceFilter || 'all';

    const countEl = document.getElementById('category-count');
    if (countEl) countEl.textContent = `${categories.length} categories`;

    // Check if we need grouped view (all services, multiple services present)
    const services = [...new Set(categories.map(c => c.service || 'manager-api'))];

    if (this._serviceFilter === 'all' && services.length > 1) {
      this._renderGroupedGrid(container, categories, services);
    } else {
      this._renderGrid(container);
    }
  },

  /**
   * Grouped grid: service section headers + card grids per service
   */
  _renderGroupedGrid(container, categories, services) {
    let html = '';
    let globalIdx = 0;

    for (const svcKey of services) {
      const svcCats = categories.filter(c => (c.service || 'manager-api') === svcKey);
      if (svcCats.length === 0) continue;

      const info = Utils.getServiceInfo(svcKey);
      const svcTotal = svcCats.reduce((s, c) => s + c.passed + c.failed + c.skipped, 0);
      const svcPassed = svcCats.reduce((s, c) => s + c.passed, 0);
      const svcPct = svcTotal > 0 ? ((svcPassed / svcTotal) * 100).toFixed(1) : 0;
      const svcColor = Utils.getStatusColor(parseFloat(svcPct));

      html += `
        <div class="service-section-header">
          <span class="service-tab-dot" style="background: ${info.color}; width: 10px; height: 10px"></span>
          <h3>${info.name}</h3>
          <span class="service-section-badge" style="background: ${svcColor.light}; color: ${svcColor.bg}">${svcPct}%</span>
          <span class="service-section-meta">${svcCats.length} categories &middot; ${svcPassed}/${svcTotal} tests</span>
        </div>
      `;

      html += '<div class="cat-grid" style="margin-bottom: 24px;">';

      for (const cat of svcCats) {
        html += this._renderCardHtml(cat, globalIdx);

        if (this._openCatIdx === globalIdx) {
          html += this._renderDetailPanel(cat, globalIdx);
        }
        globalIdx++;
      }

      html += '</div>';
    }

    container.innerHTML = html;
  },

  _renderGrid(container) {
    const categories = this._categories;
    let html = '<div class="cat-grid" id="cat-grid">';

    categories.forEach((cat, idx) => {
      html += this._renderCardHtml(cat, idx);

      if (this._openCatIdx === idx) {
        html += this._renderDetailPanel(cat, idx);
      }
    });

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Render a single category card (shared between flat and grouped views)
   */
  _renderCardHtml(cat, idx) {
    const total = cat.passed + cat.failed + cat.skipped;
    const pct = total > 0 ? ((cat.passed / total) * 100).toFixed(1) : 0;
    const pctNum = parseFloat(pct);
    const statusColor = Utils.getStatusColor(pctNum);
    const hasFailed = cat.failed > 0;
    const isActive = this._openCatIdx === idx;

    // SVG progress ring math (radius=22, circumference=2*PI*22=138.23)
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pctNum / 100) * circumference;

    return `
      <div class="cat-card ${hasFailed ? 'has-failures' : ''} ${isActive ? 'active' : ''}"
           onclick="Components.toggleCard(${idx})" role="button" tabindex="0"
           aria-label="${cat.name}: ${pct}% pass rate, ${cat.passed} of ${total} tests passed">
        ${hasFailed ? `<span class="cat-fail-badge">${cat.failed} fail</span>` : ''}
        <div class="cat-card-top">
          <div class="progress-ring">
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle class="progress-ring-bg" cx="28" cy="28" r="${radius}"/>
              <circle class="progress-ring-fill" cx="28" cy="28" r="${radius}"
                stroke="${statusColor.bg}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"/>
            </svg>
            <span class="progress-ring-text" style="color: ${statusColor.bg}">${Math.round(pctNum)}</span>
          </div>
          <div class="cat-card-info">
            <div class="cat-card-name">${Utils.escapeHtml(cat.name)}</div>
            <div class="cat-card-meta">
              <span class="mono">${cat.passed}/${total}</span>
              <span>${Utils.formatDuration(cat.totalTime)}</span>
            </div>
          </div>
        </div>
        <div class="cat-card-bar">
          <div class="cat-card-bar-fill" style="width: ${pct}%; background: ${statusColor.bg}"></div>
        </div>
      </div>
    `;
  },

  _renderDetailPanel(cat, idx) {
    const total = cat.passed + cat.failed + cat.skipped;
    const pct = total > 0 ? ((cat.passed / total) * 100).toFixed(1) : 0;
    const statusColor = Utils.getStatusColor(parseFloat(pct));

    return `
      <div class="cat-detail-panel" id="cat-detail-${idx}">
        <div class="cat-detail-header">
          <div class="flex items-center gap-3">
            <h3>${Utils.escapeHtml(cat.name)}</h3>
            <span class="text-xs font-mono px-2 py-0.5 rounded-full" style="background: ${statusColor.light}; color: ${statusColor.bg}; font-weight: 700">${pct}%</span>
            <span class="text-xs text-slate-400">${cat.passed} passed, ${cat.failed} failed, ${Utils.formatDuration(cat.totalTime)}</span>
          </div>
          <button class="cat-detail-close" onclick="event.stopPropagation(); Components.closeDetail()" title="Close">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          <table class="test-table">
            <thead>
              <tr>
                <th style="width:48px">#</th>
                <th>Test Name</th>
                <th style="width:80px">Status</th>
                <th style="width:80px;text-align:right">Time</th>
              </tr>
            </thead>
            <tbody>
              ${cat.tests.map((t, ti) => {
                const isPass = t.status === 'passed';
                const isFail = t.status === 'failed';
                return `
                  <tr class="${isFail ? 'row-fail' : ''}">
                    <td class="text-slate-400 font-mono text-xs">${ti + 1}</td>
                    <td>
                      <div class="text-slate-700 text-sm">${Utils.escapeHtml(t.name)}</div>
                      ${isFail && t.failureMessages && t.failureMessages[0]
                        ? `<div class="text-xs text-red-500 mt-1 font-mono truncate max-w-lg">${Utils.escapeHtml(t.failureMessages[0].split('\n')[0])}</div>`
                        : ''}
                    </td>
                    <td>
                      <span class="status-pill ${isPass ? 'status-pill-pass' : isFail ? 'status-pill-fail' : ''}">
                        ${isPass
                          ? '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
                          : isFail
                          ? '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>'
                          : ''}
                        ${isPass ? 'pass' : isFail ? 'fail' : t.status}
                      </span>
                    </td>
                    <td class="text-right font-mono text-xs text-slate-400">${t.durationMs || 0}ms</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  toggleCard(idx) {
    const container = document.getElementById('category-accordion');
    if (this._openCatIdx === idx) {
      this._openCatIdx = null;
    } else {
      this._openCatIdx = idx;
    }
    this._rerender(container);

    // Scroll to the detail panel if opened
    if (this._openCatIdx !== null) {
      setTimeout(() => {
        const panel = document.getElementById(`cat-detail-${idx}`);
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  },

  closeDetail() {
    this._openCatIdx = null;
    const container = document.getElementById('category-accordion');
    this._rerender(container);
  },

  _rerender(container) {
    const services = [...new Set(this._categories.map(c => c.service || 'manager-api'))];
    if (this._serviceFilter === 'all' && services.length > 1) {
      this._renderGroupedGrid(container, this._categories, services);
    } else {
      this._renderGrid(container);
    }
  },

  /**
   * Failed tests — prominent red panel or green success banner
   */
  renderFailedTests(container, tests) {
    const failed = tests.filter(t => t.status === 'failed');

    if (failed.length === 0) {
      container.innerHTML = `
        <div class="all-passed-banner">
          <div class="check-icon">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
            </svg>
          </div>
          <div class="text-lg font-bold text-emerald-800">All Tests Passed</div>
          <div class="text-sm text-emerald-600 mt-1">Every endpoint is responding correctly</div>
        </div>
      `;
      return;
    }

    let html = `
      <div class="failed-panel">
        <div class="failed-panel-header">
          <svg class="w-5 h-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          <span class="text-sm font-bold text-red-800">${failed.length} Failed Test${failed.length > 1 ? 's' : ''} — Requires Attention</span>
        </div>
        <table class="test-table">
          <thead>
            <tr>
              <th style="width:48px">#</th>
              <th>Category</th>
              <th>Test Name</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
    `;

    failed.forEach((t, i) => {
      const category = (t.ancestorTitles && t.ancestorTitles[0]) || '-';
      const error = t.failureMessages && t.failureMessages[0]
        ? t.failureMessages[0].split('\n')[0]
        : 'Unknown error';

      html += `
        <tr class="row-fail">
          <td class="font-mono text-xs text-red-400">${i + 1}</td>
          <td class="text-red-700 font-semibold text-sm">${Utils.escapeHtml(category)}</td>
          <td class="text-red-800 text-sm">${Utils.escapeHtml(t.name)}</td>
          <td class="text-red-600 font-mono text-xs truncate max-w-xs">${Utils.escapeHtml(error)}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  /**
   * Run selector dropdown — clean, minimal
   */
  renderRunSelector(container, history, selectedRunId) {
    const items = [...history].reverse();
    let html = `<select id="run-selector" onchange="App.onRunSelect(this.value)" class="run-select">`;

    items.forEach(h => {
      const selected = h.runId === selectedRunId ? 'selected' : '';
      const indicator = h.successRate >= 95 ? 'OK' : h.successRate >= 80 ? 'WARN' : 'FAIL';
      html += `<option value="${h.runId}" ${selected}>${Utils.formatDate(h.timestamp)} — ${h.successRate}% [${indicator}]</option>`;
    });

    html += '</select>';
    container.innerHTML = html;
  },

  /**
   * Empty state — when no reports exist
   */
  renderEmpty(container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"/>
          </svg>
        </div>
        <h3 class="text-lg font-bold text-slate-500 mb-2">No Test Reports Yet</h3>
        <p class="text-sm text-slate-400 max-w-md mx-auto mb-4">
          Run your first test suite to see results here.
        </p>
        <code class="inline-block bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-sm font-mono">
          cd main/api-tests && npm test
        </code>
      </div>
    `;
  }
};
