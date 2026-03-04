/**
 * Utility helpers for the dashboard
 */

const Utils = {
  // Status color system — maps pass rate to visual treatment
  getStatusColor(pct) {
    if (pct >= 95) return {
      bg: '#10b981',
      text: '#065f46',
      light: '#d1fae5',
      label: 'Excellent'
    };
    if (pct >= 80) return {
      bg: '#f59e0b',
      text: '#92400e',
      light: '#fef3c7',
      label: 'Warning'
    };
    return {
      bg: '#ef4444',
      text: '#991b1b',
      light: '#fee2e2',
      label: 'Critical'
    };
  },

  // Format duration — human readable
  formatDuration(ms) {
    if (!ms || ms === 0) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  },

  // Format date — readable for founders
  formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  // Short date for chart labels
  shortDate(isoString) {
    const d = new Date(isoString);
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const day = d.getDate();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${day}, ${hour}:${min}`;
  },

  // Group tests by ancestor (category/describe block)
  groupTestsByCategory(tests) {
    const groups = {};
    for (const test of tests) {
      const category = (test.ancestorTitles && test.ancestorTitles[0]) || 'Uncategorized';
      if (!groups[category]) {
        groups[category] = { name: category, tests: [], passed: 0, failed: 0, skipped: 0, totalTime: 0 };
      }
      groups[category].tests.push(test);
      if (test.status === 'passed') groups[category].passed++;
      else if (test.status === 'failed') groups[category].failed++;
      else groups[category].skipped++;
      groups[category].totalTime += (test.durationMs || 0);
    }
    return Object.values(groups);
  },

  // Compute percentile from array
  percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  },

  // Service display names and colors
  serviceInfo: {
    'manager-api': { name: 'Manager API', color: '#3b82f6', light: '#dbeafe' },
    'mqtt-gateway': { name: 'MQTT Gateway', color: '#f97316', light: '#ffedd5' },
    'livekit-server': { name: 'LiveKit Server', color: '#8b5cf6', light: '#ede9fe' },
    'unknown': { name: 'Other', color: '#6b7280', light: '#f1f5f9' }
  },

  getServiceInfo(serviceKey) {
    return this.serviceInfo[serviceKey] || this.serviceInfo['unknown'];
  },

  // Group categories by service
  groupCategoriesByService(categories) {
    const groups = {};
    for (const cat of categories) {
      const svc = cat.service || 'manager-api';
      if (!groups[svc]) groups[svc] = { service: svc, categories: [], passed: 0, failed: 0, total: 0 };
      groups[svc].categories.push(cat);
      groups[svc].passed += cat.passed;
      groups[svc].failed += cat.failed;
      groups[svc].total += cat.passed + cat.failed + cat.skipped;
    }
    return groups;
  },

  // Get unique services from tests
  getServicesFromTests(tests) {
    const services = new Set();
    for (const t of tests) {
      services.add(t.service || 'manager-api');
    }
    return [...services];
  },

  // Group tests by category, preserving service info
  groupTestsByCategory(tests) {
    const groups = {};
    for (const test of tests) {
      const category = (test.ancestorTitles && test.ancestorTitles[0]) || 'Uncategorized';
      if (!groups[category]) {
        groups[category] = {
          name: category,
          service: test.service || 'manager-api',
          tests: [],
          passed: 0,
          failed: 0,
          skipped: 0,
          totalTime: 0
        };
      }
      groups[category].tests.push(test);
      if (test.status === 'passed') groups[category].passed++;
      else if (test.status === 'failed') groups[category].failed++;
      else groups[category].skipped++;
      groups[category].totalTime += (test.durationMs || 0);
    }
    return Object.values(groups);
  },

  // Safe HTML escape
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
