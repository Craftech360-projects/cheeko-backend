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

                    <!-- AI Card Section Separator -->
                    <el-divider class="section-divider"><i class="el-icon-cpu"></i> AI Card Time Subscription</el-divider>

                    <!-- AI Card Fail Mode Settings -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>AI Card Fail-Safe Mode</span>
                            <el-tag :type="aiFailMode === 'open' ? 'warning' : 'success'" size="small">
                                {{ aiFailMode || 'Loading...' }}
                            </el-tag>
                        </div>
                        <p class="description">Configure how AI Cards behave when the Manager API is unreachable. "Open" allows unlimited sessions. "Capped" allows up to 10 minutes locally then hard stops.</p>

                        <el-radio-group v-model="aiFailMode" class="quota-type-selector" @change="onAiFailModeChange">
                            <el-radio-button label="open">
                                <i class="el-icon-unlock"></i> Fail-Open (Unlimited)
                            </el-radio-button>
                            <el-radio-button label="capped">
                                <i class="el-icon-lock"></i> Fail-Capped (10 min local)
                            </el-radio-button>
                        </el-radio-group>
                    </el-card>

                    <!-- AI Cards Linked to Users/Devices -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>AI Cards — Linked to Users & Devices</span>
                            <div class="header-actions">
                                <el-select v-model="linkedCardsMonth" placeholder="Month" size="small" style="margin-right: 10px;" @change="loadLinkedCards">
                                    <el-option v-for="m in availableMonths" :key="m" :label="m" :value="m"></el-option>
                                </el-select>
                                <el-button size="small" @click="loadLinkedCards" icon="el-icon-refresh">Refresh</el-button>
                            </div>
                        </div>
                        <p class="description">AI Cards that have been tapped, showing which user and device they are linked to, with remaining time.</p>

                        <el-table :data="linkedCards" class="transparent-table" :header-cell-class-name="headerCellClassName" v-loading="linkedCardsLoading">
                            <el-table-column label="Card Name" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.cardName || 'AI Card' }}
                                </template>
                            </el-table-column>
                            <el-table-column label="RFID UID" prop="rfidUid" align="center" width="140"></el-table-column>
                            <el-table-column label="User ID" align="center">
                                <template slot-scope="scope">
                                    <span v-if="scope.row.userId">{{ scope.row.userId }}</span>
                                    <span v-else class="text-muted">— Not linked —</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="MAC Address" align="center">
                                <template slot-scope="scope">
                                    <span v-if="scope.row.macAddress" class="monospace">{{ scope.row.macAddress }}</span>
                                    <span v-else class="text-muted">—</span>
                                </template>
                            </el-table-column>
                            <el-table-column label="Monthly Limit" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.monthlyTimeLimit === 0 ? 'Unconfigured' : scope.row.monthlyTimeLimit === -1 ? 'Unlimited' : formatTime(scope.row.monthlyTimeLimit) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Remaining" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.remainingSeconds !== undefined ? formatTime(scope.row.remainingSeconds) : '—' }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Status" align="center" width="120">
                                <template slot-scope="scope">
                                    <el-tag :type="statusTagType(scope.row.status)" size="mini">
                                        {{ (scope.row.status || 'active').charAt(0).toUpperCase() + (scope.row.status || 'active').slice(1) }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="Last Tapped" align="center" width="170">
                                <template slot-scope="scope">
                                    {{ scope.row.lastTapped ? formatDate(scope.row.lastTapped) : '—' }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Actions" align="center" width="120">
                                <template slot-scope="scope">
                                    <el-button type="text" size="mini" @click="openRechargeDialog(scope.row)" icon="el-icon-coin">Recharge</el-button>
                                </template>
                            </el-table-column>
                        </el-table>

                        <div class="pagination-bar">
                            <el-pagination
                                background
                                layout="prev, pager, next, total"
                                :total="linkedCardsTotal"
                                :page-size="linkedCardsPageSize"
                                :current-page="linkedCardsPage"
                                @current-change="onLinkedCardsPageChange">
                            </el-pagination>
                        </div>
                    </el-card>

                    <!-- AI Card Analytics Summary -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>AI Card Usage Analytics</span>
                            <el-tag type="info" size="small">{{ analyticsMonthKey || 'Current Month' }}</el-tag>
                        </div>
                        <p class="description">Overview of AI Card usage this month. Top cards by consumption, near-exhaustion alerts, and total active cards.</p>

                        <el-row :gutter="20" class="analytics-cards" v-loading="analyticsLoading">
                            <el-col :span="6">
                                <div class="stat-card">
                                    <div class="stat-value">{{ aiAnalytics.totalActiveCards || 0 }}</div>
                                    <div class="stat-label">Active Cards</div>
                                </div>
                            </el-col>
                            <el-col :span="6">
                                <div class="stat-card stat-danger">
                                    <div class="stat-value">{{ aiAnalytics.exhaustedCount || 0 }}</div>
                                    <div class="stat-label">Exhausted</div>
                                </div>
                            </el-col>
                            <el-col :span="6">
                                <div class="stat-card stat-warning">
                                    <div class="stat-value">{{ (aiAnalytics.nearExhaustion || []).length }}</div>
                                    <div class="stat-label">Near Limit (>80%)</div>
                                </div>
                            </el-col>
                            <el-col :span="6">
                                <div class="stat-card stat-info">
                                    <div class="stat-value">{{ (aiAnalytics.topCards || []).length }}</div>
                                    <div class="stat-label">Top Cards Tracked</div>
                                </div>
                            </el-col>
                        </el-row>

                        <!-- Near Exhaustion Alerts -->
                        <div v-if="aiAnalytics.nearExhaustion && aiAnalytics.nearExhaustion.length > 0" class="alert-section">
                            <h4><i class="el-icon-warning"></i> Cards Near Exhaustion</h4>
                            <el-table :data="aiAnalytics.nearExhaustion" class="transparent-table" size="small" :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Card" prop="cardName" align="center"></el-table-column>
                                <el-table-column label="RFID UID" prop="rfidUid" align="center"></el-table-column>
                                <el-table-column label="Used" align="center">
                                    <template slot-scope="scope">{{ formatTime(scope.row.secondsUsed) }}</template>
                                </el-table-column>
                                <el-table-column label="Remaining" align="center">
                                    <template slot-scope="scope">{{ formatTime(scope.row.remaining) }}</template>
                                </el-table-column>
                                <el-table-column label="% Used" align="center">
                                    <template slot-scope="scope">
                                        <el-progress :percentage="scope.row.pctUsed" :color="scope.row.pctUsed > 90 ? '#F56C6C' : scope.row.pctUsed > 70 ? '#E6A23C' : '#67C23A'" :show-text="false"></el-progress>
                                        <span>{{ scope.row.pctUsed }}%</span>
                                    </template>
                                </el-table-column>
                            </el-table>
                        </div>
                    </el-card>

                    <!-- AI Cards Table -->
                    <el-card class="settings-card" shadow="never" style="margin-top: 20px;">
                        <div slot="header" class="card-header">
                            <span>AI Cards — Time Quota</span>
                            <div class="header-actions">
                                <el-select v-model="aiCardsMonth" placeholder="Month" size="small" style="margin-right: 10px;" @change="loadAiCards">
                                    <el-option v-for="m in availableMonths" :key="m" :label="m" :value="m"></el-option>
                                </el-select>
                                <el-button size="small" @click="loadAiCards" icon="el-icon-refresh">Refresh</el-button>
                            </div>
                        </div>
                        <p class="description">All AI Cards with their monthly time quota. Use "Recharge" to add extra time for a specific card.</p>

                        <el-table :data="aiCards" class="transparent-table" :header-cell-class-name="headerCellClassName" v-loading="aiCardsLoading">
                            <el-table-column label="Card Name" prop="notes" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.notes || scope.row.cardName || 'AI Card' }}
                                </template>
                            </el-table-column>
                            <el-table-column label="RFID UID" prop="rfidUid" align="center" width="140"></el-table-column>
                            <el-table-column label="Monthly Limit" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.monthlyTimeLimit === 0 ? 'Unconfigured' : scope.row.monthlyTimeLimit === -1 ? 'Unlimited' : formatTime(scope.row.monthlyTimeLimit) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Used" align="center">
                                <template slot-scope="scope">
                                    {{ formatTime(scope.row.secondsUsed) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Extra (Recharged)" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.extraPurchased > 0 ? formatTime(scope.row.extraPurchased) : '—' }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Remaining" align="center">
                                <template slot-scope="scope">
                                    {{ scope.row.remainingSeconds !== undefined ? formatTime(scope.row.remainingSeconds) : formatTime(Math.max(0, (scope.row.monthlyTimeLimit || 0) + (scope.row.extraPurchased || 0) - (scope.row.secondsUsed || 0))) }}
                                </template>
                            </el-table-column>
                            <el-table-column label="Status" align="center">
                                <template slot-scope="scope">
                                    <el-tag :type="statusTagType(scope.row.status)" size="mini">
                                        {{ (scope.row.status || 'active').charAt(0).toUpperCase() + (scope.row.status || 'active').slice(1) }}
                                    </el-tag>
                                </template>
                            </el-table-column>
                            <el-table-column label="Actions" align="center" width="120">
                                <template slot-scope="scope">
                                    <el-button type="text" size="mini" @click="openRechargeDialog(scope.row)" icon="el-icon-coin">Recharge</el-button>
                                </template>
                            </el-table-column>
                        </el-table>

                        <!-- Pagination -->
                        <div class="pagination-bar">
                            <el-pagination
                                background
                                layout="prev, pager, next, total"
                                :total="aiCardsTotal"
                                :page-size="aiCardsPageSize"
                                :current-page="aiCardsPage"
                                @current-change="onAiCardsPageChange">
                            </el-pagination>
                        </div>
                    </el-card>

                </div>
            </div>
        </div>

        <!-- Recharge Dialog -->
        <el-dialog title="Recharge AI Card" :visible.sync="rechargeDialogVisible" width="420px">
            <div v-if="rechargeCard" class="recharge-dialog-content">
                <div class="recharge-card-info">
                    <strong>{{ rechargeCard.notes || rechargeCard.cardName || 'AI Card' }}</strong>
                    <span class="recharge-card-uid">{{ rechargeCard.rfidUid }}</span>
                </div>
                <div class="recharge-current">
                    Current remaining: <strong>{{ formatTime(rechargeCard.remainingSeconds || Math.max(0, (rechargeCard.monthlyTimeLimit || 0) + (rechargeCard.extraPurchased || 0) - (rechargeCard.secondsUsed || 0))) }}</strong>
                </div>
                <el-form label-position="top" style="margin-top: 16px;">
                    <el-form-item label="Add Time (minutes)">
                        <el-input-number v-model="rechargeMinutes" :min="1" :max="1440" :step="5" style="width: 100%;"></el-input-number>
                    </el-form-item>
                    <el-form-item label="Quick amounts">
                        <el-button-group>
                            <el-button size="small" @click="rechargeMinutes = 30">30 min</el-button>
                            <el-button size="small" @click="rechargeMinutes = 60">1 hour</el-button>
                            <el-button size="small" @click="rechargeMinutes = 120">2 hours</el-button>
                            <el-button size="small" @click="rechargeMinutes = 360">6 hours</el-button>
                        </el-button-group>
                    </el-form-item>
                </el-form>
            </div>
            <span slot="footer" class="dialog-footer">
                <el-button @click="rechargeDialogVisible = false">Cancel</el-button>
                <el-button type="primary" @click="confirmRecharge" :loading="recharging">Recharge</el-button>
            </span>
        </el-dialog>
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
            plans: [],

            // AI Card settings
            aiFailMode: 'open',

            // Linked cards (card → user → device)
            linkedCardsLoading: false,
            linkedCards: [],
            linkedCardsPage: 1,
            linkedCardsPageSize: 20,
            linkedCardsTotal: 0,
            linkedCardsMonth: '',

            // AI Card analytics
            analyticsLoading: false,
            analyticsMonthKey: '',
            aiAnalytics: {
                totalActiveCards: 0,
                exhaustedCount: 0,
                nearExhaustion: [],
                topCards: []
            },

            // AI Cards table
            aiCardsLoading: false,
            aiCards: [],
            aiCardsPage: 1,
            aiCardsPageSize: 20,
            aiCardsTotal: 0,
            aiCardsMonth: '',

            // Recharge dialog
            rechargeDialogVisible: false,
            rechargeCard: null,
            rechargeMinutes: 60,
            recharging: false
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
        },
        availableMonths() {
            const months = [];
            const now = new Date();
            for (let i = 0; i < 6; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }
            return months;
        }
    },
    mounted() {
        this.loadSettings()
        this.loadPlans()
        this.loadAiFailMode()
        this.loadLinkedCards()
        this.loadAiAnalytics()
        this.loadAiCards()
    },
    methods: {
        loadSettings() {
            this.loading = true
            Api.subscription.getQuotaSettings(
                (res) => {
                    this.loading = false
                    if (res.data && res.data.data) {
                        this.form.defaultQuotaType = res.data.data.defaultQuotaType || 'question'
                        this.form.freeQuestionLimit = res.data.data.freeQuestionLimit || 20
                        this.form.freeTokenLimit = res.data.data.freeTokenLimit || 10000
                        this.form.freeTimeLimit = res.data.data.freeTimeLimit || 1800
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
                    this.plans = (res.data && res.data.data) ? res.data.data : []
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
                    if (res.data && res.data.data) {
                        this.savedType = res.data.data.defaultQuotaType
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

        // ========== AI Card Methods ==========

        loadAiFailMode() {
            Api.subscription.getAiCardQuotaSettings(
                (res) => {
                    if (res.data && res.data.data) {
                        this.aiFailMode = res.data.data.failMode || 'open'
                    }
                },
                () => {
                    this.$message.error('Failed to load AI card fail mode settings')
                }
            )
        },

        onAiFailModeChange() {
            Api.subscription.updateAiCardQuotaSettings(
                { failMode: this.aiFailMode },
                (res) => {
                    if (res.data && res.data.data) {
                        this.aiFailMode = res.data.data.failMode
                        this.$message.success(`AI card fail mode set to "${this.aiFailMode}"`)
                    }
                },
                () => {
                    this.$message.error('Failed to update AI card fail mode')
                }
            )
        },

        loadLinkedCards() {
            this.linkedCardsLoading = true
            Api.subscription.getAiCardsLinked(
                this.linkedCardsPage,
                this.linkedCardsPageSize,
                this.linkedCardsMonth || undefined,
                (res) => {
                    this.linkedCardsLoading = false
                    if (res.data && res.data.data) {
                        this.linkedCards = res.data.data.cards || []
                        this.linkedCardsTotal = res.data.data.total || 0
                    }
                },
                () => {
                    this.linkedCardsLoading = false
                    this.$message.error('Failed to load linked AI cards')
                }
            )
        },

        onLinkedCardsPageChange(page) {
            this.linkedCardsPage = page
            this.loadLinkedCards()
        },

        loadAiAnalytics() {
            this.analyticsLoading = true
            Api.subscription.getAiCardAnalytics(
                this.aiCardsMonth || undefined,
                (res) => {
                    this.analyticsLoading = false
                    if (res.data && res.data.data) {
                        this.aiAnalytics = res.data.data
                        this.analyticsMonthKey = res.data.data.monthKey || ''
                    }
                },
                () => {
                    this.analyticsLoading = false
                }
            )
        },

        loadAiCards() {
            this.aiCardsLoading = true
            Api.subscription.getAiCardsSummary(
                this.aiCardsPage,
                this.aiCardsPageSize,
                this.aiCardsMonth || undefined,
                (res) => {
                    this.aiCardsLoading = false
                    if (res.data && res.data.data) {
                        this.aiCards = res.data.data.cards || []
                        this.aiCardsTotal = res.data.data.total || 0
                    }
                },
                () => {
                    this.aiCardsLoading = false
                    this.$message.error('Failed to load AI cards')
                }
            )
        },

        onAiCardsPageChange(page) {
            this.aiCardsPage = page
            this.loadAiCards()
        },

        openRechargeDialog(card) {
            this.rechargeCard = card
            this.rechargeMinutes = 60
            this.rechargeDialogVisible = true
        },

        confirmRecharge() {
            if (!this.rechargeCard || this.rechargeMinutes < 1) return

            this.recharging = true
            const seconds = this.rechargeMinutes * 60
            Api.subscription.rechargeAiCard(
                this.rechargeCard.rfidUid,
                seconds,
                (res) => {
                    this.recharging = false
                    if (res.data && res.data.data) {
                        this.$message.success(`Recharged ${this.rechargeMinutes} minutes (${seconds}s) for ${this.rechargeCard.notes || this.rechargeCard.cardName || 'card'}`)
                        this.rechargeDialogVisible = false
                        this.loadAiCards()
                        this.loadAiAnalytics()
                    }
                },
                (err) => {
                    this.recharging = false
                    this.$message.error('Failed to recharge card')
                }
            )
        },

        formatTime(seconds) {
            if (!seconds || seconds <= 0) return '0m'
            const hours = Math.floor(seconds / 3600)
            const mins = Math.floor((seconds % 3600) / 60)
            if (hours > 0) return `${hours}h ${mins}m`
            return `${mins}m`
        },

        formatDate(dateStr) {
            if (!dateStr) return '—'
            const d = new Date(dateStr)
            return d.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        },

        quotaTypeColor(type) {
            const map = { question: '', token: 'warning', time: 'success' }
            return map[type] || 'info'
        },

        statusTagType(status) {
            const map = { active: 'success', exhausted: 'danger', not_configured: 'info' }
            return map[status] || 'info'
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

/* AI Card Section */
.section-divider {
    margin: 32px 0 20px;
    font-size: 16px;
    font-weight: 600;
    color: #303133;
}

.section-divider i {
    margin-right: 6px;
}

.analytics-cards {
    margin-top: 16px;
}

.stat-card {
    background: #f0f9eb;
    border-radius: 8px;
    padding: 20px;
    text-align: center;
}

.stat-card.stat-danger {
    background: #fef0f0;
}

.stat-card.stat-warning {
    background: #fdf6ec;
}

.stat-card.stat-info {
    background: #ecf5ff;
}

.stat-value {
    font-size: 28px;
    font-weight: 700;
    color: #303133;
}

.stat-label {
    font-size: 13px;
    color: #909399;
    margin-top: 4px;
}

.alert-section {
    margin-top: 20px;
    padding: 16px;
    background: #fdf6ec;
    border-radius: 8px;
}

.alert-section h4 {
    margin: 0 0 12px;
    color: #E6A23C;
    font-size: 14px;
}

.header-actions {
    display: flex;
    align-items: center;
}

.pagination-bar {
    margin-top: 20px;
    text-align: center;
}

/* Recharge Dialog */
.recharge-dialog-content {
    padding: 8px 0;
}

.recharge-card-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: #f5f7fa;
    border-radius: 6px;
}

.recharge-card-uid {
    font-family: monospace;
    font-size: 13px;
    color: #909399;
}

.recharge-current {
    margin-top: 12px;
    font-size: 14px;
    color: #606266;
}

.monospace {
    font-family: 'Courier New', monospace;
    font-size: 13px;
}

.text-muted {
    color: #C0C4CC;
    font-style: italic;
}
</style>
