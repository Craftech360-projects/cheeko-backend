// echarts/core registration + shared option presets for the dashboard.
// Importing through echarts/core keeps the bundle to the chart types we use.
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

let registered = false;
export function ensureEcharts() {
  if (registered) return;
  echarts.use([
    LineChart,
    BarChart,
    PieChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    TitleComponent,
    CanvasRenderer
  ]);
  registered = true;
}

// Categorical palette from FOUNDER_DASHBOARD_SPEC §4 — always assigned by
// feature, never cycled.
export const SERIES_COLORS = {
  aiTalk: '#eb6834',      // AI conversations
  card: '#2a78d6',        // Story & rhyme cards
  game: '#008300',        // Games
  radio: '#4a3aa7',       // Radio
  neutral: '#D47800'
};

export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b'
};

export function sparklineOption(values, color = SERIES_COLORS.neutral) {
  return {
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: 'category', show: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    animation: false,
    series: [{
      type: 'line',
      data: values,
      symbol: 'none',
      lineStyle: { color, width: 1.6 },
      areaStyle: { color, opacity: 0.12 }
    }]
  };
}

export function stackedAreaOption(dates, series, { unit = 'min' } = {}) {
  return {
    grid: { left: 42, right: 12, top: 28, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => `${v} ${unit}`
    },
    legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#8a8fa3' },
      axisLine: { lineStyle: { color: '#e4e6ef' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#8a8fa3' },
      splitLine: { lineStyle: { color: '#f0f1f7' } }
    },
    series: series.map(s => ({
      name: s.name,
      type: 'line',
      stack: 'total',
      data: s.data,
      symbol: 'none',
      lineStyle: { width: 0 },
      areaStyle: { color: s.color, opacity: 0.85 },
      emphasis: { focus: 'series' }
    }))
  };
}

export function barOption(categories, values, { color = SERIES_COLORS.neutral, unit = '' } = {}) {
  return {
    grid: { left: 42, right: 12, top: 16, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}${unit ? ' ' + unit : ''}` },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { fontSize: 10, color: '#8a8fa3', interval: 0, rotate: categories.length > 6 ? 24 : 0 },
      axisLine: { lineStyle: { color: '#e4e6ef' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#8a8fa3' },
      splitLine: { lineStyle: { color: '#f0f1f7' } }
    },
    series: [{
      type: 'bar',
      data: values,
      itemStyle: { color, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 26
    }]
  };
}
