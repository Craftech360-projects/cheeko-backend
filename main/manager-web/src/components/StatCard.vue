<template>
  <div class="stat-card">
    <div class="stat-head">
      <span class="stat-label">{{ label }}</span>
      <span v-if="delta !== null && delta !== undefined" class="stat-delta" :class="deltaClass">
        {{ delta > 0 ? '▲' : delta < 0 ? '▼' : '•' }} {{ Math.abs(delta) }}%
      </span>
    </div>
    <div class="stat-value-row">
      <span class="stat-value">{{ displayValue }}</span>
      <span v-if="sub" class="stat-sub">{{ sub }}</span>
    </div>
    <div class="stat-sparkline">
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'StatCard',
  props: {
    label: { type: String, required: true },
    value: { type: [Number, String], default: null },
    unit: { type: String, default: '' },
    sub: { type: String, default: '' },
    // Percentage change vs the previous period; null hides the arrow
    delta: { type: Number, default: null },
    // For costs, up means bad — flip the colour semantics
    invertDelta: { type: Boolean, default: false }
  },
  computed: {
    displayValue() {
      if (this.value === null || this.value === undefined || this.value === '') return '—';
      return `${this.value}${this.unit}`;
    },
    deltaClass() {
      if (this.delta === null || this.delta === undefined || this.delta === 0) return 'delta-flat';
      const up = this.delta > 0;
      const good = this.invertDelta ? !up : up;
      return good ? 'delta-good' : 'delta-bad';
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.stat-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 22px 24px 18px;
  min-width: 0;
  box-shadow: none;
}

.stat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.stat-label {
  font-family: $font-mono;
  font-size: 9.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
}

.stat-delta {
  font-size: 11.5px;
  font-weight: 560;
  white-space: nowrap;

  &.delta-good { color: $success; }
  &.delta-bad { color: $danger; }
  &.delta-flat { color: $text-light; }
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.stat-value {
  font-family: $font-display;
  font-size: 40px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.03em;
  color: $text-dark;
}

.stat-sub {
  font-size: 11.5px;
  color: $text-light;
  min-width: 0;
}

.stat-sparkline {
  margin-top: 14px;
  min-height: 0;
}
</style>
