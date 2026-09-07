<template>
    <div class="welcome">

        <div class="page-head">
            <div>
                <h1 class="page-title">OTA Firmware</h1>
                <p class="page-lead">Firmware builds, who is on them and what is still rolling out.</p>
            </div>
            <div class="page-actions">
                <el-button size="small" type="primary" @click="showAddDialog">Upload firmware</el-button>
            </div>
        </div>

        <ListToolbar
            :count="total"
            count-noun="builds"
            :total="total"
            :sort-options="sortOptions"
            :sort-by.sync="sortBy"
            :sort-dir.sync="sortDir"
            :group-options="groupOptions"
            :group-by.sync="groupBy"
            :selecting.sync="selecting"
            :selected-count="selectedCount"
            :all-selected="isAllSelected"
            :search.sync="searchName"
            search-placeholder="Enter firmware name to search"
            @select-all-matching="selectAllRows"
            @clear-selection="clearSelection"
        >
            <template #bulk>
                <el-button @click="downloadSelected">Download</el-button>
                <el-button type="danger" @click="deleteSelectedParams">Archive build</el-button>
            </template>
        </ListToolbar>

        <div class="main-wrapper">
            <div class="content-panel">
                <div class="content-area">
                    <!-- Connected Devices Summary Card -->
                    <div class="bento g4">
                        <div class="card kpi">
                            <div class="kpi-label">Connected devices</div>
                            <div class="kpi-value">{{ connectedDevices.total || 0 }}</div>
                            <div class="kpi-delta"><a class="refresh-link" @click="fetchConnectedDevices">Refresh</a></div>
                        </div>
                        <div class="card kpi">
                            <div class="kpi-label">Builds stored</div>
                            <div class="kpi-value">{{ total }}</div>
                        </div>
                        <div class="card kpi">
                            <div class="kpi-label">Forced builds</div>
                            <div class="kpi-value">{{ forcedCount }}</div>
                        </div>
                        <div class="card kpi">
                            <div class="kpi-label">Firmware types</div>
                            <div class="kpi-value">{{ (firmwareTypes || []).length }}</div>
                        </div>
                    </div>
                    
                    <el-card class="params-card" shadow="never">
                        <el-table ref="paramsTable" :data="visibleRows" class="transparent-table" v-loading="loading"
                            element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                            element-loading-background="rgba(250, 249, 247, 0.75)"
                            :row-class-name="otaRowClass"
                            @sort-change="onTableSortChange"
                            :header-cell-class-name="headerCellClassName">
                            <el-table-column v-if="selecting" label="" align="center" width="52">
                                <template slot-scope="scope">
                                    <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                </template>
                            </el-table-column>
                            <el-table-column label="Firmware Name" prop="firmwareName" min-width="190" sortable="custom">
                                <template slot-scope="scope">
                                    <div class="rowid">
                                        <span class="rowid-mark accent"><i class="el-icon-cpu"></i></span>
                                        <span class="cell-key">{{ scope.row.firmwareName }}</span>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="Firmware Type" prop="type" min-width="140" sortable="custom">
                                <template slot-scope="scope">
                                    {{ getFirmwareTypeName(scope.row.type) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Version" prop="version" width="120" sortable="custom">
                                <template slot-scope="scope"><span class="mono">{{ scope.row.version }}</span></template>
                            </el-table-column>
                            <el-table-column label="Force Update" prop="forceUpdate" width="150" sortable="custom">
                                <template slot-scope="scope">
                                    <el-tooltip :content="getForceUpdateTooltip(scope.row)" placement="top">
                                        <el-switch
                                            v-model="scope.row.forceUpdate"
                                            :active-value="1"
                                            :inactive-value="0"
                                            active-color="#16130F"
                                            inactive-color="#E7E2D9"
                                            @change="handleForceUpdateToggle(scope.row)"
                                            :disabled="isSwitchDisabled(scope.row)">
                                        </el-switch>
                                    </el-tooltip>
                                    <span v-if="scope.row.forceUpdate === 1" class="chip ok force-chip">Forced</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="File Size" prop="size" width="110" align="right" sortable="custom">
                                <template slot-scope="scope">
                                    {{ formatFileSize(scope.row.size) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Remark" prop="remark" min-width="180" show-overflow-tooltip>
                                <template slot-scope="scope">{{ scope.row.remark || '—' }}</template>
                            </el-table-column>
                            <el-table-column label="Create Time" prop="createDate" min-width="150" sortable="custom">
                                <template slot-scope="scope">
                                    <span class="mono">{{ formatDate(scope.row.createDate) }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Update Time" prop="updateDate" min-width="150" sortable="custom">
                                <template slot-scope="scope">
                                    <span class="mono">{{ formatDate(scope.row.updateDate) }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Actions" align="right" width="200">
                                <template slot-scope="scope">
                                    <div class="row-actions">
                                        <el-button type="text" @click="downloadFirmware(scope.row)">Download</el-button>
                                        <el-button type="text" @click="editParam(scope.row)">Edit</el-button>
                                        <el-button type="text" class="delete-btn" @click="deleteParam(scope.row)">Delete</el-button>
                                    </div>
                                </template>
                            </el-table-column>
                            <template slot="empty">
                                <div class="ds-empty"><b>No firmware builds yet.</b>Upload a build to start a rollout.</div>
                            </template>
                        </el-table>

                        <div class="table_bottom">
                            <div class="ctrl_btn">
                                <span class="muted">Showing {{ visibleRows.length }} of {{ total }} builds</span>
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

        <!-- Add/Edit Firmware Dialog -->
        <firmware-dialog :title="dialogTitle" :visible.sync="dialogVisible" :form="firmwareForm"
            :firmware-types="firmwareTypes" @submit="handleSubmit" @cancel="dialogVisible = false" />
        <el-footer>
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import Api from "@/apis/api";
import FirmwareDialog from "@/components/FirmwareDialog.vue";
import VersionFooter from "@/components/VersionFooter.vue";
import { formatDate, formatFileSize } from "@/utils/format";
import ListToolbar from "@/components/ListToolbar.vue";
import listControls from "@/mixins/listControls";

export default {
  name: 'OtaManagement',
    components: { FirmwareDialog, VersionFooter, ListToolbar },
    mixins: [listControls],
    data() {
        return {
            // list controls — selection stays on `row.selected`
            sortBy: 'updateDate',
            sortDir: 'desc',
            sortOptions: [
                { label: 'Update time', value: 'updateDate' },
                { label: 'Create time', value: 'createDate' },
                { label: 'Firmware name', value: 'firmwareName' },
                { label: 'Version', value: 'version' },
                { label: 'File size', value: 'size' }
            ],
            groupOptions: [
                { label: 'None', value: '' },
                { label: 'Firmware type', value: 'type' }
            ],
            searchTimer: null,
            searchName: "",
            loading: false,
            paramsList: [],
            firmwareList: [],
            currentPage: 1,
            pageSize: 10,
            pageSizeOptions: [10, 20, 50, 100],
            total: 0,
            dialogVisible: false,
            dialogTitle: "New Firmware",
            isAllSelected: false,
            firmwareForm: {
                id: null,
                firmwareName: "",
                type: "",
                version: "",
                size: 0,
                remark: "",
                firmwarePath: "",
                forceUpdate: 0
            },
            firmwareTypes: [],
            connectedDevices: {
                total: 0,
                activeToday: 0,
                versionDistribution: {}
            }
        };
    },
    created() {
        this.fetchFirmwareList();
        this.getFirmwareTypes();
        this.fetchConnectedDevices();
    },

    beforeDestroy() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
    },
    watch: {
        searchName() {
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => this.handleSearch(), 350);
        }
    },
    computed: {
        sourceRows() {
            return this.paramsList;
        },
        selectedCount() {
            return this.paramsList.filter(row => row.selected).length;
        },
        forcedCount() {
            return this.paramsList.filter(row => row.forceUpdate === 1).length;
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
            this.fetchFirmwareList();
        },
        fetchFirmwareList() {
            this.loading = true;
            const params = {
                pageNum: this.currentPage,
                pageSize: this.pageSize,
                firmwareName: this.searchName || "",
                orderField: "create_date",
                order: "desc"
            };
            Api.ota.getOtaList(params, (res) => {
                this.loading = false;
                res = res.data
                if (res.code === 0) {
                    this.firmwareList = res.data.list.map(item => ({
                        ...item,
                        selected: false
                    }));
                    this.paramsList = this.firmwareList;
                    this.total = res.data.total || 0;
                } else {
                    this.firmwareList = [];
                    this.paramsList = [];
                    this.total = 0;
                    this.$message.error({
                        message: res?.data?.msg || 'Failed to get firmware list',
                        showClose: true
                    });
                }
            });
        },
        handleSearch() {
            this.currentPage = 1;
            this.fetchFirmwareList();
        },
        otaRowClass({ row }) {
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
        downloadSelected() {
            this.paramsList.filter(row => row.selected).forEach(row => this.downloadFirmware(row));
        },
        handleSelectAll() {
            this.isAllSelected = !this.isAllSelected;
            this.firmwareList.forEach(row => {
                row.selected = this.isAllSelected;
            });
        },
        showAddDialog() {
            this.dialogTitle = "New Firmware";
            // Completely reset form data
            this.firmwareForm = {
                id: null,
                firmwareName: "",
                type: "",
                version: "",
                size: 0,
                remark: "",
                firmwarePath: "",
                forceUpdate: 0
            };
            this.$nextTick(() => {
                // Reset form validation state
                if (this.$refs.firmwareDialog && this.$refs.firmwareDialog.$refs.form) {
                    this.$refs.firmwareDialog.$refs.form.clearValidate();
                }
            });
            this.dialogVisible = true;
        },
        editParam(row) {
            this.dialogTitle = "Edit Firmware";
            this.firmwareForm = { ...row };
            this.dialogVisible = true;
        },
        handleSubmit(form) {
            if (form.id) {
                // Edit
                Api.ota.updateOta(form.id, form, (res) => {
                    res = res.data;
                    if (res.code === 0) {
                        this.$message.success({
                            message: "Update successful",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchFirmwareList();
                    } else {
                        this.$message.error({
                            message: res.msg || "Update failed",
                            showClose: true
                        });
                    }
                });
            } else {
                // Add
                Api.ota.saveOta(form, (res) => {
                    res = res.data;
                    if (res.code === 0) {
                        this.$message.success({
                            message: "Add successful",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchFirmwareList();
                    } else {
                        this.$message.error({
                            message: res.msg || "Add failed",
                            showClose: true
                        });
                    }
                });
            }
        },

        deleteSelectedParams() {
            const selectedRows = this.firmwareList.filter(row => row.selected);
            if (selectedRows.length === 0) {
                this.$message.warning({
                    message: "Please select firmware to delete first",
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
                    message: "Please select parameters to delete first",
                    showClose: true
                });
                return;
            }

            const paramCount = params.length;
            this.$confirm(`Are you sure you want to delete ${paramCount} selected firmware?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning',
                distinguishCancelAndClose: true
            }).then(() => {
                const ids = params.map(param => param.id);
                if (ids.some(id => !id)) {
                    this.$message.error({
                        message: 'Invalid parameter ID exists',
                        showClose: true
                    });
                    return;
                }

                Api.ota.deleteOta(ids, (res) => {
                    res = res.data;
                    if (res.code === 0) {
                        this.$message.success({
                            message: `Successfully deleted ${paramCount} firmware`,
                            showClose: true
                        });
                        this.fetchFirmwareList();
                    } else {
                        this.$message.error({
                            message: res.msg || 'Delete failed, please try again',
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
            this.fetchFirmwareList();
        },
        goPrev() {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.fetchFirmwareList();
            }
        },
        goNext() {
            if (this.currentPage < this.pageCount) {
                this.currentPage++;
                this.fetchFirmwareList();
            }
        },
        goToPage(page) {
            this.currentPage = page;
            this.fetchFirmwareList();
        },
        downloadFirmware(firmware) {
            if (!firmware || !firmware.id) {
                this.$message.error('Incomplete firmware information');
                return;
            }
            // First get download link
            Api.ota.getDownloadUrl(firmware.id, (res) => {
                if (res.data.code === 0) {
                    const uuid = res.data.data;
                    const baseUrl = process.env.VUE_APP_API_BASE_URL || '';
                    window.open(`${window.location.origin}${baseUrl}/otaMag/download/${uuid}`);
                } else {
                    this.$message.error('Failed to get download link');
                }
            });
        },
        formatDate,
        formatFileSize,
        async getFirmwareTypes() {
            try {
                const res = await Api.dict.getDictDataByType('FIRMWARE_TYPE')
                this.firmwareTypes = res.data
            } catch (error) {
                console.error('Failed to get firmware types:', error)
                this.$message.error(error.message || 'Failed to get firmware types')
            }
        },
        getFirmwareTypeName(type) {
            const firmwareType = this.firmwareTypes.find(item => item.key === type)
            return firmwareType ? firmwareType.name : type
        },
        fetchConnectedDevices() {
            // Fetch connected devices statistics
            // This would call an API endpoint to get device statistics
            // For now, we'll use the device management API to get device info
            const currentAgentId = localStorage.getItem('agentId') || this.$route.query.agentId;
            if (currentAgentId) {
                Api.device.getAgentBindDevices(currentAgentId, ({data}) => {
                    if (data.code === 0 && data.data) {
                        const devices = data.data;
                        this.connectedDevices.total = devices.length;

                        // Count devices active today
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        this.connectedDevices.activeToday = devices.filter(device => {
                            const lastConnected = new Date(device.lastConnectedAt);
                            return lastConnected >= today;
                        }).length;

                        // Calculate version distribution
                        const versionMap = {};
                        devices.forEach(device => {
                            const version = device.appVersion || 'Unknown';
                            versionMap[version] = (versionMap[version] || 0) + 1;
                        });
                        this.connectedDevices.versionDistribution = versionMap;
                    }
                });
            }
        },
        handleForceUpdateToggle(row) {
            const action = row.forceUpdate === 1 ? 'enable' : 'disable';
            const message = row.forceUpdate === 1
                ? `Are you sure you want to FORCE all devices of type "${this.getFirmwareTypeName(row.type)}" to update/downgrade to version ${row.version}? This will affect ALL devices regardless of their current version.`
                : `Are you sure you want to disable force update for version ${row.version}?`;

            this.$confirm(message, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning',
                distinguishCancelAndClose: true
            }).then(() => {
                Api.ota.setForceUpdate(row.id, {
                    forceUpdate: row.forceUpdate,
                    type: row.type
                }, (res) => {
                    res = res.data;
                    if (res.code === 0) {
                        this.$message.success({
                            message: action === 'enable' ? 'Force update enabled successfully' : 'Force update disabled successfully',
                            showClose: true
                        });
                        this.fetchFirmwareList(); // Refresh to show updated state
                    } else {
                        this.$message.error({
                            message: res.msg || 'Operation failed',
                            showClose: true
                        });
                        // Revert the switch
                        row.forceUpdate = row.forceUpdate === 1 ? 0 : 1;
                    }
                });
            }).catch(() => {
                // User cancelled, revert the switch
                row.forceUpdate = row.forceUpdate === 1 ? 0 : 1;
            });
        },
        isSwitchDisabled(row) {
            // Disable if another firmware of the same type already has force update enabled
            if (row.forceUpdate === 1) {
                return false; // Allow disabling current force update
            }
            // Check if there's already a force update for this type
            return this.paramsList.some(item =>
                item.type === row.type &&
                item.id !== row.id &&
                item.forceUpdate === 1
            );
        },
        getForceUpdateTooltip(row) {
            if (row.forceUpdate === 1) {
                return 'Force update is ACTIVE. All devices will update to this version.';
            }
            if (this.isSwitchDisabled(row)) {
                return 'Another version already has force update enabled for this type.';
            }
            return 'Enable to force all devices to this version (including downgrades)';
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

.table_bottom { border-top: 1px solid $border-color; }

.force-chip { margin-left: 8px; }

.refresh-link {
    color: $text-gray;
    cursor: pointer;
    border-bottom: 1px solid $border-color;

    &:hover { color: $text-dark; }
}

.delete-btn { color: $danger !important; }
</style>
