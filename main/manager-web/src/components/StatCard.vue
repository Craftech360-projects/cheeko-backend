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
  background: #fff;
  border: 1px solid $border-color;
  border-radius: 12px;
  padding: 14px 16px 10px;
  min-width: 0;
  box-shadow: 0 4px 14px rgba(61, 69, 102, 0.05);
}

.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat-label {
  font-size: 12px;
  color: $text-gray;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-delta {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;

  &.delta-good { color: #006300; }
  &.delta-bad { color: #d03b3b; }
  &.delta-flat { color: $text-gray; }
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: $text-dark;
  font-variant-numeric: tabular-nums;
}

.stat-sub {
  font-size: 11px;
  color: $text-gray;
  white-space: nowrap;
}

.stat-sparkline {
  margin-top: 6px;
}
</style>
