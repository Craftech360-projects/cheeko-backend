<template>
  <div class="welcome">

    <div class="page-head">
      <div>
        <h1 class="page-title">Server Side</h1>
        <p class="page-lead">WebSocket endpoints and worker processes behind the fleet.</p>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="restartSelected" :disabled="!selectedCount">Restart workers</el-button>
      </div>
    </div>

    <ListToolbar
      :count="paramsList.length"
      count-noun="endpoints"
      :total="paramsList.length"
      :sort-options="sortOptions"
      :sort-by.sync="sortBy"
      :sort-dir.sync="sortDir"
      :selecting.sync="selecting"
      :selected-count="selectedCount"
      :all-selected="isAllSelected"
      :search.sync="listSearch"
      search-placeholder="WS address"
      @select-all-matching="selectAllRows"
      @clear-selection="clearSelection"
    >
      <template #bulk>
        <el-button @click="restartSelected">Restart</el-button>
        <el-button @click="updateConfigSelected">Update config</el-button>
      </template>
    </ListToolbar>

    <div class="main-wrapper">
      <div class="content-panel">
        <div class="content-area">
          <el-card class="params-card" shadow="never">
            <el-table ref="paramsTable" :data="visibleRows" class="transparent-table" v-loading="loading"
              element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
              element-loading-background="rgba(250, 249, 247, 0.75)"
              :row-class-name="wsRowClass"
              @sort-change="onTableSortChange"
              :header-cell-class-name="headerCellClassName">
              <el-table-column v-if="selecting" label="" align="center" width="52">
                <template slot-scope="scope">
                  <el-checkbox v-model="scope.row.selected"></el-checkbox>
                </template>
              </el-table-column>
              <el-table-column label="WS Address" prop="address" min-width="320" sortable="custom">
                <template slot-scope="scope">
                  <div class="rowid">
                    <span class="rowid-mark accent"><i class="el-icon-connection"></i></span>
                    <span class="mono cell-key">{{ scope.row.address }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="Status" width="120">
                <template>
                  <span class="chip ok">Reachable</span>
                </template>
              </el-table-column>
              <el-table-column label="Actions" prop="operator" align="right" width="220">
                <template slot-scope="scope">
                  <div class="row-actions">
                    <el-button type="text" @click="emitAction(scope.row, actionMap.restart)">Restart</el-button>
                    <el-button type="text" @click="emitAction(scope.row, actionMap.update_config)">Update config</el-button>
                  </div>
                </template>
              </el-table-column>
              <template slot="empty">
                <div class="ds-empty"><b>No server endpoints registered.</b>Workers report in once the gateway connects.</div>
              </template>
            </el-table>
            <div class="list-footer">
              <span>Showing {{ visibleRows.length }} of {{ paramsList.length }} endpoints</span>
            </div>
          </el-card>
        </div>
      </div>
    </div>


    <el-footer>
      <version-footer />
    </el-footer>
  </div>
</template>

<script>
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";
import ListToolbar from "@/components/ListToolbar.vue";
import listControls from "@/mixins/listControls";

export default {
  name: 'ServerSideManager',
  components: { VersionFooter, ListToolbar },
  mixins: [listControls],
  data() {
    return {
      // list controls — selection stays on `row.selected`
      sortBy: 'address',
      sortDir: 'asc',
      sortOptions: [{ label: 'WS address', value: 'address' }],
      searchFields: ['address'],
      paramsList: [],
      actionMap: {
        restart: {
          value: 'restart',
          title: "Restart Server",
          message: "Are you sure you want to restart the server?",
          confirmText: "Restart" },
        update_config: {
          value: 'update_config',
          title: "Update Configuration",
          message: "Are you sure you want to update the configuration?",
          confirmText: "Update" }
      },
      currentPage: 1,
      loading: false,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      total: 0,
      dialogVisible: false,
      dialogTitle: "Add Parameter",
      isAllSelected: false,
      sensitive_keys: ["api_key", "personal_access_token", "access_token", "token", "secret", "access_key_secret", "secret_key"],
      paramForm: {
        id: null,
        paramCode: "",
        paramValue: "",
        remark: ""
      } };
  },
  created() {
    this.fetchParams();
  },

  computed: {
    sourceRows() {
      return this.paramsList;
    },
    selectedCount() {
      return this.paramsList.filter(row => row.selected).length;
    },
    pageCount() {
      return Math.ceil(this.total / this.pageSize);
    },
    visiblePages() {
      const pages = [];
      const maxVisible = 3;
      let start = Math.max(1, this.currentPage - 1);
      let end = Math.min(this.pageCount, start + maxVisible - 1);

      if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    } },
  methods: {
    wsRowClass({ row }) {
      return row.selected ? 'selected-row' : '';
    },
    selectAllRows() {
      this.isAllSelected = true;
      this.paramsList.forEach(row => { this.$set(row, 'selected', true); });
    },
    clearSelection() {
      this.isAllSelected = false;
      this.paramsList.forEach(row => { this.$set(row, 'selected', false); });
    },
    restartSelected() {
      this.paramsList.filter(row => row.selected)
        .forEach(row => this.emitAction(row, this.actionMap.restart));
    },
    updateConfigSelected() {
      this.paramsList.filter(row => row.selected)
        .forEach(row => this.emitAction(row, this.actionMap.update_config));
    },
    handlePageSizeChange(val) {
      this.pageSize = val;
      this.currentPage = 1;
      this.fetchParams();
    },
    fetchParams() {
      this.loading = true;
      Api.admin.getWsServerList(
        {},
        ({ data }) => {
          this.loading = false;
          if (data.code === 0) {
            this.paramsList = data.data.map(item => ({ address: item }));
            this.total = data.data.length;
          } else {
            this.$message.error({
              message: data.msg || 'Failed to get parameter list',
              showClose: true
            });
          }
        }
      );
    },
    emitAction(rowItem, actionItem) {
      if (actionItem === undefined || rowItem.address === undefined) {
        return;
      }
      // Show confirmation dialog
      this.$confirm(actionItem.message, actionItem.title, {
        confirmButtonText: actionItem.confirmText, // Confirm button text
        cancelButtonText: 'Cancel'
      }).then(() => {
        // User clicked confirm button
        Api.admin.sendWsServerAction({
          targetWs: rowItem.address,
          action: actionItem.value
        }, ({ data }) => {
          if (data.code !== 0) {
            this.$message.error({
              message: data.msg || 'Operation failed',
              showClose: true
            });
            return;
          }
          this.$message.success({
            message: `${actionItem.title} successful`,
            showClose: true
          })
        })
      })
    },
    headerCellClassName({ columnIndex }) {
      if (columnIndex === 0) {
        return "custom-selection-header";
      }
      return "";
    }
  } };
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

// Page chrome lives in styles/ds.scss.

.params-card {
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: none;

  ::v-deep .el-card__body { padding: 0; }
}
</style>
