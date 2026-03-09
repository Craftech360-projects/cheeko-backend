/**
 * Main Dashboard Application
 *
 * Orchestrates data loading, state, and rendering.
 */

const App = {
  state: {
    history: [],
    currentReport: null,
    currentRunId: null,
    filter: 'all',
    serviceFilter: 'all' // 'all' or specific service key like 'manager-api'
  },

  async init() {
    DataLoader.init('');

    // Load history
    this.state.history = await DataLoader.loadHistory();

    if (this.state.history.length === 0) {
      Components.renderEmpty(document.getElementById('main-content'));
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      return;
    }

    // Check URL hash for specific run, default to latest
    const hash = this.parseHash();
    const runId = hash.run || this.state.history[this.state.history.length - 1].runId;

    await this.loadRun(runId);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
  },

  async loadRun(runId) {
    const report = await DataLoader.loadReport(runId);
    if (!report) return;

    this.state.currentReport = report;
    this.state.currentRunId = runId;
    this.render();
    this.updateHash();
  },

  render() {
    const report = this.state.currentReport;
    if (!report) return;

    // Environment badge
    const badge = document.getElementById('env-badge');
    badge.textContent = report.meta.environment.toUpperCase();
    badge.className = `env-badge ${report.meta.environment === 'prod' ? 'env-badge-prod' : 'env-badge-dev'}`;

    // Footer meta
    const footerMeta = document.getElementById('footer-meta');
    if (footerMeta) {
      footerMeta.textContent = `${Utils.formatDate(report.meta.timestamp)} | ${report.meta.nodeVersion || ''} | ${report.summary.total} tests`;
    }

    // Run selector
    Components.renderRunSelector(
      document.getElementById('run-selector-container'),
      this.state.history,
      this.state.currentRunId
    );

    // Scorecards
    Components.renderScorecards(
      document.getElementById('scorecards'),
      report.summary,
      report.meta
    );

    // Filter tests by status
    let tests = report.tests;
    if (this.state.filter === 'passed') tests = tests.filter(t => t.status === 'passed');
    if (this.state.filter === 'failed') tests = tests.filter(t => t.status === 'failed');

    // Group into categories (preserves service info)
    const allCategories = Utils.groupTestsByCategory(tests);

    // Sort: failed categories first, then by name
    allCategories.sort((a, b) => {
      if (b.failed !== a.failed) return b.failed - a.failed;
      return a.name.localeCompare(b.name);
    });

    // Render service tabs
    const services = Utils.getServicesFromTests(report.tests);
    Components.renderServiceTabs(
      document.getElementById('service-tabs'),
      services,
      allCategories,
      this.state.serviceFilter
    );

    // Filter categories by service
    const categories = this.state.serviceFilter === 'all'
      ? allCategories
      : allCategories.filter(c => c.service === this.state.serviceFilter);

    // Charts
    Charts.renderDonut('chart-donut', report.summary);
    Charts.renderCategoryBar('chart-category', categories);
    Charts.renderTrend('chart-trend', this.state.history);
    Charts.renderResponseTime('chart-response', categories);

    // Category grid (with service grouping if "all")
    Components.renderAccordion(
      document.getElementById('category-accordion'),
      categories,
      this.state.serviceFilter
    );

    // Failed tests
    Components.renderFailedTests(document.getElementById('failed-tests'), report.tests);
  },

  async onRunSelect(runId) {
    await this.loadRun(runId);
  },

  onFilterChange(filter) {
    this.state.filter = filter;

    // Update filter button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById(`filter-${filter}`).classList.add('active');

    this.render();
  },

  onServiceChange(service) {
    this.state.serviceFilter = service;
    this.render();
  },

  onExportPDF() { Export.downloadPDF(); },
  onExportHTML() { Export.downloadHTML(this.state.currentReport); },
  onExportJSON() { Export.downloadJSON(this.state.currentReport); },

  parseHash() {
    const hash = window.location.hash.slice(1);
    const params = {};
    hash.split('&').forEach(part => {
      const [k, v] = part.split('=');
      if (k) params[k] = decodeURIComponent(v || '');
    });
    return params;
  },

  updateHash() {
    if (this.state.currentRunId) {
      window.location.hash = `run=${this.state.currentRunId}`;
    }
  }
};

// Boot
window.addEventListener('DOMContentLoaded', () => App.init());
window.addEventListener('hashchange', () => {
  const hash = App.parseHash();
  if (hash.run && hash.run !== App.state.currentRunId) {
    App.loadRun(hash.run);
  }
});
