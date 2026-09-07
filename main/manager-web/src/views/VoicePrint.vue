<template>
    <div class="welcome">

        <div class="page-head">
            <div>
                <h1 class="page-title">Voice Recognition</h1>
                <p class="page-lead">Enrolled voice prints let one toy tell a child apart from a sibling or a parent.</p>
            </div>
            <div class="page-actions">
                <el-button size="small" type="primary" @click="showAddDialog">Enrol voice</el-button>
            </div>
        </div>

        <ListToolbar
            :count="voicePrintList.length"
            count-noun="voice prints"
            :total="voicePrintList.length"
            :sort-options="sortOptions"
            :sort-by.sync="sortBy"
            :sort-dir.sync="sortDir"
            :selecting.sync="selecting"
            :selected-count="selectedCount"
            :all-selected="allSelected"
            :search.sync="listSearch"
            search-placeholder="Name or description"
            @select-all-matching="selectAllMatching"
            @clear-selection="clearSelection"
        >
            <template #bulk>
                <el-button type="danger" @click="deleteSelected">Delete prints</el-button>
            </template>
        </ListToolbar>

        <div class="main-wrapper">
            <div class="content-panel">
                <div class="content-area">
                    <el-card class="voice-print-card" shadow="never">
                        <el-table ref="table" :data="visibleRows" class="transparent-table" v-loading="loading"
                            element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                            element-loading-background="rgba(250, 249, 247, 0.75)"
                            :row-class-name="rowClass"
                            @sort-change="onTableSortChange"
                            @selection-change="onSelectionChange">
                            <el-table-column v-if="selecting" type="selection" width="44" />
                            <el-table-column label="Name" prop="sourceName" min-width="200" sortable="custom">
                                <template slot-scope="scope">
                                    <div class="rowid">
                                        <span class="rowid-mark accent">{{ initials(scope.row.sourceName) }}</span>
                                        <span class="cell-key">{{ scope.row.sourceName }}</span>
                                    </div>
                                </template>
                            </el-table-column>
                            <el-table-column label="Description" prop="introduce" min-width="280">
                                <template slot-scope="scope">{{ scope.row.introduce || '—' }}</template>
                            </el-table-column>
                            <el-table-column label="Create Time" prop="createDate" min-width="170" sortable="custom">
                                <template slot-scope="scope"><span class="mono">{{ scope.row.createDate }}</span></template>
                            </el-table-column>
                            <el-table-column label="Actions" align="right" width="150">
                                <template slot-scope="scope">
                                    <div class="row-actions">
                                        <el-button type="text" @click="editVoicePrint(scope.row)">Edit</el-button>
                                        <el-button type="text" class="delete-btn" @click="deleteVoicePrint(scope.row.id)">Delete</el-button>
                                    </div>
                                </template>
                            </el-table-column>
                            <template slot="empty">
                                <div class="ds-empty"><b>No voice prints enrolled.</b>Enrol a voice so the toy can tell speakers apart.</div>
                            </template>
                        </el-table>

                        <div class="list-footer">
                            <span>Showing {{ visibleRows.length }} of {{ voicePrintList.length }} voice prints</span>
                        </div>
                    </el-card>
                </div>
            </div>
        </div>

        <!-- Add/Edit Parameter Dialog -->
        <voice-print-dialog :title="dialogTitle" :visible.sync="dialogVisible" :agentId="agentId" :form="paramForm"
            @submit="handleSubmit" @cancel="dialogVisible = false" />
        <el-footer>
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";
import VoicePrintDialog from "@/components/VoicePrintDialog.vue";
import ListToolbar from "@/components/ListToolbar.vue";
import listControls from "@/mixins/listControls";
export default {
    name: 'VoicePrint',
    components: { VoicePrintDialog, VersionFooter, ListToolbar },
    mixins: [listControls],
    data() {
        return {
            sortBy: 'createDate',
            sortDir: 'desc',
            sortOptions: [
                { label: 'Create time', value: 'createDate' },
                { label: 'Name', value: 'sourceName' }
            ],
            searchFields: ['sourceName', 'introduce'],
            voicePrintList: [],
            loading: false,
            dialogVisible: false,
            dialogTitle: "Add Speaker",
            isAllSelected: false,
            paramForm: {
                id: null,
                audioId: '',
                sourceName: '',
                introduce: ''
            },
            agentId: "1"
        };
    },
    mounted() {
        const agentId = this.$route.query.agentId;
        if (agentId) {
            this.agentId = agentId
            this.fetchVoicePrints();
        }
    },
    computed: {
        sourceRows() {
            return this.voicePrintList;
        }
    },
    methods: {
        initials(name) {
            const value = String(name || '').trim();
            if (!value) return '—';
            const parts = value.split(/\s+/).filter(Boolean);
            return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
        },
        deleteSelected() {
            const rows = this.selectedRows;
            if (!rows.length) return;
            this.$confirm(`Delete ${rows.length} voice print${rows.length === 1 ? '' : 's'}?`, 'Delete prints', {
                confirmButtonText: 'Delete',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                rows.forEach(row => this.deleteVoicePrint(row.id, true));
                this.clearSelection();
            }).catch(() => {});
        },
        fetchVoicePrints() {
            this.loading = true;
            Api.agent.getAgentVoicePrintList(this.agentId,
                ({ data }) => {
                    this.loading = false;
                    if (data.code === 0) {
                        this.voicePrintList = data.data.map(item => ({
                            ...item }));
                    } else {
                        this.$message.error({
                            message: data.msg || 'Failed to get voice print list',
                            showClose: true
                        });
                    }
                }
            );
        },
        showAddDialog() {
            this.dialogTitle = "Add Speaker";
            this.paramForm = {
                id: null,
                audioId: '',
                sourceName: '',
                introduce: ''
            };
            this.dialogVisible = true;
        },
        editVoicePrint(row) {
            this.dialogTitle = "Edit Speaker";
            this.paramForm = { ...row };
            this.dialogVisible = true;
        },

        handleSubmit({ form, done }) {
            if (form.id) {
                // Edit
                Api.agent.updateAgentVoicePrint(form, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: "Update successful",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchVoicePrints();
                    }
                    done && done();
                });
            } else {
                // Add
                Api.agent.addAgentVoicePrint({
                    agentId: this.agentId,
                    audioId: form.audioId,
                    sourceName: form.sourceName,
                    introduce: form.introduce
                }, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: "Add successful",
                            showClose: true
                        });
                        this.dialogVisible = false;
                        this.fetchVoicePrints();
                    }
                    done && done();
                });
            }
        },
        // Delete button
        // `skipConfirm` is set by the bulk path, which confirms once for the
        // whole selection.
        deleteVoicePrint(id, skipConfirm) {
            const run = () => {
                Api.agent.deleteAgentVoicePrint(id, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success({
                            message: `Successfully deleted voice print`,
                            showClose: true
                        });
                        this.fetchVoicePrints();
                    } else {
                        this.$message.error({
                            message: data.msg || 'Delete failed, please try again',
                            showClose: true
                        });
                    }
                });
            };

            if (skipConfirm) {
                run();
                return;
            }

            this.$confirm(`Are you sure you want to delete this voice print?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning',
                distinguishCancelAndClose: true
            }).then(run).catch(action => {
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
        } } };
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

// Page chrome lives in styles/ds.scss.

.voice-print-card {
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    box-shadow: none;

    ::v-deep .el-card__body { padding: 0; }
}

.delete-btn { color: $danger !important; }
</style>
