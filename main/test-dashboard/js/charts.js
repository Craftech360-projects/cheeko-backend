/**
 * Chart.js — Polished chart configurations
 *
 * Design: Clean, minimal charts with gradient fills.
 * Font: JetBrains Mono for axis labels (data readability).
 */

// Global Chart.js defaults
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#64748b';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = '#0f172a';
Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: '600' };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
Chart.defaults.plugins.tooltip.padding = { top: 10, bottom: 10, left: 14, right: 14 };
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;

const Charts = {
  instances: {},

  destroyAll() {
    Object.values(this.instances).forEach(c => c.destroy());
    this.instances = {};
  },

  /**
   * Donut chart: pass/fail overview with center text plugin
   */
  renderDonut(canvasId, summary) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.instances[canvasId]) this.instances[canvasId].destroy();

    // Center text plugin
    const centerTextPlugin = {
      id: 'centerText',
      afterDraw(chart) {
        const { ctx: c, width, height } = chart;
        c.save();

        // Big number
        c.font = "700 36px 'JetBrains Mono', monospace";
        c.fillStyle = '#0f172a';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${summary.successRate}%`, width / 2, height / 2 - 8);

        // Label
        c.font = "500 12px 'Inter', sans-serif";
        c.fillStyle = '#94a3b8';
        c.fillText('pass rate', width / 2, height / 2 + 18);

        c.restore();
      }
    };

    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      plugins: [centerTextPlugin],
      data: {
        labels: ['Passed', 'Failed', 'Skipped'],
        datasets: [{
          data: [summary.passed, summary.failed, summary.skipped || 0],
          backgroundColor: ['#10b981', '#ef4444', '#cbd5e1'],
          borderWidth: 0,
          hoverOffset: 6,
          borderRadius: 4,
          spacing: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 12, weight: '500' },
              padding: 20,
              generateLabels(chart) {
                const data = chart.data;
                return data.labels.map((label, i) => ({
                  text: `${label}  ${data.datasets[0].data[i]}`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: 'transparent',
                  pointStyle: 'rectRounded',
                  hidden: false,
                  index: i
                }));
              }
            }
          }
        }
      }
    });
  },

  /**
   * Category bar: stacked horizontal bar for quick scanning
   */
  renderCategoryBar(canvasId, categories) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.instances[canvasId]) this.instances[canvasId].destroy();

    const labels = categories.map(c => {
      const name = c.name.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+\/toy\//, '');
      return name.length > 20 ? name.slice(0, 17) + '...' : name;
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Passed',
            data: categories.map(c => c.passed),
            backgroundColor: '#10b981',
            borderRadius: { topLeft: 4, bottomLeft: 4 },
            borderSkipped: false
          },
          {
            label: 'Failed',
            data: categories.map(c => c.failed),
            backgroundColor: '#ef4444',
            borderRadius: { topRight: 4, bottomRight: 4 },
            borderSkipped: false
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 } }
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: {
              font: { size: 11, weight: '500' },
              color: '#334155'
            }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              afterBody(items) {
                const idx = items[0].dataIndex;
                const cat = categories[idx];
                const total = cat.passed + cat.failed;
                const pct = total > 0 ? ((cat.passed / total) * 100).toFixed(1) : 0;
                return `Pass rate: ${pct}%`;
              }
            }
          }
        }
      }
    });
  },

  /**
   * Trend line: pass rate over time with gradient fill
   */
  renderTrend(canvasId, history) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.instances[canvasId]) this.instances[canvasId].destroy();

    const data = history.slice(-30);

    // Create gradient
    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(14, 165, 233, 0.15)');
    gradient.addColorStop(1, 'rgba(14, 165, 233, 0.01)');

    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(h => Utils.shortDate(h.timestamp)),
        datasets: [{
          label: 'Pass Rate',
          data: data.map(h => h.successRate),
          borderColor: '#0ea5e9',
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: data.length <= 10 ? 5 : 3,
          pointHoverRadius: 7,
          pointBackgroundColor: data.map(h => {
            if (h.successRate >= 95) return '#10b981';
            if (h.successRate >= 80) return '#f59e0b';
            return '#ef4444';
          }),
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: {
              callback: v => v + '%',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              stepSize: 25
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              font: { size: 10 },
              maxTicksLimit: 8
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const d = data[ctx.dataIndex];
                return `${ctx.parsed.y}% — ${d.passed}/${d.total} passed`;
              }
            }
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        }
      }
    });
  },

  /**
   * Response time: grouped bar (avg + p95) per category
   */
  renderResponseTime(canvasId, categories) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (this.instances[canvasId]) this.instances[canvasId].destroy();

    const labels = categories.map(c => {
      const name = c.name.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+\/toy\//, '');
      return name.length > 20 ? name.slice(0, 17) + '...' : name;
    });

    const avgTimes = categories.map(c => {
      const times = c.tests.map(t => t.durationMs || 0);
      return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    });

    const p95Times = categories.map(c => {
      const times = c.tests.map(t => t.durationMs || 0);
      return Utils.percentile(times, 95);
    });

    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg',
            data: avgTimes,
            backgroundColor: '#0ea5e9',
            borderRadius: 4,
            barPercentage: 0.7,
            categoryPercentage: 0.6
          },
          {
            label: 'P95',
            data: p95Times,
            backgroundColor: '#c084fc',
            borderRadius: 4,
            barPercentage: 0.7,
            categoryPercentage: 0.6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: {
              callback: v => v + 'ms',
              font: { family: "'JetBrains Mono', monospace", size: 11 }
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 11, weight: '500' },
              color: '#334155'
            }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${ctx.parsed.x}ms`;
              }
            }
          }
        }
      }
    });
  }
};
