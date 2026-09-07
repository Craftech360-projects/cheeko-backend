<template>
    <div class="welcome">

        <div class="page-head">
            <div>
                <h1 class="page-title">Dictionaries</h1>
                <p class="page-lead">Controlled vocabularies the console and the agent read from.</p>
            </div>
            <div class="page-actions">
                <el-button size="small" @click="showAddDictTypeDialog">New type</el-button>
                <el-button size="small" type="primary" @click="showAddDictDataDialog">New entry</el-button>
            </div>
        </div>

        <ListToolbar
            :count="total"
            count-noun="entries"
            :total="total"
            :sort-options="sortOptions"
            :sort-by.sync="sortBy"
            :sort-dir.sync="sortDir"
            :selecting.sync="selecting"
            :selected-count="selectedCount"
            :all-selected="isAllDictDataSelected"
            :search.sync="search"
            search-placeholder="Enter dictionary label to search"
            @select-all-matching="selectAllRows"
            @clear-selection="clearSelection"
        >
            <template #bulk>
                <el-button type="danger" @click="batchDeleteDictData">Delete entries</el-button>
            </template>
        </ListToolbar>

        <!-- Main Content -->
        <div class="main-wrapper">
            <div class="content-panel">
                <!-- Left side dictionary type list -->
                <div class="dict-type-panel">
                    <div class="dict-type-header">
                        <span class="micro-label">Dictionary types</span>
                        <el-button type="text" @click="batchDeleteDictType" class="delete-btn"
                            :disabled="selectedDictTypes.length === 0">Delete selected</el-button>
                    </div>
                    <el-table ref="dictTypeTable" :data="dictTypeList" style="width: 100%" v-loading="dictTypeLoading"
                        element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                        element-loading-background="rgba(255, 255, 255, 0.7)" @row-click="handleDictTypeRowClick"
                        @selection-change="handleDictTypeSelectionChange" :row-class-name="tableRowClassName"
                        class="dict-type-table">
                        <el-table-column type="selection" width="44" />
                        <el-table-column label="Dictionary Type Name" prop="dictName" min-width="160">
                            <template slot-scope="scope"><span class="cell-key">{{ scope.row.dictName }}</span></template>
                        </el-table-column>
                        <el-table-column label="" width="70" align="right">
                            <template slot-scope="scope">
                                <el-button type="text" @click.stop="editDictType(scope.row)">Edit</el-button>
                            </template>
                        </el-table-column>
                    </el-table>
                </div>

                <!-- Right side dictionary data list -->
                <div class="content-area">
                    <el-card class="dict-data-card" shadow="never">
                        <el-table ref="dictDataTable" :data="visibleRows" style="width: 100%"
                            v-loading="dictDataLoading" element-loading-text="Loading..."
                            element-loading-spinner="el-icon-loading"
                            element-loading-background="rgba(250, 249, 247, 0.75)" class="data-table"
                            :row-class-name="dictRowClass"
                            @sort-change="onTableSortChange"
                            header-row-class-name="table-header">
                            <el-table-column v-if="selecting" label="" align="center" width="52">
                                <template slot-scope="scope">
                                    <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                </template>
                            </el-table-column>
                            <el-table-column label="Dictionary Label" prop="dictLabel" min-width="200" sortable="custom">
                                <template slot-scope="scope"><span class="cell-key">{{ scope.row.dictLabel }}</span></template>
                            </el-table-column>
                            <el-table-column label="Dictionary Value" prop="dictValue" min-width="180" sortable="custom">
                                <template slot-scope="scope"><span class="mono">{{ scope.row.dictValue }}</span></template>
                            </el-table-column>
                            <el-table-column label="Sort" prop="sort" width="90" align="right" sortable="custom" />
                            <el-table-column label="Actions" align="right" width="150">
                                <template slot-scope="scope">
                                    <div class="row-actions">
                                        <el-button type="text" @click="editDictData(scope.row)">Edit</el-button>
                                        <el-button type="text" @click="deleteDictData(scope.row)" class="delete-btn">Delete</el-button>
                                    </div>
                                </template>
                            </el-table-column>
                            <template slot="empty">
                                <div class="ds-empty"><b>No entries in this dictionary.</b>Pick a type on the left, then add an entry.</div>
                            </template>
                        </el-table>
                        <div class="table-footer">
                            <div class="batch-actions">
                                <span class="muted">Showing {{ visibleRows.length }} of {{ total }} entries</span>
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

        <!-- Dictionary type edit dialog component -->
        <DictTypeDialog :visible.sync="dictTypeDialogVisible" :title="dictTypeDialogTitle" :dictTypeData="dictTypeForm"
            @save="saveDictType" />

        <!-- Dictionary data edit dialog component -->
        <DictDataDialog :visible.sync="dictDataDialogVisible" :title="dictDataDialogTitle" :dictData="dictDataForm"
            :dictTypeId="selectedDictType?.id" @save="saveDictData" />
        <el-footer style="flex-shrink:unset;">
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import dictApi from '@/apis/module/dict'
import DictDataDialog from '@/components/DictDataDialog.vue'
import DictTypeDialog from '@/components/DictTypeDialog.vue'
import VersionFooter from '@/components/VersionFooter.vue'
import ListToolbar from '@/components/ListToolbar.vue'
import listControls from '@/mixins/listControls'
export default {
    name: 'DictManagement',
    mixins: [listControls],
    components: {
        ListToolbar,
        DictTypeDialog,
        DictDataDialog,
        VersionFooter
    },
    data() {
        return {
            // list controls — selection stays on `row.selected`
            sortBy: 'sort',
            sortDir: 'asc',
            sortOptions: [
                { label: 'Sort order', value: 'sort' },
                { label: 'Dictionary label', value: 'dictLabel' },
                { label: 'Dictionary value', value: 'dictValue' }
            ],
            searchTimer: null,
            // Dictionary type related
            dictTypeList: [],
            dictTypeLoading: false,
            selectedDictType: null,
            selectedDictTypes: [],  // Restore multi-select array
            dictTypeDialogVisible: false,
            dictTypeDialogTitle: 'Add Dictionary Type',
            dictTypeForm: {
                id: null,
                dictName: '',
                dictType: ''
            },

            // Dictionary data related
            dictDataList: [],
            dictDataLoading: false,
            isAllDictDataSelected: false,
            dictDataDialogVisible: false,
            dictDataDialogTitle: 'Add Dictionary Data',
            dictDataForm: {
                id: null,
                dictTypeId: null,
                dictLabel: '',
                dictValue: '',
                sort: 0
            },
            search: '',
            // Add pagination related data
            pageSizeOptions: [10, 20, 50, 100],
            currentPage: 1,
            pageSize: 10,
            total: 0
        }
    },
    created() {
        this.loadDictTypeList()
    },
    beforeDestroy() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
    },
    watch: {
        search() {
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => this.handleSearch(), 350);
        }
    },
    methods: {
        // Dictionary type related methods
        loadDictTypeList() {
            this.dictTypeLoading = true
            dictApi.getDictTypeList({
                page: 1,
                limit: 100,
                dictName: this.search
            }, ({ data }) => {
                if (data.code === 0) {
                    this.dictTypeList = data.data.list
                    if (this.dictTypeList.length > 0) {
                        this.selectedDictType = this.dictTypeList[0]
                        this.loadDictDataList(this.dictTypeList[0].id)
                        this.$nextTick(() => {
                            this.$refs.dictTypeTable.setCurrentRow(this.dictTypeList[0])
                        })
                    }
                }
                this.dictTypeLoading = false
            })
        },
        handleDictTypeRowClick(row) {
            this.selectedDictType = row
            this.loadDictDataList(row.id)
            this.$refs.dictTypeTable.setCurrentRow(row)
        },
        handleDictTypeSelectionChange(val) {
            this.selectedDictTypes = val
        },
        tableRowClassName({ row }) {
            return row === this.selectedDictType ? 'current-row' : ''
        },
        showAddDictTypeDialog() {
            this.dictTypeDialogTitle = 'Add Dictionary Type'
            this.dictTypeForm = {
                id: null,
                dictName: '',
                dictType: ''
            }
            this.dictTypeDialogVisible = true
        },
        editDictType(row) {
            this.dictTypeDialogTitle = 'Edit Dictionary Type'
            this.dictTypeForm = { ...row }
            this.dictTypeDialogVisible = true
        },
        saveDictType(formData) {
            const api = formData.id ? dictApi.updateDictType : dictApi.addDictType
            api(formData, ({ data }) => {
                if (data.code === 0) {
                    this.$message.success('Saved successfully')
                    this.dictTypeDialogVisible = false
                    this.loadDictTypeList()
                }
            })
        },
        batchDeleteDictType() {
            if (this.selectedDictTypes.length === 0) {
                this.$message.warning('Please select dictionary types to delete')
                return
            }

            this.$confirm('Are you sure you want to delete the selected dictionary types?', 'Confirm', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                const ids = this.selectedDictTypes.map(item => item.id)
                dictApi.deleteDictType(ids, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully')
                        this.loadDictTypeList()
                    }
                })
            })
        },

        // Dictionary data related methods
        loadDictDataList(dictTypeId) {
            if (!dictTypeId) return
            this.dictDataLoading = true
            dictApi.getDictDataList({
                dictTypeId,
                page: this.currentPage,
                limit: this.pageSize,
                dictLabel: this.search,
                dictValue: ''
            }, ({ data }) => {
                if (data.code === 0) {
                    this.dictDataList = data.data.list.map(item => ({
                        ...item,
                        selected: false
                    }))
                    this.total = data.data.total
                } else {
                    this.$message.error(data.msg || 'Failed to get dictionary data')
                }
                this.dictDataLoading = false
            })
        },
        dictRowClass({ row }) {
            return row.selected ? 'selected-row' : '';
        },
        selectAllRows() {
            this.isAllDictDataSelected = true;
            this.dictDataList.forEach(row => { this.$set(row, 'selected', true); });
        },
        clearSelection() {
            this.isAllDictDataSelected = false;
            this.dictDataList.forEach(row => { this.$set(row, 'selected', false); });
        },
        selectAllDictData() {
            this.isAllDictDataSelected = !this.isAllDictDataSelected
            this.dictDataList.forEach(row => {
                row.selected = this.isAllDictDataSelected
            })
        },
        showAddDictDataDialog() {
            if (!this.selectedDictType) {
                this.$message.warning('Please select a dictionary type first')
                return
            }
            this.dictDataDialogTitle = 'Add Dictionary Data'
            this.dictDataForm = {
                id: null,
                dictTypeId: this.selectedDictType.id,
                dictLabel: '',
                dictValue: '',
                sort: 0
            }
            this.dictDataDialogVisible = true
        },
        editDictData(row) {
            this.dictDataDialogTitle = 'Edit Dictionary Data'
            this.dictDataForm = { ...row }
            this.dictDataDialogVisible = true
        },
        saveDictData(formData) {
            const api = formData.id ? dictApi.updateDictData : dictApi.addDictData
            api(formData, ({ data }) => {
                if (data.code === 0) {
                    this.$message.success('Saved successfully')
                    this.dictDataDialogVisible = false
                    this.loadDictDataList(formData.dictTypeId)
                }
            })
        },
        deleteDictData(row) {
            this.$confirm('Are you sure you want to delete this dictionary data?', 'Confirm', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                dictApi.deleteDictData([row.id], ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully')
                        this.loadDictDataList(row.dictTypeId)
                    }
                })
            })
        },
        batchDeleteDictData() {
            const selectedRows = this.dictDataList.filter(row => row.selected)
            if (selectedRows.length === 0) {
                this.$message.warning('Please select dictionary data to delete')
                return
            }

            this.$confirm(`Are you sure you want to delete ${selectedRows.length} selected dictionary data?`, 'Confirm', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                const ids = selectedRows.map(item => item.id)
                dictApi.deleteDictData(ids, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully')
                        this.loadDictDataList(this.selectedDictType.id)
                    }
                })
            })
        },
        handleSearch() {
            if (!this.selectedDictType) {
                this.$message.warning('Please select a dictionary type first')
                return
            }
            this.currentPage = 1
            this.loadDictDataList(this.selectedDictType.id)
        },
        // Add pagination related methods
        handlePageSizeChange(val) {
            this.pageSize = val;
            this.currentPage = 1;
            this.loadDictDataList(this.selectedDictType?.id);
        },
        goFirst() {
            this.currentPage = 1;
            this.loadDictDataList(this.selectedDictType?.id);
        },
        goPrev() {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadDictDataList(this.selectedDictType?.id);
            }
        },
        goNext() {
            if (this.currentPage < this.pageCount) {
                this.currentPage++;
                this.loadDictDataList(this.selectedDictType?.id);
            }
        },
        goToPage(page) {
            this.currentPage = page;
            this.loadDictDataList(this.selectedDictType?.id);
        }
    },
    computed: {
        sourceRows() {
            return this.dictDataList;
        },
        selectedCount() {
            return this.dictDataList.filter(row => row.selected).length;
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
        }
    }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

// Page chrome lives in styles/ds.scss.

.content-panel {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 14px;
    align-items: start;
    background: transparent;
    border: 0;
}

@media (max-width: 1000px) {
    .content-panel { grid-template-columns: 1fr; }
}

.dict-type-panel {
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    overflow: hidden;
}

.dict-type-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 12px;

    .micro-label { margin-bottom: 0; }
}

.dict-data-card {
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    box-shadow: none;

    ::v-deep .el-card__body { padding: 0; }
}

.table-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-top: 1px solid $border-color;
    color: $text-light;
    font-size: 11.5px;
}

.delete-btn { color: $danger !important; }
</style>
