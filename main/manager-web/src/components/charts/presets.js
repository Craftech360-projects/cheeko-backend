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

// Categorical palette — always assigned by feature, never cycled.
//
// A four-series chart genuinely needs four distinguishable marks, so this is
// the one place the interface carries more than the single accent. They are
// all held under ~80% saturation and share the warm ground, with one cool ink
// for separation, so the chart still reads as part of the monochrome system.
export const SERIES_COLORS = {
  aiTalk: '#B3560F',      // AI conversations — the accent
  card: '#2C5B7A',        // Story & rhyme cards — cool ink
  game: '#5C6B4A',        // Games — muted olive
  radio: '#8A5D06',       // Radio — ochre
  neutral: '#A8A199'
};

export const STATUS_COLORS = {
  good: '#33613A',
  warning: '#8A5D06',
  serious: '#B3560F',
  critical: '#993129'
};

// Chart furniture, in the warm gray family
const AXIS_LABEL = '#A8A199';
const AXIS_LINE = '#E7E2D9';
const SPLIT_LINE = '#F0ECE5';
const LABEL_FONT = "'SF Mono', Menlo, monospace";

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
      areaStyle: { color, opacity: 0.06 }
    }]
  };
}

export function stackedAreaOption(dates, series, { unit = 'min' } = {}) {
  return {
    grid: { left: 42, right: 12, top: 28, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => `${v} ${unit}`,
      backgroundColor: '#16130F',
      borderWidth: 0,
      textStyle: { color: '#EDE9E2', fontSize: 11 }
    },
    legend: {
      top: 0, left: 0, icon: 'roundRect', itemWidth: 8, itemHeight: 8,
      textStyle: { fontSize: 11, color: '#7A736A' }
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 9, color: AXIS_LABEL, fontFamily: LABEL_FONT },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 9, color: AXIS_LABEL, fontFamily: LABEL_FONT },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
      axisLine: { show: false }
    },
    series: series.map(s => ({
      name: s.name,
      type: 'line',
      stack: 'total',
      data: s.data,
      symbol: 'none',
      lineStyle: { width: 0 },
      areaStyle: { color: s.color, opacity: 0.78 },
      emphasis: { focus: 'series' }
    }))
  };
}

export function barOption(categories, values, { color = SERIES_COLORS.neutral, unit = '' } = {}) {
  return {
    grid: { left: 42, right: 12, top: 16, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => `${v}${unit ? ' ' + unit : ''}`,
      backgroundColor: '#16130F',
      borderWidth: 0,
      textStyle: { color: '#EDE9E2', fontSize: 11 }
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { fontSize: 9, color: AXIS_LABEL, fontFamily: LABEL_FONT, interval: 0, rotate: categories.length > 6 ? 24 : 0 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 9, color: AXIS_LABEL, fontFamily: LABEL_FONT },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
      axisLine: { show: false }
    },
    series: [{
      type: 'bar',
      data: values,
      itemStyle: { color, borderRadius: [2, 2, 0, 0] },
      barMaxWidth: 26
    }]
  };
}
