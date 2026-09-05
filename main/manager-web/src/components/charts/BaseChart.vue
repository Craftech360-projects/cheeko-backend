<template>
  <div ref="chartEl" class="base-chart" :style="{ height: height, width: '100%' }"></div>
</template>

<script>
// Thin echarts wrapper: init on mount, setOption on prop change, resize with
// the container, dispose on destroy. echarts is imported via echarts/core so
// only the chart types actually used get bundled (see charts/presets.js).
import { init, dispose } from 'echarts/core';

export default {
  name: 'BaseChart',
  props: {
    option: { type: Object, required: true },
    height: { type: String, default: '260px' }
  },
  data() {
    return { chart: null, resizeObserver: null };
  },
  watch: {
    option: {
      deep: true,
      handler(next) {
        if (this.chart) this.chart.setOption(next, true);
      }
    }
  },
  mounted() {
    this.chart = init(this.$refs.chartEl);
    this.chart.setOption(this.option);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.chart) this.chart.resize();
      });
      this.resizeObserver.observe(this.$refs.chartEl);
    }
  },
  beforeDestroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.chart) dispose(this.$refs.chartEl);
    this.chart = null;
  }
}
</script>

<style scoped>
.base-chart {
  min-width: 0;
}
</style>
