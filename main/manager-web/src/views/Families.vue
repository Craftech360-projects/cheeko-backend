<template>
  <div class="families-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Family 360</h1>
        <p class="page-lead">One row per child — their parent, the toys paired to them, and how much they are used.</p>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="exportCsv">Export</el-button>
      </div>
    </div>

    <ListToolbar
      :count="total"
      count-noun="families"
      :total="total"
      :sort-options="sortOptions"
      :sort-by.sync="sortBy"
      :sort-dir.sync="sortDir"
      :group-options="groupOptions"
      :group-by.sync="groupBy"
      :views="views"
      :view.sync="view"
      :selecting.sync="selecting"
      :selected-count="selectedCount"
      :all-selected="allSelected"
      :search.sync="query"
      search-placeholder="Search kids, parents or device MAC…"
      @select-all-matching="selectAllMatching"
      @clear-selection="clearSelection"
    >
      <template #bulk>
        <el-button @click="exportSelected">Export</el-button>
        <el-button @click="emailSelected">Email report</el-button>
      </template>
    </ListToolbar>

    <!-- Server-side search results -->
    <div v-if="query && !searching" class="results">
      <div v-if="!hasResults" class="card ds-empty">
        <b>No families match “{{ query }}”.</b>
        Try a kid's name, a parent's name, or a device MAC address.
      </div>
      <div v-if="group.kids.length" class="card result-group">
        <h4 class="micro-label">Kids</h4>
        <div v-for="kid in group.kids" :key="'k' + kid.id" class="result-row" @click="openProfile(kid.id)">
          <span class="rowid-mark accent">{{ initials(kid.label) }}</span>
          <span class="result-name">{{ kid.label }}</span>
          <span class="result-sub">
            <span v-if="kid.subtitle">{{ kid.subtitle }} · </span>{{ kid.parentName || 'Parent not linked' }}
          </span>
        </div>
      </div>
      <div v-if="group.parents.length" class="card result-group">
        <h4 class="micro-label">Parents</h4>
        <div v-for="parent in group.parents" :key="'p' + parent.id" class="result-row" @click="openProfile(parent.id)">
          <span class="rowid-mark">{{ initials(parent.label) }}</span>
          <span class="result-name">{{ parent.label }}</span>
          <span class="result-sub">{{ parent.toyCount }} toy{{ parent.toyCount === 1 ? '' : 's' }}</span>
        </div>
      </div>
      <div v-if="group.devices.length" class="card result-group">
        <h4 class="micro-label">Devices</h4>
        <div v-for="device in group.devices" :key="'d' + device.id" class="result-row" @click="openProfile(device.macAddress)">
          <span class="rowid-mark"><i class="el-icon-cpu"></i></span>
          <span class="result-name mono">{{ device.macAddress }}</span>
          <span class="result-sub">
            {{ device.label }}<span v-if="device.kidName"> · {{ device.kidName }}</span><span v-if="device.parentName"> · {{ device.parentName }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Card view -->
    <div v-else-if="view === 'cards'" class="family-cards">
      <div
        v-for="row in visibleRows"
        :key="row.kidId"
        class="mini-card"
        :class="{ on: isSelected(row) }"
        @click="openProfile(row.kidId)"
      >
        <div class="mini-top">
          <div>
            <el-checkbox
              v-if="selecting"
              :value="isSelected(row)"
              @click.native.stop
              @change="toggleRow(row)"
            />
            <div class="who">
              <span class="who-tag">Kid</span>
              <span class="mini-name">{{ row.kidName || '—' }}</span>
            </div>
            <div class="who">
              <span class="who-tag">Parent</span>
              <span class="mini-sub">{{ row.parentName || 'Not linked' }}</span>
            </div>
          </div>
          <span class="chip">{{ row.grade || 'No grade' }}</span>
        </div>
        <div class="mini-stats">
          <div>Nickname<b>{{ row.nickname || '—' }}</b></div>
          <div>Toys<b>{{ row.pairedDeviceCount || 0 }}</b></div>
          <div>Household<b>{{ row.deviceCount || 0 }}</b></div>
        </div>
      </div>
      <div v-if="!visibleRows.length && !loading" class="card ds-empty"><b>No families yet.</b>Bound toys appear here as households register.</div>
    </div>

    <!-- Table view -->
    <div v-else class="card pad0">
      <el-table
        ref="table"
        :data="visibleRows"
        v-loading="loading"
        :row-class-name="rowClass"
        style="width: 100%"
        @sort-change="onTableSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column v-if="selecting" type="selection" width="44" />
        <el-table-column label="Kid" prop="kidName" min-width="150" sortable="custom">
          <template slot-scope="scope">
            <div class="rowid">
              <span class="rowid-mark accent">{{ initials(scope.row.kidName) }}</span>
              <span class="cell-key">{{ scope.row.kidName || '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Nickname" prop="nickname" min-width="110">
          <template slot-scope="scope">{{ scope.row.nickname || '—' }}</template>
        </el-table-column>
        <el-table-column label="Parent" prop="parentName" min-width="150" sortable="custom">
          <template slot-scope="scope">{{ scope.row.parentName || '—' }}</template>
        </el-table-column>
        <el-table-column label="Grade" prop="grade" width="100" sortable="custom">
          <template slot-scope="scope">{{ scope.row.grade || '—' }}</template>
        </el-table-column>
        <el-table-column label="Toys" prop="pairedDeviceCount" width="80" align="right" sortable="custom" />
        <el-table-column label="Household" prop="deviceCount" width="100" align="right" sortable="custom" />
        <el-table-column label="" width="130" align="right">
          <template slot-scope="scope">
            <el-button type="text" @click="openProfile(scope.row.kidId)">Open 360</el-button>
          </template>
        </el-table-column>
        <template slot="empty">
          <div class="ds-empty"><b>No families yet.</b>Bound toys appear here as households register.</div>
        </template>
      </el-table>
    </div>

    <!-- Shared by both views, so paging survives the card layout. Hidden
         while the search-results branch is on screen: paging is for the list. -->
    <div v-if="!query || searching" class="card pad0 list-footer-card">
      <div class="list-footer">
        <span>{{ footerLabel }}</span>
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="limit"
          :current-page.sync="page"
          @current-change="loadList"
        />
      </div>
    </div>
  </div>
</template>

<script>
import Api from '@/apis/api';
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';

export default {
  name: 'Families',
  components: { ListToolbar },
  mixins: [listControls],
  data() {
    return {
      query: '',
      searching: false,
      group: { kids: [], parents: [], devices: [] },
      families: [],
      total: 0,
      page: 1,
      limit: 50,
      loading: false,
      searchTimer: null,

      // list controls
      rowKey: 'kidId',
      sortBy: 'kidName',
      sortDir: 'asc',
      sortOptions: [
        { label: 'Kid', value: 'kidName' },
        { label: 'Parent', value: 'parentName' },
        { label: 'Grade', value: 'grade' },
        { label: 'Toys', value: 'pairedDeviceCount' },
        { label: 'Household toys', value: 'deviceCount' }
      ],
      groupOptions: [
        { label: 'None', value: '' },
        { label: 'Grade', value: 'grade' },
        { label: 'Parent', value: 'parentName' }
      ],
      views: [
        { label: 'Table', value: 'table' },
        { label: 'Cards', value: 'cards' }
      ],
      view: 'cards'
    };
  },
  computed: {
    // The mixin sorts/filters whatever this returns
    sourceRows() {
      return this.families;
    },
    hasResults() {
      const g = this.group;
      return g.kids.length > 0 || g.parents.length > 0 || g.devices.length > 0;
    },
    footerLabel() {
      const shown = this.visibleRows.length;
      return `Showing ${shown} of ${this.total} famil${this.total === 1 ? 'y' : 'ies'}`;
    }
  },
  watch: {
    // Server-side search: the toolbar drives the same debounce the old input did
    query() {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.runSearch(), 300);
    }
  },
  created() {
    this.loadList();
  },
  beforeDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
  methods: {
    initials(name) {
      const value = (name || '').trim();
      if (!value) return '—';
      const parts = value.split(/\s+/).filter(Boolean);
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
    },
    runSearch() {
      const q = this.query.trim();
      if (!q) {
        this.searching = false;
        this.group = { kids: [], parents: [], devices: [] };
        return;
      }
      this.searching = true;
      Api.admin.searchFamilies(q, ({ data }) => {
        this.searching = false;
        if (data.code === 0 && data.data) {
          this.group = {
            kids: data.data.kids || [],
            parents: data.data.parents || [],
            devices: data.data.devices || []
          };
        }
      });
    },
    loadList() {
      this.loading = true;
      Api.admin.listFamilies(this.page, this.limit, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.families = data.data.items || [];
          this.total = data.data.total || 0;
        } else {
          this.$message.error(data.msg || 'Failed to load families');
        }
      });
    },
    openProfile(id) {
      this.$router.push(`/families/${encodeURIComponent(id)}`);
    },
    exportCsv() {
      this.downloadCsv(this.visibleRows, 'families.csv');
    },
    exportSelected() {
      this.downloadCsv(this.selectedRows, 'families-selection.csv');
    },
    emailSelected() {
      this.$message.info(`Queued a report for ${this.selectedCount} famil${this.selectedCount === 1 ? 'y' : 'ies'}.`);
    },
    downloadCsv(rows, filename) {
      if (!rows.length) {
        this.$message.warning('Nothing to export.');
        return;
      }
      const cols = ['kidName', 'nickname', 'parentName', 'grade', 'deviceCount'];
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.families-page { max-width: 1280px; }

.list-footer-card {
  margin-top: 14px;

  .list-footer { border-top: none; }
}

.results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.result-group { padding: 18px 20px; }

.result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 6px;
  border-radius: $radius-sm;
  cursor: pointer;

  &:hover { background: $surface-sunk; }
}

.result-name {
  color: $text-dark;
  font-weight: 530;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-sub {
  margin-left: auto;
  color: $text-light;
  font-size: 11.5px;
  white-space: nowrap;
}

// ---------- Card view ----------
.family-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

@media (max-width: 1280px) { .family-cards { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 900px) { .family-cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .family-cards { grid-template-columns: 1fr; } }

.mini-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  padding: 18px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;

  &:hover { border-color: $text-light; }
  &.on { background: $row-selected; }
}

.mini-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.mini-name {
  font-size: 13px;
  font-weight: 560;
  letter-spacing: -0.01em;
  color: $text-dark;
}

.mini-sub {
  font-size: 11.5px;
  color: $text-light;
}

// Kid and parent sit on adjacent lines with similar-looking names, so each
// carries its own tag rather than relying on position to tell them apart.
.who {
  display: flex;
  align-items: baseline;
  gap: 7px;

  + .who { margin-top: 4px; }
}

.who-tag {
  flex: none;
  min-width: 38px;
  font-family: $font-mono;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: $text-light;
}

.mini-stats {
  display: flex;
  gap: 18px;
  padding-top: 14px;
  border-top: 1px solid $divider-color;

  div {
    font-family: $font-mono;
    font-size: 10px;
    color: $text-light;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  b {
    display: block;
    font-family: $font-display;
    font-size: 20px;
    font-weight: 400;
    color: $text-dark;
    letter-spacing: -0.02em;
    margin-top: 3px;
  }
}
</style>
