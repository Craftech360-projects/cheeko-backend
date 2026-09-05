<template>
  <div class="listbar-wrap">
    <div class="listbar">
      <!-- Controls left: they form one chain that narrows the list -->
      <div class="lb-l">
        <span v-if="count !== null && count !== undefined" class="lb-count">{{ countLabel }}</span>

        <div v-if="sortOptions.length" class="lb-control">
          <span class="lb-lab">Sort</span>
          <el-select
            :value="sortBy"
            size="mini"
            placeholder="Sort"
            popper-class="lb-popper"
            @change="onSortChange"
          >
            <el-option
              v-for="opt in sortOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <button
            class="lb-dir"
            :title="sortDir === 'asc' ? 'Ascending' : 'Descending'"
            @click="$emit('update:sortDir', sortDir === 'asc' ? 'desc' : 'asc')"
          >{{ sortDir === 'asc' ? '↑' : '↓' }}</button>
        </div>

        <div v-if="groupOptions.length" class="lb-control">
          <span class="lb-lab">Group</span>
          <el-select
            :value="groupBy"
            size="mini"
            placeholder="None"
            popper-class="lb-popper"
            @change="value => $emit('update:groupBy', value)"
          >
            <el-option
              v-for="opt in groupOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>

        <!-- View-specific filters (status, language, firmware…) -->
        <slot name="filters" />

        <div v-if="views.length > 1" class="lb-control">
          <span class="lb-lab">View</span>
          <div class="lb-seg">
            <button
              v-for="v in views"
              :key="v.value"
              :class="{ on: v.value === view }"
              @click="$emit('update:view', v.value)"
            >{{ v.label }}</button>
          </div>
        </div>

        <button
          v-if="selectable"
          class="lb-select"
          :class="{ on: selecting }"
          @click="$emit('update:selecting', !selecting)"
        >
          <span class="lb-chk" :class="{ some: selecting && selectedCount > 0, all: selecting && allSelected }"></span>
          Select
        </button>

        <slot name="actions" />
      </div>

      <!-- Search right: it jumps to a known row rather than narrowing -->
      <div v-if="searchable" class="lb-r">
        <el-input
          :value="search"
          :placeholder="searchPlaceholder"
          prefix-icon="el-icon-search"
          size="small"
          clearable
          class="lb-search"
          @input="value => $emit('update:search', value)"
        />
      </div>
    </div>

    <!-- Bulk bar appears only with a live selection -->
    <transition name="bulk-fade">
      <div v-if="selectedCount > 0" class="bulkbar">
        <span class="bulk-chk"></span>
        <span class="bulk-n">{{ selectedCount }} selected</span>
        <span class="bulk-x">
          <a v-if="!allSelected && total > selectedCount" @click="$emit('select-all-matching')">Select all matching</a>
          <a @click="$emit('clear-selection')">Clear</a>
        </span>
        <span class="bulk-actions"><slot name="bulk" /></span>
      </div>
    </transition>
  </div>
</template>

<script>
/**
 * The list toolbar every list screen carries: Sort, Group, View and Select on
 * the left, search anchored right, with a bulk action bar that appears when a
 * selection is live.
 *
 * Everything is `.sync`-friendly:
 *   <ListToolbar :sort-by.sync="sortBy" :sort-dir.sync="sortDir" … />
 */
