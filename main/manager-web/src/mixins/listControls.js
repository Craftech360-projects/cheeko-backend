/**
 * Sort · View · Select behaviour shared by every list screen.
 *
 * A view opts in with:
 *
 *   import listControls from '@/mixins/listControls';
 *   mixins: [listControls],
 *   data() {
 *     return {
 *       sortOptions: [{ label: 'Name', value: 'name' }, …],
 *       sortBy: 'name',
 *       searchFields: ['name', 'macAddress']
 *     };
 *   }
 *
 * and renders `visibleRows` instead of its raw array. Everything the mixin
 * owns is namespaced enough not to collide with a view's own state.
 */
export default {
  data() {
    return {
      sortOptions: [],
      sortBy: '',
      sortDir: 'desc',

      groupOptions: [],
      groupBy: '',

      views: [{ label: 'Table', value: 'table' }],
      view: 'table',

      selecting: false,
      selectedKeys: [],

      listSearch: '',
      searchFields: [],

      // The array the view loads into. A view with a different name should
      // override `sourceRows`.
      rowKey: 'id'
    };
  },
  computed: {
    /** Override in a view whose data does not live on `this.rows`. */
    sourceRows() {
      return this.rows || [];
    },

    /** Search → group → sort. The order matters: sorting a filtered set is cheaper. */
    visibleRows() {
      let out = this.sourceRows.slice();

      const q = (this.listSearch || '').trim().toLowerCase();
      if (q && this.searchFields.length) {
        out = out.filter(row => this.searchFields.some(field => {
          const value = this.resolveField(row, field);
          return value !== null && value !== undefined && String(value).toLowerCase().includes(q);
        }));
      }

      if (this.sortBy) {
        out.sort((a, b) => this.compareRows(a, b, this.sortBy, this.sortDir));
      }

      if (this.groupBy) {
        // Grouping is a secondary sort: rows stay sorted inside each group.
        out.sort((a, b) => this.compareRows(a, b, this.groupBy, 'asc'));
      }

      return out;
    },

    selectedCount() {
      return this.selectedKeys.length;
    },

    allSelected() {
      return this.visibleRows.length > 0 && this.selectedCount === this.visibleRows.length;
    },

    /** The rows behind the current selection, for bulk actions. */
    selectedRows() {
      const keys = new Set(this.selectedKeys);
      return this.sourceRows.filter(row => keys.has(this.keyOf(row)));
    }
  },
  watch: {
    // Leaving select mode drops the selection rather than keeping a hidden one.
    selecting(on) {
      if (!on) this.selectedKeys = [];
    },
    // A changed filter must not leave selections pointing at hidden rows.
    listSearch() {
      if (this.selectedKeys.length) this.pruneSelection();
    }
  },
  methods: {
    keyOf(row) {
      return row && row[this.rowKey] !== undefined ? row[this.rowKey] : row;
    },

    /** Supports dotted paths so a view can sort on `owner.name`. */
    resolveField(row, field) {
      if (!field) return undefined;
      if (field.indexOf('.') === -1) return row[field];
      return field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), row);
    },

    /**
     * Direction is applied *inside* the comparator on purpose. Empties must
     * sort last in both directions, and a caller that multiplied the result by
     * -1 would flip them to the top — a device that has never connected would
     * lead a "last connected, newest first" sort.
     */
    compareRows(a, b, field, dir) {
      const av = this.resolveField(a, field);
      const bv = this.resolveField(b, field);

      const aEmpty = av === null || av === undefined || av === '';
      const bEmpty = bv === null || bv === undefined || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      const sign = dir === 'asc' ? 1 : -1;

      if (typeof av === 'number' && typeof bv === 'number') return sign * (av - bv);

      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== '') {
        return sign * (an - bn);
      }

      return sign * String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
    },

    isSelected(row) {
      return this.selectedKeys.indexOf(this.keyOf(row)) !== -1;
    },

    toggleRow(row) {
      const key = this.keyOf(row);
      const at = this.selectedKeys.indexOf(key);
      if (at === -1) this.selectedKeys.push(key);
      else this.selectedKeys.splice(at, 1);
    },

    /** el-table's own selection event, so both paths stay in sync. */
    onSelectionChange(rows) {
      this.selectedKeys = rows.map(row => this.keyOf(row));
    },

    selectAllMatching() {
      this.selectedKeys = this.visibleRows.map(row => this.keyOf(row));
    },

    clearSelection() {
      this.selectedKeys = [];
      if (this.$refs && this.$refs.table && this.$refs.table.clearSelection) {
        this.$refs.table.clearSelection();
      }
    },

    pruneSelection() {
      const visible = new Set(this.visibleRows.map(row => this.keyOf(row)));
      this.selectedKeys = this.selectedKeys.filter(key => visible.has(key));
    },

    /** Keeps a column-header click in sync with the toolbar's sort control. */
    onTableSortChange({ prop, order }) {
      if (!prop || !order) {
        this.sortBy = '';
        return;
      }
      this.sortBy = prop;
      this.sortDir = order === 'ascending' ? 'asc' : 'desc';
    },

    /** Row class hook so a selected row gets the tint. */
    rowClass({ row }) {
      return this.isSelected(row) ? 'selected-row' : '';
    }
  }
};
