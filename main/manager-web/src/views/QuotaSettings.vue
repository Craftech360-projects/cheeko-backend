<template>
    <div class="welcome">
        <HeaderBar />

        <div class="operation-bar">
            <h2 class="page-title">Quota System Settings</h2>
        </div>

        <div class="main-wrapper">
            <div class="content-panel">
                <div class="content-area" v-loading="loading">

                    <!-- Active Quota System Selector -->
                    <el-card class="settings-card" shadow="never">
                        <div slot="header" class="card-header">
                            <span>Default Quota System</span>
                            <el-tag :type="savedType === form.defaultQuotaType ? 'info' : 'warning'" size="small">
                                {{ savedType === form.defaultQuotaType ? 'Current' : 'Unsaved Changes' }}
                            </el-tag>
                        </div>
                        <p class="description">Choose the default quota system for users without a subscription plan. This determines how free-tier usage is tracked and limited.</p>

                        <el-radio-group v-model="form.defaultQuotaType" class="quota-type-selector" @change="onTypeChange">
                            <el-radio-button label="question">
                                <i class="el-icon-chat-dot-round"></i> Question Based
                            </el-radio-button>
                            <el-radio-button label="token">
                                <i class="el-icon-coin"></i> Token Based
                            </el-radio-button>
                            <el-radio-button label="time">
                                <i class="el-icon-timer"></i> Time Based
                            </el-radio-button>
                        </el-radio-group>

                        <div class="type-description">
                            <div v-if="form.defaultQuotaType === 'question'" class="type-info">
                                <h4>Question Based</h4>
                                <p>Each speech turn counts as 1 question. Simple and predictable. Best for: free-tier users with limited usage.</p>
                            </div>
                            <div v-if="form.defaultQuotaType === 'token'" class="type-info">
                                <h4>Token Based</h4>
                                <p>Tracks weighted LLM tokens (audio x 1.5 + text x 1.0). Fairer for varying conversation complexity. Best for: paid plans where some conversations are longer than others.</p>
                            </div>
                            <div v-if="form.defaultQuotaType === 'time'" class="type-info">
                                <h4>Time Based</h4>
                                <p>Tracks connected session time (like a phone call timer). Time ticks regardless of speech activity. Best for: simple billing model parents understand easily.</p>
                            </div>
                        </div>
                    </el-card>

                    <!-- Free Tier Limits -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>Free Tier Limits</span>
                            <el-tag type="info" size="small">Per device, per month</el-tag>
                        </div>
                        <p class="description">Configure the monthly limits for free users (no subscription). Each device gets its own independent quota.</p>

                        <el-form :model="form" label-width="200px" class="limits-form">
                            <el-form-item label="Question Limit" :class="{ 'active-limit': form.defaultQuotaType === 'question' }">
                                <el-input-number v-model="form.freeQuestionLimit" :min="1" :max="1000" :step="5"></el-input-number>
                                <span class="limit-hint">questions / month</span>
                                <el-tag v-if="form.defaultQuotaType === 'question'" type="success" size="mini" style="margin-left: 10px;">Active</el-tag>
                            </el-form-item>

                            <el-form-item label="Token Limit" :class="{ 'active-limit': form.defaultQuotaType === 'token' }">
                                <el-input-number v-model="form.freeTokenLimit" :min="1000" :max="1000000" :step="5000"></el-input-number>
                                <span class="limit-hint">tokens / month</span>
                                <el-tag v-if="form.defaultQuotaType === 'token'" type="success" size="mini" style="margin-left: 10px;">Active</el-tag>
                            </el-form-item>

                            <el-form-item label="Time Limit" :class="{ 'active-limit': form.defaultQuotaType === 'time' }">
                                <el-input-number v-model="timeLimitMinutes" :min="5" :max="1440" :step="5"></el-input-number>
                                <span class="limit-hint">minutes / month ({{ formatTime(form.freeTimeLimit) }})</span>
                                <el-tag v-if="form.defaultQuotaType === 'time'" type="success" size="mini" style="margin-left: 10px;">Active</el-tag>
                            </el-form-item>
                        </el-form>
                    </el-card>

                    <!-- Save Button -->
                    <div class="save-bar">
                        <el-button type="primary" @click="saveSettings" :loading="saving" icon="el-icon-check">
                            Save Settings
                        </el-button>
                        <el-button @click="loadSettings" icon="el-icon-refresh">Reset</el-button>
                    </div>

                    <!-- Subscription Plans Overview -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>Subscription Plans</span>
                            <el-tag type="info" size="small">{{ plans.length }} plans</el-tag>
                        </div>
                        <p class="description">Users subscribed to a plan use the plan's quota type regardless of the default setting above.</p>

                        <el-table :data="plans" class="transparent-table" :header-cell-class-name="headerCellClassName">
                            <el-table-column label="Plan" prop="plan_name" align="center"></el-table-column>
                            <el-table-column label="Code" prop="plan_code" align="center"></el-table-column>
                            <el-table-column label="Quota Type" align="center">
                                <template slot-scope="scope">
                                    <el-tag :type="quotaTypeColor(scope.row.quota_type)" size="small">
                                        {{ scope.row.quota_type }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="Limit" align="center">
                                <template slot-scope="scope">
                                    <span v-if="scope.row.quota_type === 'question'">{{ scope.row.question_limit }} questions</span>
                                    <span v-else-if="scope.row.quota_type === 'token'">
                                        {{ scope.row.token_limit === -1 ? 'Unlimited' : scope.row.token_limit.toLocaleString() + ' tokens' }}
                                    </span>
                                    <span v-else-if="scope.row.quota_type === 'time'">{{ formatTime(scope.row.time_limit_secs) }}</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Price" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.price_inr === 0 ? 'Free' : '₹' + (scope.row.price_inr / 100).toFixed(0) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Billing" prop="billing_period" align="center"></el-table-column>
                            <el-table-column label="Status" align="center">
                                <template slot-scope="scope">
                                    <el-tag :type="scope.row.is_active ? 'success' : 'danger'" size="mini">
                                        {{ scope.row.is_active ? 'Active' : 'Inactive' }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                        </el-table>
                    </el-card>

                </div>
            </div>
        </div>
    </div>
</template>

<script>
import HeaderBar from '../components/HeaderBar.vue'
import Api from '../apis/api'

export default {
    name: 'QuotaSettings',
    components: { HeaderBar },
    data() {
        return {
            loading: false,
            saving: false,
            savedType: 'question',
            form: {
                defaultQuotaType: 'question',
                freeQuestionLimit: 20,
                freeTokenLimit: 10000,
                freeTimeLimit: 1800
            },
            plans: []
        }
    },
    computed: {
        timeLimitMinutes: {
            get() {
                return Math.round(this.form.freeTimeLimit / 60)
            },
            set(val) {
                this.form.freeTimeLimit = val * 60
            }
        }
    },
    mounted() {
        this.loadSettings()
        this.loadPlans()
    },
    methods: {
        loadSettings() {
            this.loading = true
            Api.subscription.getQuotaSettings(
                (res) => {
                    this.loading = false
                    if (res.data) {
                        this.form.defaultQuotaType = res.data.defaultQuotaType || 'question'
                        this.form.freeQuestionLimit = res.data.freeQuestionLimit || 20
                        this.form.freeTokenLimit = res.data.freeTokenLimit || 10000
                        this.form.freeTimeLimit = res.data.freeTimeLimit || 1800
                        this.savedType = this.form.defaultQuotaType
                    }
                },
                () => {
                    this.loading = false
                    this.$message.error('Failed to load quota settings')
                }
            )
        },

        loadPlans() {
            Api.subscription.getPlans(
                (res) => {
                    this.plans = res.data || []
                },
                () => {
                    this.$message.error('Failed to load subscription plans')
                }
            )
        },

        saveSettings() {
            this.saving = true
            Api.subscription.updateQuotaSettings(
                this.form,
                (res) => {
                    this.saving = false
                    if (res.data) {
                        this.savedType = res.data.defaultQuotaType
                        this.$message.success('Quota settings saved successfully')
                    }
                },
                () => {
                    this.saving = false
                    this.$message.error('Failed to save quota settings')
                }
            )
        },

        onTypeChange() {
            // Visual feedback only
        },

        formatTime(seconds) {
            if (!seconds || seconds <= 0) return '0m'
            const hours = Math.floor(seconds / 3600)
            const mins = Math.floor((seconds % 3600) / 60)
            if (hours > 0) return `${hours}h ${mins}m`
            return `${mins}m`
        },

        quotaTypeColor(type) {
            const map = { question: '', token: 'warning', time: 'success' }
            return map[type] || 'info'
        },

        headerCellClassName() {
            return 'table-header-cell'
        }
    }
}
</script>

<style scoped>
.settings-card {
    border-radius: 8px;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 16px;
    font-weight: 600;
}

.description {
    color: #909399;
    font-size: 13px;
    margin-bottom: 20px;
    line-height: 1.5;
}

.quota-type-selector {
    margin-bottom: 20px;
}

.quota-type-selector .el-radio-button__inner {
    padding: 12px 24px;
}

.type-description {
    margin-top: 16px;
}

.type-info {
    background: #f0f9ff;
    border-left: 3px solid #409EFF;
    padding: 12px 16px;
    border-radius: 0 4px 4px 0;
}

.type-info h4 {
    margin: 0 0 6px 0;
    color: #303133;
}

.type-info p {
    margin: 0;
    color: #606266;
    font-size: 13px;
}

.limits-form {
    max-width: 600px;
}

.limit-hint {
    margin-left: 10px;
    color: #909399;
    font-size: 13px;
}

.active-limit {
    background: #f0f9eb;
    border-radius: 4px;
    padding: 4px 8px;
}

.save-bar {
    margin-top: 24px;
    text-align: center;
}

.transparent-table {
    background: transparent;
}

.table-header-cell {
    background: #fafafa !important;
}
</style>
