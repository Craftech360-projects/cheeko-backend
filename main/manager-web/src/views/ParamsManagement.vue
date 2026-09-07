<template>
    <div class="welcome">

        <div class="page-head">
            <div>
                <h1 class="page-title">Parameters</h1>
                <p class="page-lead">Runtime configuration read by the agent workers and the gateway at boot.</p>
            </div>
            <div class="page-actions">
                <el-button size="small" type="primary" @click="showAddDialog">New parameter</el-button>
            </div>
        </div>

        <ListToolbar
            :count="total"
            count-noun="parameters"
            :total="total"
            :sort-options="sortOptions"
            :sort-by.sync="sortBy"
            :sort-dir.sync="sortDir"
            :group-options="groupOptions"
            :group-by.sync="groupBy"
            :selecting.sync="selecting"
            :selected-count="selectedCount"
            :all-selected="isAllSelected"
            :search.sync="searchCode"
            search-placeholder="Search by code or value"
            @select-all-matching="selectAllRows"
            @clear-selection="clearSelection"
        >
            <template #bulk>
                <el-button @click="exportSelected">Export</el-button>
                <el-button type="danger" @click="deleteSelectedParams">Delete</el-button>
            </template>
        </ListToolbar>

        <div class="main-wrapper">
            <div class="content-panel">
                <div class="content-area">
                    <el-card class="params-card" shadow="never">
                        <el-table ref="paramsTable" :data="visibleRows" class="transparent-table" v-loading="loading"
                            element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                            element-loading-background="rgba(250, 249, 247, 0.75)"
                            :row-class-name="paramRowClass"
                            @sort-change="onTableSortChange"
                            :header-cell-class-name="headerCellClassName">
                            <el-table-column v-if="selecting" label="" align="center" width="52">
                                <template slot-scope="scope">
                                    <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                </template>
                            </el-table-column>
                            <el-table-column label="Parameter Code" prop="paramCode" min-width="240" sortable="custom">
                                <template slot-scope="scope">
                                    <span class="mono cell-key">{{ scope.row.paramCode }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Parameter Value" prop="paramValue" min-width="200" sortable="custom" show-overflow-tooltip>
                                <template slot-scope="scope">
                                    <div v-if="isSensitiveParam(scope.row.paramCode)">
                                        <span v-if="!scope.row.showValue">{{ maskSensitiveValue(scope.row.paramValue)
                                        }}</span>
                                        <span v-else>{{ scope.row.paramValue }}</span>
                                        <el-button size="mini" type="text" @click="toggleSensitiveValue(scope.row)">
                                            {{ scope.row.showValue ? 'Hide' : 'View' }}
                                        </el-button>
                                    </div>
                                    <span v-else class="mono">{{ scope.row.paramValue }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Remark" prop="remark" min-width="220" sortable="custom">
                                <template slot-scope="scope">{{ scope.row.remark || '—' }}</template>
                            </el-table-column>
                            <el-table-column label="Actions" align="right" width="150">
                                <template slot-scope="scope">
                                    <div class="row-actions">
                                        <el-button type="text" @click="editParam(scope.row)">Edit</el-button>
                                        <el-button type="text" class="delete-btn" @click="deleteParam(scope.row)">Delete</el-button>
                                    </div>
                                </template>
                            </el-table-column>
                        </el-table>

                        <div class="table_bottom">
                            <div class="ctrl_btn">
                                <span class="muted">Showing {{ visibleRows.length }} of {{ total }} parameters</span>
                            </div>
                            <div class="custom-pagination">
                                <el-select v-model="pageSize" @change="handlePageSizeChange" class="page-size-select">
                                    <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`"
                                        :value="item">
                                    </el-option>
                                </el-select>
                                <button class="pagination-btn" :disabled="currentPage === 1" @click="goFirst">
                                    First
                                </button>
                                <button class="pagination-btn" :disabled="currentPage === 1" @click="goPrev">
                                    Previous
                                </button>
                                <button v-for="page in visiblePages" :key="page" class="pagination-btn"
                                    :class="{ active: page === currentPage }" @click="goToPage(page)">
                                    {{ page }}
                                </button>
                                <button class="pagination-btn" :disabled="currentPage === pageCount" @click="goNext">
                                    Next
                                </button>
                                <span class="total-text">Total {{ total }} records</span>
                            </div>
                        </div>
                    </el-card>
                </div>
            </div>
        </div>

        <!-- Add/Edit Parameter Dialog -->
        <param-dialog :title="dialogTitle" :visible.sync="dialogVisible" :form="paramForm" @submit="handleSubmit"
            @cancel="dialogVisible = false" />
        <el-footer>
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import Api from "@/apis/api";
import ParamDialog from "@/components/ParamDialog.vue";
import VersionFooter from "@/components/VersionFooter.vue";
import ListToolbar from "@/components/ListToolbar.vue";
import listControls from "@/mixins/listControls";
export default {
  name: 'ParamsManagement',
    components: { ParamDialog, VersionFooter, ListToolbar },
    mixins: [listControls],
    data() {
        return {
            // list controls — selection stays on `row.selected`
            sortBy: 'paramCode',
            sortDir: 'asc',
            sortOptions: [
                { label: 'Parameter code', value: 'paramCode' },
                { label: 'Parameter value', value: 'paramValue' },
                { label: 'Remark', value: 'remark' }
            ],
            groupOptions: [
                { label: 'None', value: '' },
                { label: 'Namespace', value: '_namespace' }
            ],
            searchTimer: null,
            searchCode: "",
            paramsList: [],
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
    beforeDestroy() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
    },
    watch: {
        // The toolbar's search box drives the same server-side lookup
        searchCode() {
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => this.handleSearch(), 350);
        }
    },

    computed: {
        // Namespace = the segment before the first dot, so Group by Namespace
        // clusters agent.* / gateway.* / reports.* without a schema change.
        sourceRows() {
            return this.paramsList.map(row => {
                const code = row.paramCode || '';
                const at = code.indexOf('.');
                row._namespace = at === -1 ? '' : code.slice(0, at);
                return row;
            });
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
        handlePageSizeChange(val) {
            this.pageSize = val;
            this.currentPage = 1;
            this.fetchParams();
        },
        fetchParams() {
            this.loading = true;
            Api.admin.getParamsList(
                {
                    page: this.currentPage,
                    limit: this.pageSize,
                    paramCode: this.searchCode },
                ({ data }) => {
                    this.loading = false;
                    if (data.code === 0) {
                        this.paramsList = data.data.list.map(item => ({
                            ...item,
                            selected: false,
                            showValue: false
                        }));
                        this.total = data.data.total;
                    } else {
                        this.$message.error({
                            message: data.msg || 'Failed to get parameter list',
                            showClose: true
                        });
                    }
                }
            );
        },
        handleSearch() {
            this.currentPage = 1;
            this.fetchParams();
        },
        paramRowClass({ row }) {
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
        exportSelected() {
            const rows = this.paramsList.filter(row => row.selected);
            if (!rows.length) {
                this.$message.warning('Nothing to export.');
                return;
            }
            const cols = ['paramCode', 'paramValue', 'remark'];
            const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
            const csv = [cols.join(',')]
                .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
                .join('\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'parameters.csv';
            link.click();
            URL.revokeObjectURL(url);
        },
        handleSelectAll() {
            this.isAllSelected = !this.isAllSelected;
            this.paramsList.forEach(row => {
                row.selected = this.isAllSelected;
            });
        },
        showAddDialog() {
            this.dialogTitle = "Add Parameter";
            this.paramForm = {
                id: null,
                paramCode: "",
                paramValue: "",
                remark: ""
            };
            this.dialogVisible = true;
        },
        editParam(row) {
            this.dialogTitle = "Edit Parameter";
            this.paramForm = { ...row };
            this.dialogVisible = true;
        },

        handleSubmit({ form, done }) {
            if (form.id) {
                // Edit
                Api.admin.updateParam(form, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: "Update successful",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchParams();
                    }
                    done && done();
                });
            } else {
                // Add new
                Api.admin.addParam(form, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: "Added successfully",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchParams();
                    }
                    done && done();
                });
            }
        },

        deleteSelectedParams() {
            const selectedRows = this.paramsList.filter(row => row.selected);
            if (selectedRows.length === 0) {
                this.$message.warning({
                    message: "Please select parameters to delete",
                    showClose: true
                });
                return;
            }
            this.deleteParam(selectedRows);
        },
        deleteParam(row) {
            // Handle single parameter or parameter array
            const params = Array.isArray(row) ? row : [row];

            if (Array.isArray(row) && row.length === 0) {
                this.$message.warning({
                    message: "Please select parameters to delete",
                    showClose: true
                });
                return;
            }

            const paramCount = params.length;
            this.$confirm(`Are you sure you want to delete ${paramCount} selected parameter(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning',
                distinguishCancelAndClose: true
            }).then(() => {
                const ids = params.map(param => param.id);
                if (ids.some(id => isNaN(id))) {
                    this.$message.error({
                        message: 'Invalid parameter ID exists',
                        showClose: true
                    });
                    return;
                }

                Api.admin.deleteParam(ids, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: `Successfully deleted ${paramCount} parameter(s)`,
                            showClose: true
                        });
                        this.fetchParams();
                    } else {
                        this.$message.error({
                            message: data.msg || 'Delete failed, please try again',
                            showClose: true
                        });
                    }
                });
            }).catch(action => {
                if (action === 'cancel') {
                    this.$message({
                        type: 'info',
                        message: 'Delete operation cancelled',
                        duration: 1000
                    });
                } else {
                    this.$message({
                        type: 'info',
                        message: 'Operation closed',
                        duration: 1000
                    });
                }
            });
        },
        headerCellClassName({ columnIndex }) {
            if (columnIndex === 0) {
                return "custom-selection-header";
            }
            return "";
        },
        goFirst() {
            this.currentPage = 1;
            this.fetchParams();
        },
        goPrev() {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.fetchParams();
            }
        },
        goNext() {
            if (this.currentPage < this.pageCount) {
                this.currentPage++;
                this.fetchParams();
            }
        },
        goToPage(page) {
            this.currentPage = page;
            this.fetchParams();
        },
        isSensitiveParam(paramCode) {
            return this.sensitive_keys.some(key => paramCode.toLowerCase().includes(key.toLowerCase()));
        },
        maskSensitiveValue(value) {
            if (!value) return '';
            if (value.length <= 8) return '****';
            return value.substring(0, 4) + '****' + value.substring(value.length - 4);
        },
        toggleSensitiveValue(row) {
            this.$set(row, 'showValue', !row.showValue);
        } } };
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

// Page chrome lives in styles/ds.scss — this block carries only what is
// specific to the parameter table.

.params-card {
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    box-shadow: none;

    ::v-deep .el-card__body { padding: 0; }
}

.table_bottom { border-top: 1px solid $border-color; }

.delete-btn { color: $danger !important; }
</style>