export default {
  name: 'ListToolbar',
  props: {
    // left — sort
    sortOptions: { type: Array, default: () => [] },
    sortBy: { type: String, default: '' },
    sortDir: { type: String, default: 'desc' },

    // left — group
    groupOptions: { type: Array, default: () => [] },
    groupBy: { type: String, default: '' },

    // left — view switch
    views: {
      type: Array,
      default: () => [{ label: 'Table', value: 'table' }]
    },
    view: { type: String, default: 'table' },

    // left — selection
    selectable: { type: Boolean, default: true },
    selecting: { type: Boolean, default: false },
    selectedCount: { type: Number, default: 0 },
    allSelected: { type: Boolean, default: false },

    // right — search
    searchable: { type: Boolean, default: true },
    search: { type: String, default: '' },
    searchPlaceholder: { type: String, default: 'Search' },

    // meta
    count: { type: [Number, String], default: null },
    countNoun: { type: String, default: 'items' },
    total: { type: Number, default: 0 }
  },
  computed: {
    countLabel() {
      if (typeof this.count === 'string') return this.count;
      return `${this.count} ${this.countNoun}`;
    }
  },
  methods: {
    onSortChange(value) {
      this.$emit('update:sortBy', value);
      this.$emit('sort-change', { sortBy: value, sortDir: this.sortDir });
    }
  },
  watch: {
    sortDir(dir) {
      this.$emit('sort-change', { sortBy: this.sortBy, sortDir: dir });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.listbar-wrap { margin-bottom: 14px; }

.listbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.lb-l,
.lb-r {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.lb-l { min-width: 0; }

.lb-count {
  font-family: $font-mono;
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: $text-light;
  margin-right: 4px;
  white-space: nowrap;
}

.lb-lab {
  font-family: $font-mono;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: $text-light;
  padding-right: 2px;
  white-space: nowrap;
}

.lb-control {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $surface;

  ::v-deep .el-input__inner {
    border: 0;
    padding: 0;
    height: 30px;
    line-height: 30px;
    font-size: 12.5px;
    color: $text-dark;
    background: transparent;
    width: 128px;
  }

  ::v-deep .el-input__suffix { right: 0; }
  ::v-deep .el-input__icon { line-height: 30px; width: 18px; color: $text-light; }
}

.lb-dir {
  border: 0;
  background: transparent;
  color: $text-gray;
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;

  &:hover { color: $text-dark; }
}

// Segmented view switch
.lb-seg {
  display: inline-flex;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  overflow: hidden;
  margin: 0 -6px 0 0;

  button {
    padding: 4px 11px;
    font-size: 12px;
    color: $text-gray;
    background: $surface;
    border: 0;
    border-right: 1px solid $border-color;
    cursor: pointer;

    &:last-child { border-right: 0; }
    &:hover { background: $surface-sunk; color: $text-dark; }

    &.on {
      background: $text-dark;
      color: $white;
      font-weight: 500;
    }
  }
}

.lb-select {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $surface;
  color: $text-body;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;

  &:hover { background: $surface-sunk; color: $text-dark; }

  &.on {
    background: $text-dark;
    border-color: $text-dark;
    color: $white;
  }
}

.lb-chk {
  width: 14px;
  height: 14px;
  border: 1px solid #C9C2B7;
  border-radius: 3px;
  background: $surface;
  position: relative;
  flex: 0 0 auto;

  .lb-select.on & { border-color: $white; background: transparent; }

  &.some::after,
  &.all::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 5.5px;
    width: 8px;
    height: 1.5px;
    background: $white;
  }

  &.all::after {
    left: 4px;
    top: 1px;
    width: 3.5px;
    height: 8px;
    background: transparent;
    border: solid $white;
    border-width: 0 1.5px 1.5px 0;
    transform: rotate(45deg);
  }
}

.lb-search {
  width: 260px;

  ::v-deep .el-input__inner {
    height: 32px;
    line-height: 32px;
    font-size: 12.5px;
  }

  ::v-deep .el-input__icon { line-height: 32px; }
}

// ---------- Bulk bar ----------
.bulkbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-top: 12px;
  background: $text-dark;
  color: #EDE9E2;
  border-radius: $radius-md;
  flex-wrap: wrap;
}

.bulk-chk {
  width: 14px;
  height: 14px;
  border: 1px solid $white;
  border-radius: 3px;
  position: relative;
  flex: 0 0 auto;

  &::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 5.5px;
    width: 8px;
    height: 1.5px;
    background: $white;
  }
}

.bulk-n {
  font-family: $font-mono;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bulk-x {
  color: #8A837A;
  font-size: 12px;
  display: flex;
  gap: 12px;

  a {
    color: #8A837A;
    cursor: pointer;

    &:hover { color: #EDE9E2; }
  }
}

.bulk-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;

  // Buttons dropped into the bulk slot get the dark-bar treatment
  ::v-deep .el-button {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    background: transparent !important;
    border: 1px solid #3A342C !important;
    color: #EDE9E2 !important;

    &:hover {
      background: #262119 !important;
      border-color: #4A4238 !important;
    }
  }

  ::v-deep .el-button--danger {
    color: #F0B9B2 !important;
    border-color: #4A342F !important;

    &:hover { background: #2E211E !important; }
  }
}

.bulk-fade-enter-active,
.bulk-fade-leave-active { transition: opacity 0.15s ease; }
.bulk-fade-enter,
.bulk-fade-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .listbar { flex-direction: column; align-items: stretch; }
  .lb-r { justify-content: flex-start; }
  .lb-search { width: 100%; }
}
</style>
