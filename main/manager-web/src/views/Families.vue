<template>
  <div class="families-page">
    <div class="families-header">
      <h2 class="page-title">Families</h2>
      <div class="family-search">
        <el-input
          v-model="query"
          placeholder="Search kids, parents or device MAC…"
          prefix-icon="el-icon-search"
          clearable
          @input="onSearchInput"
        />
      </div>
    </div>

    <!-- Search results -->
    <div v-if="query && !searching" class="results">
      <div v-if="!hasResults" class="card card-empty">No families match "{{ query }}".</div>
      <div v-if="group.kids.length" class="card result-group">
        <h4 class="group-title">Kids</h4>
        <div v-for="kid in group.kids" :key="'k' + kid.id" class="result-row" @click="openProfile(kid.id)">
          <i class="el-icon-user result-icon"></i>
          <span class="result-name">{{ kid.label }}</span>
          <span class="result-sub">
            <span v-if="kid.subtitle">{{ kid.subtitle }} · </span>{{ kid.parentName || 'Parent not linked' }}
          </span>
        </div>
      </div>
      <div v-if="group.parents.length" class="card result-group">
        <h4 class="group-title">Parents</h4>
        <div v-for="parent in group.parents" :key="'p' + parent.id" class="result-row" @click="openProfile(parent.id)">
          <i class="el-icon-s-custom result-icon"></i>
          <span class="result-name">{{ parent.label }}</span>
          <span class="result-sub">{{ parent.toyCount }} toy{{ parent.toyCount === 1 ? '' : 's' }}</span>
        </div>
      </div>
      <div v-if="group.devices.length" class="card result-group">
        <h4 class="group-title">Devices</h4>
        <div v-for="device in group.devices" :key="'d' + device.id" class="result-row" @click="openProfile(device.macAddress)">
          <i class="el-icon-monitor result-icon"></i>
          <span class="result-name mono">{{ device.macAddress }}</span>
          <span class="result-sub">
            {{ device.label }}<span v-if="device.kidName"> · {{ device.kidName }}</span><span v-if="device.parentName"> · {{ device.parentName }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Default: all families list -->
    <div v-else class="card">
      <el-table :data="families" v-loading="loading" style="width: 100%">
        <el-table-column label="Kid" prop="kidName" min-width="140" />
        <el-table-column label="Nickname" prop="nickname" min-width="110">
          <template slot-scope="scope">{{ scope.row.nickname || '—' }}</template>
        </el-table-column>
        <el-table-column label="Parent" prop="parentName" min-width="140">
          <template slot-scope="scope">{{ scope.row.parentName || '—' }}</template>
        </el-table-column>
        <el-table-column label="Grade" prop="grade" width="80">
          <template slot-scope="scope">{{ scope.row.grade || '—' }}</template>
        </el-table-column>
        <el-table-column label="Toys" prop="deviceCount" width="80" />
        <el-table-column label="" width="100" align="right">
          <template slot-scope="scope">
            <el-button type="text" @click="openProfile(scope.row.kidId)">Open profile</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="list-footer">
        <span class="muted">{{ total }} families</span>
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

export default {
  name: 'Families',
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
      searchTimer: null
    };
  },
  computed: {
    hasResults() {
      const g = this.group;
      return g.kids.length > 0 || g.parents.length > 0 || g.devices.length > 0;
    }
  },
  created() {
    this.loadList();
  },
  methods: {
    onSearchInput() {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.runSearch(), 300);
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
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.families-page {
  max-width: 1100px;
}

.families-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  color: $text-dark;
}

.family-search {
  width: 380px;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border: 1px solid $border-color;
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 4px 14px rgba(61, 69, 102, 0.05);
}

.card-empty {
  text-align: center;
  color: $text-gray;
  font-size: 13px;
  padding: 18px 0;
}

.group-title {
  margin: 2px 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: $text-gray;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 8px;
  cursor: pointer;

  &:hover { background: rgba($primary, 0.07); }
}

.result-icon { color: $primary-dark; }

.result-name {
  color: $text-dark;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.mono {
    font-family: 'Consolas', 'Menlo', monospace;
    font-weight: 500;
  }
}

.result-sub {
  margin-left: auto;
  color: $text-gray;
  font-size: 12px;
  white-space: nowrap;
}

.list-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
}

.muted {
  color: $text-gray;
  font-size: 12px;
}
</style>
