<template>
    <div class="welcome">
        <HeaderBar />

        <div class="operation-bar">
            <h2 class="page-title">RFID Management</h2>
            <div class="right-operations">
                <el-input placeholder="Search..." v-model="searchKeyword" class="search-input"
                    @keyup.enter.native="handleSearch" clearable />
                <el-button class="btn-search" @click="handleSearch">Search</el-button>
            </div>
        </div>

        <div class="main-wrapper">
            <!-- Tab Navigation -->
            <div class="tab-navigation">
                <div class="tab-btn" :class="{ active: activeTab === 'questions' }" @click="switchTab('questions')">
                    Questions
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'packs' }" @click="switchTab('packs')">
                    Packs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'cards' }" @click="switchTab('cards')">
                    Cards
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'series' }" @click="switchTab('series')">
                    Series
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'console' }" @click="switchTab('console')">
                    <i class="el-icon-search"></i> Console
                </div>
            </div>

            <div class="content-panel">
                <div class="content-area">
                    <el-card class="rfid-card" shadow="never">
                        <!-- Questions Tab -->
                        <template v-if="activeTab === 'questions'">
                            <el-table ref="questionsTable" :data="questionsList" class="transparent-table" v-loading="questionsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Code" prop="code" align="center" width="150"></el-table-column>
                                <el-table-column label="Title" prop="title" align="center" show-overflow-tooltip></el-table-column>
                                <el-table-column label="Category" prop="category" align="center" width="100"></el-table-column>
                                <el-table-column label="Language" prop="language" align="center" width="90"></el-table-column>
                                <el-table-column label="Difficulty" prop="difficulty" align="center" width="90"></el-table-column>
                                <el-table-column label="Active" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-button size="mini" type="text" @click="editQuestion(scope.row)">Edit</el-button>
                                        <el-button size="mini" type="text" @click="deleteQuestion(scope.row)">Delete</el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn">
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllQuestions">
                                        {{ isAllQuestionsSelected ? 'Deselect All' : 'Select All' }}
                                    </el-button>
                                    <el-button size="mini" type="success" @click="showAddQuestionDialog">Add</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedQuestions">Delete</el-button>
                                </div>
                                <div class="custom-pagination">
                                    <el-select v-model="questionsPageSize" @change="handleQuestionsPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="questionsCurrentPage === 1" @click="goFirstQuestions">First</button>
                                    <button class="pagination-btn" :disabled="questionsCurrentPage === 1" @click="goPrevQuestions">Previous</button>
                                    <button v-for="page in questionsVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === questionsCurrentPage }" @click="goToQuestionsPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="questionsCurrentPage === questionsPageCount" @click="goNextQuestions">Next</button>
                                    <span class="total-text">Total {{ questionsTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Packs Tab -->
                        <template v-if="activeTab === 'packs'">
                            <el-table ref="packsTable" :data="packsList" class="transparent-table" v-loading="packsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Pack Code" prop="packCode" align="center" width="200"></el-table-column>
                                <el-table-column label="Name" prop="name" align="center" show-overflow-tooltip></el-table-column>
                                <el-table-column label="Age Range" align="center" width="100">
                                    <template slot-scope="scope">
                                        {{ scope.row.ageMin }}-{{ scope.row.ageMax }}
                                    </template>
                                </el-table-column>
                                <el-table-column label="Active" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-button size="mini" type="text" @click="editPack(scope.row)">Edit</el-button>
                                        <el-button size="mini" type="text" @click="deletePack(scope.row)">Delete</el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn">
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllPacks">
                                        {{ isAllPacksSelected ? 'Deselect All' : 'Select All' }}
                                    </el-button>
                                    <el-button size="mini" type="success" @click="showAddPackDialog">Add</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedPacks">Delete</el-button>
                                </div>
                                <div class="custom-pagination">
                                    <el-select v-model="packsPageSize" @change="handlePacksPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="packsCurrentPage === 1" @click="goFirstPacks">First</button>
                                    <button class="pagination-btn" :disabled="packsCurrentPage === 1" @click="goPrevPacks">Previous</button>
                                    <button v-for="page in packsVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === packsCurrentPage }" @click="goToPacksPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="packsCurrentPage === packsPageCount" @click="goNextPacks">Next</button>
                                    <span class="total-text">Total {{ packsTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Cards Tab -->
                        <template v-if="activeTab === 'cards'">
                            <el-table ref="cardsTable" :data="cardsList" class="transparent-table" v-loading="cardsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="RFID UID" prop="rfidUid" align="center" width="150"></el-table-column>
                                <el-table-column label="Questions" align="center" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        {{ getQuestionsLabel(scope.row.questionIds || (scope.row.questionId ? [scope.row.questionId] : [])) }}
                                    </template>
                                </el-table-column>
                                <el-table-column label="Pack" align="center" width="180">
                                    <template slot-scope="scope">
                                        {{ getPackLabel(scope.row.packId) }}
                                    </template>
                                </el-table-column>
                                <el-table-column label="Active" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-button size="mini" type="text" @click="editCard(scope.row)">Edit</el-button>
                                        <el-button size="mini" type="text" @click="deleteCard(scope.row)">Delete</el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn">
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllCards">
                                        {{ isAllCardsSelected ? 'Deselect All' : 'Select All' }}
                                    </el-button>
                                    <el-button size="mini" type="success" @click="showAddCardDialog">Add</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedCards">Delete</el-button>
                                </div>
                                <div class="custom-pagination">
                                    <el-select v-model="cardsPageSize" @change="handleCardsPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="cardsCurrentPage === 1" @click="goFirstCards">First</button>
                                    <button class="pagination-btn" :disabled="cardsCurrentPage === 1" @click="goPrevCards">Previous</button>
                                    <button v-for="page in cardsVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === cardsCurrentPage }" @click="goToCardsPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="cardsCurrentPage === cardsPageCount" @click="goNextCards">Next</button>
                                    <span class="total-text">Total {{ cardsTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Series Tab -->
                        <template v-if="activeTab === 'series'">
                            <el-table ref="seriesTable" :data="seriesList" class="transparent-table" v-loading="seriesLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Start UID" prop="startUid" align="center" width="120"></el-table-column>
                                <el-table-column label="End UID" prop="endUid" align="center" width="120"></el-table-column>
                                <el-table-column label="Question" align="center" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        {{ getQuestionLabel(scope.row.questionId) }}
                                    </template>
                                </el-table-column>
                                <el-table-column label="Pack" align="center" width="150">
                                    <template slot-scope="scope">
                                        {{ getPackLabel(scope.row.packId) }}
                                    </template>
                                </el-table-column>
                                <el-table-column label="Priority" prop="priority" align="center" width="80"></el-table-column>
                                <el-table-column label="Active" align="center" width="80">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-button size="mini" type="text" @click="editSeries(scope.row)">Edit</el-button>
                                        <el-button size="mini" type="text" @click="deleteSeries(scope.row)">Delete</el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn">
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllSeries">
                                        {{ isAllSeriesSelected ? 'Deselect All' : 'Select All' }}
                                    </el-button>
                                    <el-button size="mini" type="success" @click="showAddSeriesDialog">Add</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedSeries">Delete</el-button>
                                </div>
                                <div class="custom-pagination">
                                    <el-select v-model="seriesPageSize" @change="handleSeriesPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="seriesCurrentPage === 1" @click="goFirstSeries">First</button>
                                    <button class="pagination-btn" :disabled="seriesCurrentPage === 1" @click="goPrevSeries">Previous</button>
                                    <button v-for="page in seriesVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === seriesCurrentPage }" @click="goToSeriesPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="seriesCurrentPage === seriesPageCount" @click="goNextSeries">Next</button>
                                    <span class="total-text">Total {{ seriesTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Console Tab -->
                        <template v-if="activeTab === 'console'">
                            <div class="console-container">
                                <div class="console-header">
                                    <h3>RFID Lookup Console</h3>
                                    <p class="console-description">Test RFID card lookups to verify card-to-content mappings</p>
                                </div>

                                <div class="console-input-section">
                                    <el-input
                                        v-model="consoleLookupUid"
                                        placeholder="Enter RFID UID (e.g., 04A1B2C3D4E5F6)"
                                        class="console-input"
                                        clearable
                                        @keyup.enter.native="handleConsoleLookup"
                                    >
                                        <template slot="prepend">RFID UID</template>
                                    </el-input>
                                    <el-button type="primary" :loading="consoleLookupLoading" @click="handleConsoleLookup">
                                        <i class="el-icon-search"></i> Lookup Card
                                    </el-button>
                                    <el-button type="info" :loading="consoleSeriesLoading" @click="handleSeriesLookup">
                                        <i class="el-icon-files"></i> Lookup Series
                                    </el-button>
                                </div>

                                <div class="console-result" v-if="consoleLookupResult">
                                    <div class="result-header">
                                        <span class="result-label">
                                            <i :class="consoleLookupResult.success ? 'el-icon-success' : 'el-icon-error'"></i>
                                            {{ consoleLookupResult.success ? 'Card Found' : 'Card Not Found' }}
                                        </span>
                                        <el-tag :type="consoleLookupResult.success ? 'success' : 'danger'" size="small">
                                            {{ consoleLookupResult.type || 'card' }}
                                        </el-tag>
                                    </div>
                                    <pre class="result-json">{{ JSON.stringify(consoleLookupResult.data, null, 2) }}</pre>
                                </div>

                                <div class="console-empty" v-else>
                                    <i class="el-icon-postcard"></i>
                                    <p>Enter an RFID UID and click Lookup to test card mappings</p>
                                </div>
                            </div>
                        </template>
                    </el-card>
                </div>
            </div>
        </div>

        <!-- Dialogs -->
        <RfidQuestionDialog
            :title="questionDialogTitle"
            :visible.sync="questionDialogVisible"
            :form="questionForm"
            @submit="handleQuestionSubmit"
            @cancel="questionDialogVisible = false"
        />

        <RfidPackDialog
            :title="packDialogTitle"
            :visible.sync="packDialogVisible"
            :form="packForm"
            @submit="handlePackSubmit"
            @cancel="packDialogVisible = false"
        />

        <RfidCardDialog
            :title="cardDialogTitle"
            :visible.sync="cardDialogVisible"
            :form="cardForm"
            :questions="questionsDropdown"
            :packs="packsDropdown"
            @submit="handleCardSubmit"
            @cancel="cardDialogVisible = false"
        />

        <RfidSeriesDialog
            :title="seriesDialogTitle"
            :visible.sync="seriesDialogVisible"
            :form="seriesForm"
            :questions="questionsDropdown"
            :packs="packsDropdown"
            @submit="handleSeriesSubmit"
            @cancel="seriesDialogVisible = false"
        />

        <el-footer>
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import Api from "@/apis/api";
import HeaderBar from "@/components/HeaderBar.vue";
import VersionFooter from "@/components/VersionFooter.vue";
import RfidQuestionDialog from "@/components/RfidQuestionDialog.vue";
import RfidPackDialog from "@/components/RfidPackDialog.vue";
import RfidCardDialog from "@/components/RfidCardDialog.vue";
import RfidSeriesDialog from "@/components/RfidSeriesDialog.vue";

export default {
    components: { HeaderBar, VersionFooter, RfidQuestionDialog, RfidPackDialog, RfidCardDialog, RfidSeriesDialog },
    data() {
        return {
            activeTab: 'questions',
            searchKeyword: '',
            pageSizeOptions: [10, 20, 50, 100],

            // Questions
            questionsList: [],
            questionsLoading: false,
            questionsCurrentPage: 1,
            questionsPageSize: 10,
            questionsTotal: 0,
            isAllQuestionsSelected: false,
            questionDialogVisible: false,
            questionDialogTitle: 'Add Question',
            questionForm: { id: null, code: '', title: '', promptText: '', language: 'en', category: '', difficulty: 3, active: true },

            // Packs
            packsList: [],
            packsLoading: false,
            packsCurrentPage: 1,
            packsPageSize: 10,
            packsTotal: 0,
            isAllPacksSelected: false,
            packDialogVisible: false,
            packDialogTitle: 'Add Pack',
            packForm: { id: null, packCode: '', name: '', description: '', ageMin: 3, ageMax: 16, active: true },

            // Cards
            cardsList: [],
            cardsLoading: false,
            cardsCurrentPage: 1,
            cardsPageSize: 10,
            cardsTotal: 0,
            isAllCardsSelected: false,
            cardDialogVisible: false,
            cardDialogTitle: 'Add Card',
            cardForm: { id: null, rfidUid: '', questionIds: [], packCode: '', packId: null, notes: '', active: true },

            // Series
            seriesList: [],
            seriesLoading: false,
            seriesCurrentPage: 1,
            seriesPageSize: 10,
            seriesTotal: 0,
            isAllSeriesSelected: false,
            seriesDialogVisible: false,
            seriesDialogTitle: 'Add Series',
            seriesForm: { id: null, startUid: '', endUid: '', questionId: null, packId: null, priority: 0, notes: '', active: true },

            // Dropdown data
            questionsDropdown: [],
            packsDropdown: [],

            // Console
            consoleLookupUid: '',
            consoleLookupLoading: false,
            consoleSeriesLoading: false,
            consoleLookupResult: null
        };
    },
    created() {
        this.fetchQuestions();
        this.loadDropdownData();
    },
    computed: {
        // Questions pagination
        questionsPageCount() {
            return Math.ceil(this.questionsTotal / this.questionsPageSize);
        },
        questionsVisiblePages() {
            return this.getVisiblePages(this.questionsCurrentPage, this.questionsPageCount);
        },
        // Packs pagination
        packsPageCount() {
            return Math.ceil(this.packsTotal / this.packsPageSize);
        },
        packsVisiblePages() {
            return this.getVisiblePages(this.packsCurrentPage, this.packsPageCount);
        },
        // Cards pagination
        cardsPageCount() {
            return Math.ceil(this.cardsTotal / this.cardsPageSize);
        },
        cardsVisiblePages() {
            return this.getVisiblePages(this.cardsCurrentPage, this.cardsPageCount);
        },
        // Series pagination
        seriesPageCount() {
            return Math.ceil(this.seriesTotal / this.seriesPageSize);
        },
        seriesVisiblePages() {
            return this.getVisiblePages(this.seriesCurrentPage, this.seriesPageCount);
        }
    },
    methods: {
        getVisiblePages(currentPage, pageCount) {
            const pages = [];
            const maxVisible = 3;
            let start = Math.max(1, currentPage - 1);
            let end = Math.min(pageCount, start + maxVisible - 1);
            if (end - start + 1 < maxVisible) {
                start = Math.max(1, end - maxVisible + 1);
            }
            for (let i = start; i <= end; i++) {
                pages.push(i);
            }
            return pages;
        },

        headerCellClassName({ columnIndex }) {
            return columnIndex === 0 ? "custom-selection-header" : "";
        },

        switchTab(tab) {
            this.activeTab = tab;
            this.searchKeyword = '';
            if (tab === 'questions') this.fetchQuestions();
            else if (tab === 'packs') this.fetchPacks();
            else if (tab === 'cards') this.fetchCards();
            else if (tab === 'series') this.fetchSeries();
        },

        handleSearch() {
            if (this.activeTab === 'questions') {
                this.questionsCurrentPage = 1;
                this.fetchQuestions();
            } else if (this.activeTab === 'packs') {
                this.packsCurrentPage = 1;
                this.fetchPacks();
            } else if (this.activeTab === 'cards') {
                this.cardsCurrentPage = 1;
                this.fetchCards();
            } else if (this.activeTab === 'series') {
                this.seriesCurrentPage = 1;
                this.fetchSeries();
            }
        },

        loadDropdownData() {
            Api.rfid.getQuestionList(({ data }) => {
                if (data.code === 0) {
                    this.questionsDropdown = data.data || [];
                }
            });
            Api.rfid.getPackList(({ data }) => {
                if (data.code === 0) {
                    this.packsDropdown = data.data || [];
                }
            });
        },

        getQuestionLabel(id) {
            const q = this.questionsDropdown.find(q => q.id === id);
            return q ? `${q.code} - ${q.title}` : '-';
        },

        getQuestionsLabel(ids) {
            if (!ids || ids.length === 0) return '-';
            return ids.map(id => {
                const q = this.questionsDropdown.find(q => q.id === id);
                return q ? q.code : `#${id}`;
            }).join(', ');
        },

        getPackLabel(id) {
            const p = this.packsDropdown.find(p => p.id === id);
            return p ? p.name : '-';
        },

        // ==================== QUESTIONS ====================
        fetchQuestions() {
            this.questionsLoading = true;
            Api.rfid.getQuestionPage({
                page: this.questionsCurrentPage,
                limit: this.questionsPageSize,
                code: this.searchKeyword
            }, ({ data }) => {
                this.questionsLoading = false;
                if (data.code === 0) {
                    this.questionsList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.questionsTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load questions');
                }
            });
        },

        handleQuestionsPageSizeChange(val) {
            this.questionsPageSize = val;
            this.questionsCurrentPage = 1;
            this.fetchQuestions();
        },
        goFirstQuestions() { this.questionsCurrentPage = 1; this.fetchQuestions(); },
        goPrevQuestions() { if (this.questionsCurrentPage > 1) { this.questionsCurrentPage--; this.fetchQuestions(); } },
        goNextQuestions() { if (this.questionsCurrentPage < this.questionsPageCount) { this.questionsCurrentPage++; this.fetchQuestions(); } },
        goToQuestionsPage(page) { this.questionsCurrentPage = page; this.fetchQuestions(); },

        handleSelectAllQuestions() {
            this.isAllQuestionsSelected = !this.isAllQuestionsSelected;
            this.questionsList.forEach(row => { row.selected = this.isAllQuestionsSelected; });
        },

        showAddQuestionDialog() {
            this.questionDialogTitle = 'Add Question';
            this.questionForm = { id: null, code: '', title: '', promptText: '', language: 'en', category: '', difficulty: 3, active: true };
            this.questionDialogVisible = true;
        },

        editQuestion(row) {
            this.questionDialogTitle = 'Edit Question';
            this.questionForm = { ...row };
            this.questionDialogVisible = true;
        },

        handleQuestionSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updateQuestion : Api.rfid.addQuestion;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.questionDialogVisible = false;
                    this.fetchQuestions();
                    this.loadDropdownData();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deleteQuestion(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} question(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteQuestion(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchQuestions();
                        this.loadDropdownData();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedQuestions() {
            const selected = this.questionsList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteQuestion(selected);
        },

        // ==================== PACKS ====================
        fetchPacks() {
            this.packsLoading = true;
            Api.rfid.getPackPage({
                page: this.packsCurrentPage,
                limit: this.packsPageSize,
                packCode: this.searchKeyword
            }, ({ data }) => {
                this.packsLoading = false;
                if (data.code === 0) {
                    this.packsList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.packsTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load packs');
                }
            });
        },

        handlePacksPageSizeChange(val) {
            this.packsPageSize = val;
            this.packsCurrentPage = 1;
            this.fetchPacks();
        },
        goFirstPacks() { this.packsCurrentPage = 1; this.fetchPacks(); },
        goPrevPacks() { if (this.packsCurrentPage > 1) { this.packsCurrentPage--; this.fetchPacks(); } },
        goNextPacks() { if (this.packsCurrentPage < this.packsPageCount) { this.packsCurrentPage++; this.fetchPacks(); } },
        goToPacksPage(page) { this.packsCurrentPage = page; this.fetchPacks(); },

        handleSelectAllPacks() {
            this.isAllPacksSelected = !this.isAllPacksSelected;
            this.packsList.forEach(row => { row.selected = this.isAllPacksSelected; });
        },

        showAddPackDialog() {
            this.packDialogTitle = 'Add Pack';
            this.packForm = { id: null, packCode: '', name: '', description: '', ageMin: 3, ageMax: 16, active: true };
            this.packDialogVisible = true;
        },

        editPack(row) {
            this.packDialogTitle = 'Edit Pack';
            this.packForm = { ...row };
            this.packDialogVisible = true;
        },

        handlePackSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updatePack : Api.rfid.addPack;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.packDialogVisible = false;
                    this.fetchPacks();
                    this.loadDropdownData();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deletePack(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} pack(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deletePack(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchPacks();
                        this.loadDropdownData();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedPacks() {
            const selected = this.packsList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deletePack(selected);
        },

        // ==================== CARDS ====================
        fetchCards() {
            this.cardsLoading = true;
            Api.rfid.getCardPage({
                page: this.cardsCurrentPage,
                limit: this.cardsPageSize,
                rfidUid: this.searchKeyword
            }, ({ data }) => {
                this.cardsLoading = false;
                if (data.code === 0) {
                    this.cardsList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.cardsTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load cards');
                }
            });
        },

        handleCardsPageSizeChange(val) {
            this.cardsPageSize = val;
            this.cardsCurrentPage = 1;
            this.fetchCards();
        },
        goFirstCards() { this.cardsCurrentPage = 1; this.fetchCards(); },
        goPrevCards() { if (this.cardsCurrentPage > 1) { this.cardsCurrentPage--; this.fetchCards(); } },
        goNextCards() { if (this.cardsCurrentPage < this.cardsPageCount) { this.cardsCurrentPage++; this.fetchCards(); } },
        goToCardsPage(page) { this.cardsCurrentPage = page; this.fetchCards(); },

        handleSelectAllCards() {
            this.isAllCardsSelected = !this.isAllCardsSelected;
            this.cardsList.forEach(row => { row.selected = this.isAllCardsSelected; });
        },

        showAddCardDialog() {
            this.cardDialogTitle = 'Add Card';
            this.cardForm = { id: null, rfidUid: '', questionIds: [], packCode: '', packId: null, notes: '', active: true };
            this.cardDialogVisible = true;
        },

        editCard(row) {
            this.cardDialogTitle = 'Edit Card';
            const form = { ...row };
            // Backward compatibility: convert legacy questionId to questionIds array
            if (!form.questionIds && form.questionId) {
                form.questionIds = [form.questionId];
            }
            if (!form.questionIds) {
                form.questionIds = [];
            }
            this.cardForm = form;
            this.cardDialogVisible = true;
        },

        handleCardSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updateCard : Api.rfid.addCard;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.cardDialogVisible = false;
                    this.fetchCards();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deleteCard(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} card(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteCard(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchCards();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedCards() {
            const selected = this.cardsList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteCard(selected);
        },

        // ==================== SERIES ====================
        fetchSeries() {
            this.seriesLoading = true;
            Api.rfid.getSeriesPage({
                page: this.seriesCurrentPage,
                limit: this.seriesPageSize
            }, ({ data }) => {
                this.seriesLoading = false;
                if (data.code === 0) {
                    this.seriesList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.seriesTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load series');
                }
            });
        },

        handleSeriesPageSizeChange(val) {
            this.seriesPageSize = val;
            this.seriesCurrentPage = 1;
            this.fetchSeries();
        },
        goFirstSeries() { this.seriesCurrentPage = 1; this.fetchSeries(); },
        goPrevSeries() { if (this.seriesCurrentPage > 1) { this.seriesCurrentPage--; this.fetchSeries(); } },
        goNextSeries() { if (this.seriesCurrentPage < this.seriesPageCount) { this.seriesCurrentPage++; this.fetchSeries(); } },
        goToSeriesPage(page) { this.seriesCurrentPage = page; this.fetchSeries(); },

        handleSelectAllSeries() {
            this.isAllSeriesSelected = !this.isAllSeriesSelected;
            this.seriesList.forEach(row => { row.selected = this.isAllSeriesSelected; });
        },

        showAddSeriesDialog() {
            this.seriesDialogTitle = 'Add Series';
            this.seriesForm = { id: null, startUid: '', endUid: '', questionId: null, packId: null, priority: 0, notes: '', active: true };
            this.seriesDialogVisible = true;
        },

        editSeries(row) {
            this.seriesDialogTitle = 'Edit Series';
            this.seriesForm = { ...row };
            this.seriesDialogVisible = true;
        },

        handleSeriesSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updateSeries : Api.rfid.addSeries;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.seriesDialogVisible = false;
                    this.fetchSeries();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deleteSeries(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} series?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteSeries(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchSeries();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedSeries() {
            const selected = this.seriesList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteSeries(selected);
        },

        // ==================== CONSOLE ====================
        handleConsoleLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleLookupLoading = true;
            this.consoleLookupResult = null;

            Api.rfid.lookupCard(this.consoleLookupUid.trim(), ({ data }) => {
                this.consoleLookupLoading = false;
                if (data.code === 0 && data.data) {
                    this.consoleLookupResult = {
                        success: true,
                        type: 'card',
                        data: data.data
                    };
                } else {
                    this.consoleLookupResult = {
                        success: false,
                        type: 'card',
                        data: { error: data.msg || 'Card not found', uid: this.consoleLookupUid }
                    };
                }
            });
        },

        handleSeriesLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleSeriesLoading = true;
            this.consoleLookupResult = null;

            Api.rfid.lookupSeries(this.consoleLookupUid.trim(), ({ data }) => {
                this.consoleSeriesLoading = false;
                if (data.code === 0 && data.data) {
                    this.consoleLookupResult = {
                        success: true,
                        type: 'series',
                        data: data.data
                    };
                } else {
                    this.consoleLookupResult = {
                        success: false,
                        type: 'series',
                        data: { error: data.msg || 'Series not found for this UID', uid: this.consoleLookupUid }
                    };
                }
            });
        }
    }
};
</script>

<style lang="scss" scoped>
.welcome {
    min-width: 900px;
    min-height: 506px;
    height: 100vh;
    display: flex;
    position: relative;
    flex-direction: column;
    background-size: cover;
    background: linear-gradient(to bottom right, #fff5eb, #fff7f0, #ffe8d6) center;
    overflow: hidden;
}

.main-wrapper {
    margin: 5px 22px;
    border-radius: 15px;
    min-height: calc(100vh - 24vh);
    height: auto;
    max-height: 80vh;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    position: relative;
    background: rgba(237, 242, 255, 0.5);
    display: flex;
    flex-direction: column;
}

.operation-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
}

.page-title {
    font-size: 24px;
    margin: 0;
}

.right-operations {
    display: flex;
    gap: 10px;
    margin-left: auto;
}

.search-input {
    width: 240px;
}

.btn-search {
    background: linear-gradient(135deg, #6b8cff, #a966ff);
    border: none;
    color: white;
}

.tab-navigation {
    display: flex;
    gap: 12px;
    padding: 12px 24px;
    background: transparent;
}

.tab-btn {
    padding: 8px 20px;
    border-radius: 8px;
    background: rgba(95, 112, 243, 0.15);
    color: #3d4566;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    transition: all 0.3s ease;

    &.active {
        background: #5f70f3;
        color: white;
    }

    &:hover:not(.active) {
        background: rgba(95, 112, 243, 0.25);
    }
}

.content-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
    height: 100%;
    border-radius: 15px;
    background: transparent;
    border: 1px solid #fff;
}

.content-area {
    flex: 1;
    height: 100%;
    min-width: 600px;
    overflow: auto;
    background-color: white;
    display: flex;
    flex-direction: column;
}

.rfid-card {
    background: white;
    flex: 1;
    display: flex;
    flex-direction: column;
    border: none;
    box-shadow: none;
    overflow: hidden;

    ::v-deep .el-card__body {
        padding: 15px;
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
    }
}

.table_bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    padding-bottom: 10px;
}

.ctrl_btn {
    display: flex;
    gap: 8px;
    padding-left: 26px;

    .el-button {
        min-width: 72px;
        height: 32px;
        padding: 7px 12px;
        font-size: 12px;
        border-radius: 4px;
        font-weight: 500;
        border: none;
        transition: all 0.3s ease;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);

        &:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }
    }

    .el-button--primary {
        background: #5f70f3;
        color: white;
    }

    .el-button--success {
        background: #5bc98c;
        color: white;
    }

    .el-button--danger {
        background: #fd5b63;
        color: white;
    }
}

.custom-pagination {
    display: flex;
    align-items: center;
    gap: 10px;

    .pagination-btn {
        min-width: 60px;
        height: 32px;
        padding: 0 12px;
        border-radius: 4px;
        border: 1px solid #e4e7ed;
        background: #dee7ff;
        color: #606266;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s ease;

        &:hover {
            background: #d7dce6;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        &.active {
            background: #5f70f3 !important;
            color: #ffffff !important;
            border-color: #5f70f3 !important;
        }
    }

    .total-text {
        color: #909399;
        font-size: 14px;
        margin-left: 10px;
    }
}

.page-size-select {
    width: 120px;
    margin-right: 10px;

    :deep(.el-input__inner) {
        height: 32px;
        line-height: 32px;
        border-radius: 4px;
        border: 1px solid #e4e7ed;
        background: #dee7ff;
        color: #606266;
        font-size: 14px;
    }
}

:deep(.transparent-table) {
    background: white;
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;

    .el-table__body-wrapper {
        flex: 1;
        overflow-y: auto;
    }

    .el-table__header th {
        background: white !important;
        color: black;
    }

    &::before {
        display: none;
    }

    .el-table__body tr {
        background-color: white;

        td {
            border-top: 1px solid rgba(0, 0, 0, 0.04);
            border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        }
    }
}

:deep(.el-checkbox__inner) {
    background-color: #eeeeee !important;
    border-color: #cccccc !important;
}

:deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: #5f70f3 !important;
    border-color: #5f70f3 !important;
}

:deep(.el-table .el-button--text) {
    color: #7079aa;
}

:deep(.el-table .el-button--text:hover) {
    color: #5a64b5;
}

:deep(.el-loading-mask) {
    background-color: rgba(255, 255, 255, 0.6) !important;
    backdrop-filter: blur(2px);
}

:deep(.el-loading-spinner .path) {
    stroke: #6b8cff;
}

:deep(.el-loading-text) {
    color: #6b8cff !important;
}

/* Console Tab Styles */
.console-container {
    padding: 20px;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.console-header {
    margin-bottom: 20px;

    h3 {
        margin: 0 0 8px 0;
        color: #3d4566;
        font-size: 18px;
    }

    .console-description {
        margin: 0;
        color: #909399;
        font-size: 13px;
    }
}

.console-input-section {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    align-items: center;

    .console-input {
        flex: 1;
        max-width: 500px;
    }
}

.console-result {
    flex: 1;
    background: #f8f9fa;
    border-radius: 8px;
    padding: 16px;
    overflow: auto;

    .result-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #e8e8e8;

        .result-label {
            font-weight: 600;
            font-size: 14px;
            color: #3d4566;

            i {
                margin-right: 6px;
            }

            .el-icon-success {
                color: #67c23a;
            }

            .el-icon-error {
                color: #f56c6c;
            }
        }
    }

    .result-json {
        background: #2d2d2d;
        color: #f8f8f2;
        padding: 16px;
        border-radius: 6px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 12px;
        line-height: 1.5;
        overflow: auto;
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
    }
}

.console-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #909399;

    i {
        font-size: 64px;
        margin-bottom: 16px;
        color: #ddd;
    }

    p {
        margin: 0;
        font-size: 14px;
    }
}
</style>
