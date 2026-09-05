<template>
    <div class="welcome">

        <div class="page-head">
            <div>
                <h1 class="page-title">RFID Cards</h1>
                <p class="page-lead">Physical cards, the packs they belong to and the content each UID resolves to.</p>
            </div>
            <div class="page-actions">
                <el-button v-if="activeTab === 'contentPacks'" size="small" type="primary" @click="showAddContentPackDialog">Create pack</el-button>
                <el-button v-else-if="activeTab === 'packs'" size="small" type="primary" @click="showAddPackDialog">New SKU</el-button>
                <el-button v-else-if="activeTab === 'cards'" size="small" type="primary" @click="showAddCardDialog">New card</el-button>
                <el-button v-else-if="activeTab === 'series'" size="small" type="primary" @click="showAddSeriesDialog">New range</el-button>
            </div>
        </div>

        <!-- Stats Overview Bar -->
        <div class="stats-bar" v-loading="statsLoading" element-loading-background="transparent">

            <div class="stat-item card kpi" @click="switchTab('contentPacks')">
                <div class="stat-icon content"><i class="el-icon-notebook-2"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalContentPacks }}</div>
                    <div class="stat-label">Content Packs</div>
                </div>
            </div>
            <div class="stat-item card kpi" @click="switchTab('packs')">
                <div class="stat-icon skus"><i class="el-icon-goods"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalProductSkus }}</div>
                    <div class="stat-label">Product SKUs</div>
                </div>
            </div>
            <div class="stat-item card kpi" @click="switchTab('cards')">
                <div class="stat-icon cards"><i class="el-icon-postcard"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalCards }}</div>
                    <div class="stat-label">Card Mappings</div>
                </div>
            </div>
            <div class="stat-item card kpi" @click="switchTab('aiCards')">
                <div class="stat-icon ai-cards"><i class="el-icon-cpu"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalAiCards }}</div>
                    <div class="stat-label">AI Cards</div>
                </div>
            </div>
            <div class="stat-item card kpi" @click="switchTab('series')">
                <div class="stat-icon series"><i class="el-icon-s-operation"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalSeries }}</div>
                    <div class="stat-label">Bulk Ranges</div>
                </div>
            </div>
            <div class="stat-item card kpi" @click="switchTab('cardAnalytics')">
                <div class="stat-icon analytics"><i class="el-icon-data-analysis"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalCardTaps }}</div>
                    <div class="stat-label">Card Taps (7d)</div>
                </div>
            </div>
        </div>

        <div class="main-wrapper">
            <!-- Tab Navigation -->
            <div class="tab-navigation">

                <div class="tab-btn" :class="{ active: activeTab === 'contentPacks' }" @click="switchTab('contentPacks')">
                    <i class="el-icon-notebook-2"></i> Content Packs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'packs' }" @click="switchTab('packs')">
                    <i class="el-icon-goods"></i> Product SKUs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'cards' }" @click="switchTab('cards')">
                    <i class="el-icon-postcard"></i> Card Mappings
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'aiCards' }" @click="switchTab('aiCards')">
                    <i class="el-icon-cpu"></i> AI Cards
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'customCards' }" @click="switchTab('customCards')">
                    <i class="el-icon-microphone"></i> Custom Cards
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'series' }" @click="switchTab('series')">
                    <i class="el-icon-s-operation"></i> Bulk Ranges
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'cardAnalytics' }" @click="switchTab('cardAnalytics')">
                    <i class="el-icon-data-analysis"></i> Card Analytics
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'console' }" @click="switchTab('console')">
                    <i class="el-icon-search"></i> Lookup &amp; Test
                </div>
            </div>

            <div class="content-panel">
                <div class="content-area">
                    <el-card class="rfid-card" shadow="never">
                        <ListToolbar
                            v-if="tabHasList"
                            :count="tabRows.length"
                            :count-noun="tabNoun"
                            :total="tabRows.length"
                            :sort-options="tabSortOptions"
                            :sort-by.sync="sortBy"
                            :sort-dir.sync="sortDir"
                            :group-options="tabGroupOptions"
                            :group-by.sync="groupBy"
                            :selecting.sync="selecting"
                            :selected-count="selectedCount"
                            :all-selected="allSelected"
                            :search.sync="searchKeyword"
                            :search-placeholder="tabSearchPlaceholder"
                            class="rfid-toolbar"
                            @select-all-matching="selectAllRows"
                            @clear-selection="clearSelection"
                        >
                            <template #filters>
                                <el-select
                                    v-if="activeTab === 'contentPacks'"
                                    v-model="contentPacksTypeFilter"
                                    size="mini"
                                    clearable
                                    placeholder="Content type"
                                    class="lb-filter"
                                    @change="handleContentPacksTypeChange">
                                    <el-option
                                        v-for="opt in contentPackTypeOptions"
                                        :key="opt.value"
                                        :label="opt.label"
                                        :value="opt.value" />
                                </el-select>
                            </template>
                            <template #bulk>
                                <el-button @click="bulkExport">Export</el-button>
                                <el-button v-if="activeTab === 'contentPacks'" type="danger" @click="deleteSelectedContentPacks">Delete</el-button>
                            </template>
                        </ListToolbar>

                        <!-- AI Prompts Tab -->


                        <!-- Product SKUs Tab -->
                        <template v-if="activeTab === 'packs'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-goods"></i> Product SKUs
                                        <el-tag size="mini" type="info" class="section-count">{{ packsTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Physical card pack products for retail grouping (e.g., "Blinkit Animals Pack").
                                        <el-tooltip content="Each product SKU groups RFID cards into a retail pack with a code, name, and target age range." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>
                            <el-table ref="packsTable" :data="sortRows(packsList)" class="transparent-table" v-loading="packsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column v-if="selecting" label="" align="center" width="52">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Pack Code" prop="packCode" sortable="custom" align="center" width="200"></el-table-column>
                                <el-table-column label="Name" prop="name" sortable="custom" align="center" show-overflow-tooltip></el-table-column>
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

                        <!-- Card Mappings Tab -->
                        <template v-if="activeTab === 'cards'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-postcard"></i> Card Mappings
                                        <el-tag size="mini" type="info" class="section-count">{{ cardsTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Links a physical RFID card (by UID) to AI Prompts or Story &amp; Rhyme Packs.
                                        <el-tooltip content="Each card mapping ties one RFID UID to content. A card can reference AI Prompts (for dynamic AI responses) or a Story & Rhyme Pack (for pre-authored TTS content)." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>
                            <el-table ref="cardsTable" :data="sortRows(cardsList)" class="transparent-table" v-loading="cardsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="60">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Thumbnail" align="center" width="96">
                                    <template slot-scope="scope">
                                        <el-popover
                                            v-if="cardThumbnail(scope.row)"
                                            placement="right"
                                            trigger="hover"
                                            :open-delay="120"
                                            popper-class="thumb-popper">
                                            <img
                                                class="thumb-zoom"
                                                :src="cardThumbnail(scope.row)"
                                                :alt="scope.row.rfidUid" />
                                            <div slot="reference" class="thumb-cell">
                                                <img
                                                    :src="cardThumbnail(scope.row)"
                                                    :alt="scope.row.rfidUid"
                                                    loading="lazy"
                                                    @error="onCardThumbError(scope.row)" />
                                            </div>
                                        </el-popover>
                                        <div v-else class="thumb-cell is-empty" title="No picture available">
                                            <svg viewBox="0 0 24 24" aria-label="No picture available" role="img">
                                                <rect x="3.5" y="5" width="17" height="14" rx="2" />
                                                <circle cx="9" cy="10" r="1.6" />
                                                <path d="M4.5 16.5l4.2-4.2 3.1 3.1 2.7-2.6 4.9 4.7" />
                                                <line x1="4" y1="20" x2="20" y2="4" />
                                            </svg>
                                        </div>
                                    </template>
                                </el-table-column>
                                <el-table-column label="RFID UID" align="center" width="150">
                                    <template slot-scope="scope">
                                        <span class="uid-mono">{{ scope.row.rfidUid }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Content Type" align="center" width="130">
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.cardType === 'ai'" type="danger" size="small" class="content-badge">
                                            <i class="el-icon-cpu"></i> AI Card
                                        </el-tag>
                                        <el-tag v-else-if="scope.row.contentPackId" type="warning" size="small" class="content-badge">
                                            <i class="el-icon-notebook-2"></i> Story/Rhyme
                                        </el-tag>
                                        <el-tag v-else-if="scope.row.questionPackId" type="success" size="small" class="content-badge">
                                            <i class="el-icon-chat-square"></i> Q&A Pack
                                        </el-tag>
                                        <el-tag v-else-if="(scope.row.questionIds && scope.row.questionIds.length) || scope.row.questionId" size="small" class="content-badge">
                                            <i class="el-icon-chat-line-round"></i> AI Prompt
                                        </el-tag>
                                        <el-tag v-else type="info" size="small" class="content-badge">
                                            Unmapped
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="AI Prompts" align="center" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        <el-tooltip v-if="(scope.row.questionIds && scope.row.questionIds.length) || scope.row.questionId" :content="getQuestionsLabel(scope.row.questionIds || (scope.row.questionId ? [scope.row.questionId] : []))" placement="top">
                                            <el-tag size="small" type="info">{{ (scope.row.questionIds || (scope.row.questionId ? [scope.row.questionId] : [])).length }} prompt(s)</el-tag>
                                        </el-tooltip>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Q&A Pack" align="center" width="140" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.questionPackId" type="success" size="small">{{ getQuestionPackLabel(scope.row.questionPackId) }}</el-tag>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Content Pack" align="center" width="160" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.contentPackId" type="warning" size="small">{{ getContentPackLabel(scope.row.contentPackId) }}</el-tag>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Product SKU" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.packId" type="success" size="small">{{ getPackLabel(scope.row.packId) }}</el-tag>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Active" align="center" width="70">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="120">
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

                        <!-- AI Cards Tab -->
                        <template v-if="activeTab === 'aiCards'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-cpu"></i> AI Cards
                                        <el-tag size="mini" type="info" class="section-count">{{ aiCardsTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Cards that switch the device to AI conversation mode when tapped.
                                        <el-tooltip content="AI Cards have no linked content pack or Q&amp;A pack. When tapped, the device enters AI conversation mode." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>
                            <el-table ref="aiCardsTable" :data="sortRows(aiCardsList)" class="transparent-table" v-loading="aiCardsLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Select" align="center" width="60">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="RFID UID" align="center" width="150">
                                    <template slot-scope="scope">
                                        <span class="uid-mono">{{ scope.row.rfidUid }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Thumbnail" align="center" width="110">
                                    <template slot-scope="scope">
                                        <div v-if="scope.row.thumbnailUrl" class="ai-card-thumbnail">
                                            <img :src="scope.row.thumbnailUrl" alt="AI card thumbnail" @error="handleThumbnailError" />
                                        </div>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Card Type" align="center" width="160">
                                    <template slot-scope="scope">
                                        <el-tag :type="getAiCardTypeStyle(scope.row)" size="small" class="content-badge">
                                            <i :class="getAiCardTypeIcon(scope.row)"></i> {{ getAiCardTypeLabel(scope.row) }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="AI Agent" min-width="150" sortable="custom">
                                    <template slot-scope="scope">
                                        <div v-if="getAiCardAgentName(scope.row)" class="rowid">
                                            <span class="rowid-mark accent">{{ aiAgentInitials(scope.row) }}</span>
                                            <span class="cell-key">{{ getAiCardAgentName(scope.row) }}</span>
                                        </div>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Language" width="130">
                                    <template slot-scope="scope">
                                        <span v-if="getAiCardLanguageLabel(scope.row)" class="chip info">
                                            {{ getAiCardLanguageLabel(scope.row) }}
                                        </span>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Notes" prop="notes" align="center" show-overflow-tooltip></el-table-column>
                                <el-table-column label="Product SKU" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.packId" type="success" size="small">{{ getPackLabel(scope.row.packId) }}</el-tag>
                                        <span v-else class="text-muted">-</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Active" align="center" width="70">
                                    <template slot-scope="scope">
                                        <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">
                                            {{ scope.row.active ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Actions" align="center" width="120">
                                    <template slot-scope="scope">
                                        <el-button size="mini" type="text" @click="editCard(scope.row)">Edit</el-button>
                                        <el-button size="mini" type="text" @click="deleteAiCard(scope.row)">Delete</el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn">
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllAiCards">
                                        {{ isAllAiCardsSelected ? 'Deselect All' : 'Select All' }}
                                    </el-button>
                                    <el-button size="mini" type="success" @click="showAddAiCardDialog">Add</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedAiCards">Delete</el-button>
                                </div>
                                <div class="custom-pagination">
                                    <el-select v-model="aiCardsPageSize" @change="handleAiCardsPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="aiCardsCurrentPage === 1" @click="goFirstAiCards">First</button>
                                    <button class="pagination-btn" :disabled="aiCardsCurrentPage === 1" @click="goPrevAiCards">Previous</button>
                                    <button v-for="page in aiCardsVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === aiCardsCurrentPage }" @click="goToAiCardsPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="aiCardsCurrentPage === aiCardsPageCount" @click="goNextAiCards">Next</button>
                                    <span class="total-text">Total {{ aiCardsTotal }} records</span>
                                </div>
                            </div>
                        </template>


                        <!-- Content Packs Tab (Grid View) -->
                        <template v-if="activeTab === 'contentPacks'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-notebook-2"></i> Content Packs
                                        <el-tag size="mini" type="info" class="section-count">{{ contentPacksTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Pre-authored content (rhymes, habits, stories) read directly by TTS. Each pack has numbered items.
                                        <el-tooltip content="Content packs hold markdown text split by numbered items (## 1. Title). When a card is tapped, the device requests a specific item number (sequence). 'AI Generated' packs use AI; 'TTS Read-Aloud' packs are read as-is." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>



                            <div v-loading="contentPacksLoading" class="pack-grid-container" element-loading-background="rgba(250, 249, 247, 0.75)">
                                <div v-if="contentPacksList.length === 0 && !contentPacksLoading" class="empty-state">
                                    <i class="el-icon-notebook-2 empty-icon"></i>
                                    <div class="empty-title">{{ showingCustomPacks ? 'No custom cards recorded yet' : 'No content packs found' }}</div>
                                    <el-button v-if="!showingCustomPacks" type="text" @click="showAddContentPackDialog">Create your first pack</el-button>
                                </div>

                                <div v-else class="pack-grid">
                                    <article v-for="pack in contentPacksList" :key="pack.id" class="pack-card" :class="{ selected: pack.selected }" @click="editContentPack(pack)">
                                        <div v-if="selecting" class="pack-select" @click.stop="">
                                            <el-checkbox v-model="pack.selected"></el-checkbox>
                                        </div>
                                        <!-- The card face. Shown whole rather than cropped: the artwork is
                                             what is printed on the physical card, so a crop hides the subject. -->
                                        <figure class="pack-visual">
                                            <img
                                                v-if="pack.thumbnailUrl && !pack._thumbError"
                                                :src="pack.thumbnailUrl"
                                                :alt="pack.name"
                                                loading="lazy"
                                                @error="onPackThumbError(pack)" />
                                            <div v-else class="pack-visual-empty">
                                                <i class="el-icon-picture-outline"></i>
                                                <span>No artwork</span>
                                            </div>
                                        </figure>

                                        <div class="pack-body">
                                            <div class="pack-title-row">
                                                <h4 class="pack-title" :title="pack.name">{{ pack.name }}</h4>
                                                <span class="pack-status" :class="{ live: pack.active }">{{ pack.active ? 'Active' : 'Draft' }}</span>
                                            </div>
                                            <div class="pack-code">{{ pack.packCode }}</div>
                                            <p class="pack-desc">{{ pack.description || 'No description.' }}</p>
                                            <div class="pack-meta">
                                                <span>{{ pack.totalItems || 0 }} items</span>
                                                <span>{{ pack.language }}</span>
                                                <span>{{ pack.contentType === 'prompt' ? 'AI generated' : 'Read-aloud' }}</span>
                                            </div>
                                        </div>

                                        <footer class="pack-actions">
                                            <el-button type="text" @click.stop="editContentPack(pack)">Edit</el-button>
                                            <el-button type="text" class="is-danger" @click.stop="deleteContentPack(pack)">Delete</el-button>
                                        </footer>
                                    </article>
                                </div>
                            </div>

                            <div class="table_bottom">
                                <div class="ctrl_btn"></div>
                                <div class="custom-pagination">
                                    <el-select v-model="contentPacksPageSize" @change="handleContentPacksPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="contentPacksCurrentPage === 1" @click="goFirstContentPacks">First</button>
                                    <button class="pagination-btn" :disabled="contentPacksCurrentPage === 1" @click="goPrevContentPacks">Previous</button>
                                    <button v-for="page in contentPacksVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === contentPacksCurrentPage }" @click="goToContentPacksPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="contentPacksCurrentPage === contentPacksPageCount" @click="goNextContentPacks">Next</button>
                                    <span class="total-text">Total {{ contentPacksTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Custom Cards Tab -->
                        <template v-if="activeTab === 'customCards'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-microphone"></i> Issued Custom Cards
                                        <el-tag size="mini" type="info" class="section-count">{{ customCardsList.length }} issued</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Blank cards shipped for parent recordings. A UID listed here is treated as a custom card, so it never
                                        reports as unknown. There is no card-to-device binding — any issued card plays the pack of whichever toy it is tapped on.
                                        <el-tooltip content="Register the UIDs printed on the custom cards you ship. The parent records audio from the app, which creates that device's pack (below). Tapping any issued card on that toy plays it." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>

                            <div class="table_top_actions" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
                                <el-input v-model="customCardUidInput" size="mini" style="width: 320px;"
                                    placeholder="UIDs to register, comma or newline separated" clearable
                                    @keyup.enter.native="addCustomCards"></el-input>
                                <el-button size="mini" type="success" icon="el-icon-plus" :loading="customCardsSaving" @click="addCustomCards">Register</el-button>
                                <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedCustomCards">Delete Selected</el-button>
                                <el-button size="mini" icon="el-icon-refresh" @click="fetchCustomCards">Refresh</el-button>
                            </div>

                            <el-table :data="sortRows(customCardsList)" v-loading="customCardsLoading" size="mini" style="width: 100%"
                                @selection-change="handleCustomCardSelection" empty-text="No custom cards issued yet">
                                <el-table-column type="selection" width="45"></el-table-column>
                                <el-table-column prop="rfidUid" label="RFID UID" min-width="160">
                                    <template slot-scope="scope">
                                        <span style="font-family: monospace;">{{ scope.row.rfidUid }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column prop="createDate" label="Issued" min-width="170"></el-table-column>
                                <el-table-column label="Actions" width="90" align="center">
                                    <template slot-scope="scope">
                                        <el-button size="mini" icon="el-icon-delete" circle type="danger" plain
                                            @click="deleteCustomCard(scope.row)"></el-button>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="section-header" style="margin-top: 32px;">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-folder-opened"></i> Custom Card Packages
                                        <el-tag size="mini" type="info" class="section-count">{{ customPacksList.length }} devices</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        One package per device (<code>CUSTOM_&lt;MAC&gt;</code>), created when a parent uploads from the app.
                                        Version and hash drive the toy's re-download, exactly as for catalogue content packs.
                                    </p>
                                </div>
                            </div>

                            <el-table :data="sortRows(customPacksList)" v-loading="customPacksLoading" size="mini" style="width: 100%"
                                empty-text="No parent has recorded anything yet">
                                <el-table-column prop="packCode" label="Pack Code" min-width="180">
                                    <template slot-scope="scope">
                                        <span style="font-family: monospace;">{{ scope.row.packCode }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Device" min-width="180">
                                    <template slot-scope="scope">
                                        <div>{{ scope.row.deviceAlias || 'Unnamed toy' }}</div>
                                        <div style="color: var(--text-light); font-size: 12px; font-family: monospace;">
                                            {{ scope.row.macAddress || 'device not found' }}
                                        </div>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Recording" min-width="200">
                                    <template slot-scope="scope">
                                        <a v-if="scope.row.itemAudioUrl" :href="scope.row.itemAudioUrl" target="_blank" rel="noopener">
                                            {{ scope.row.itemTitle || 'recording' }}
                                        </a>
                                        <span v-else style="color: var(--text-light);">none</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Size" width="90">
                                    <template slot-scope="scope">
                                        {{ scope.row.itemSizeBytes ? (scope.row.itemSizeBytes / 1024 / 1024).toFixed(2) + ' MB' : '—' }}
                                    </template>
                                </el-table-column>
                                <el-table-column prop="version" label="Version" width="80" align="center"></el-table-column>
                                <el-table-column label="Status" width="90" align="center">
                                    <template slot-scope="scope">
                                        <el-tag size="mini" :type="scope.row.active ? 'success' : 'info'" effect="dark">
                                            {{ scope.row.active ? 'Active' : 'Off' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column prop="updateDate" label="Updated" min-width="170"></el-table-column>
                            </el-table>
                        </template>

                        <!-- Bulk Ranges Tab -->
                        <template v-if="activeTab === 'series'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-s-operation"></i> Bulk Ranges
                                        <el-tag size="mini" type="info" class="section-count">{{ seriesTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Maps an entire range of RFID UIDs to the same prompt. Used for manufacturing batches.
                                        <el-tooltip content="Bulk ranges let you assign one AI prompt to all cards with UIDs between a start and end value. Useful when manufacturing many cards with the same content. Priority determines which range wins if UIDs overlap." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>
                            <el-table ref="seriesTable" :data="sortRows(seriesList)" class="transparent-table" v-loading="seriesLoading"
                                element-loading-text="Loading..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column v-if="selecting" label="" align="center" width="52">
                                    <template slot-scope="scope">
                                        <el-checkbox v-model="scope.row.selected"></el-checkbox>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Start UID" prop="startUid" align="center" width="120"></el-table-column>
                                <el-table-column label="End UID" prop="endUid" align="center" width="120"></el-table-column>
                                <el-table-column label="Content Type" align="center" width="140">
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.questionPackId" type="success" size="small" class="content-badge">
                                            <i class="el-icon-chat-square"></i> Q&A Pack
                                        </el-tag>
                                        <el-tag v-else-if="scope.row.contentPackId" type="" size="small" class="content-badge">
                                            <i class="el-icon-notebook-2"></i> Content Pack
                                        </el-tag>
                                        <el-tag v-else type="danger" size="small" class="content-badge">
                                            <i class="el-icon-cpu"></i> AI Card
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Content" align="center" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        <span v-if="scope.row.questionPackName">{{ scope.row.questionPackName }}</span>
                                        <span v-else-if="scope.row.contentPackName">{{ scope.row.contentPackName }}</span>
                                        <span v-else class="text-muted">-</span>
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

                        <!-- Card Analytics Tab -->
                        <template v-if="activeTab === 'cardAnalytics'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-data-analysis"></i> Card Tap Analytics
                                        <el-tag size="mini" type="info" class="section-count">{{ cardTapTotal }} logs</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Track every card tap with toy MAC binding, usage frequency, and content version update signals.
                                    </p>
                                </div>
                            </div>

                            <div class="analytics-summary" v-loading="cardTapSummaryLoading">
                                <div class="analytics-kpi">
                                    <div class="analytics-kpi-label">Total Taps</div>
                                    <div class="analytics-kpi-value">{{ cardTapSummary.totals.totalTaps || 0 }}</div>
                                </div>
                                <div class="analytics-kpi">
                                    <div class="analytics-kpi-label">Unique Cards</div>
                                    <div class="analytics-kpi-value">{{ cardTapSummary.totals.uniqueCards || 0 }}</div>
                                </div>
                                <div class="analytics-kpi">
                                    <div class="analytics-kpi-label">Unique Toys</div>
                                    <div class="analytics-kpi-value">{{ cardTapSummary.totals.uniqueDevices || 0 }}</div>
                                </div>
                                <div class="analytics-kpi warning">
                                    <div class="analytics-kpi-label">Updates Required</div>
                                    <div class="analytics-kpi-value">{{ cardTapSummary.totals.updateRequiredTaps || 0 }}</div>
                                </div>
                                <div class="analytics-kpi danger">
                                    <div class="analytics-kpi-label">Unknown Taps</div>
                                    <div class="analytics-kpi-value">{{ cardTapSummary.totals.unknownTaps || 0 }}</div>
                                </div>
                            </div>

                            <div class="analytics-insights" v-loading="cardTapSummaryLoading">
                                <div class="insight-card">
                                    <div class="insight-title">Daily Tap Trend</div>
                                    <div class="insight-list">
                                        <div class="insight-row" v-for="day in (cardTapSummary.dailyTrend || [])" :key="day.date">
                                            <span>{{ day.date }}</span>
                                            <strong>{{ day.taps }}</strong>
                                        </div>
                                        <div class="insight-empty" v-if="!(cardTapSummary.dailyTrend || []).length">No tap trend data</div>
                                    </div>
                                </div>
                                <div class="insight-card">
                                    <div class="insight-title">Top Cards Needing Update</div>
                                    <div class="insight-list">
                                        <div class="insight-row" v-for="item in (cardTapSummary.topUpdateRequiredCards || [])" :key="item.rfidUid">
                                            <span>{{ item.rfidUid }}</span>
                                            <strong>{{ item.taps }}</strong>
                                        </div>
                                        <div class="insight-empty" v-if="!(cardTapSummary.topUpdateRequiredCards || []).length">No update-required card taps</div>
                                    </div>
                                </div>
                                <div class="insight-card">
                                    <div class="insight-title">Top Toys Needing Update</div>
                                    <div class="insight-list">
                                        <div class="insight-row" v-for="item in (cardTapSummary.topUpdateRequiredDevices || [])" :key="item.macAddress">
                                            <span class="uid-mono">{{ item.macAddress }}</span>
                                            <strong>{{ item.taps }}</strong>
                                        </div>
                                        <div class="insight-empty" v-if="!(cardTapSummary.topUpdateRequiredDevices || []).length">No update-required toy taps</div>
                                    </div>
                                </div>
                            </div>

                            <el-table :data="cardTapLogsList" class="transparent-table" v-loading="cardTapLogsLoading"
                                element-loading-text="Loading analytics..." element-loading-spinner="el-icon-loading"
                                element-loading-background="rgba(255, 255, 255, 0.7)"
                                :header-cell-class-name="headerCellClassName">
                                <el-table-column label="Time" prop="createdAt" align="center" width="170"></el-table-column>
                                <el-table-column label="RFID UID" align="center" width="150">
                                    <template slot-scope="scope">
                                        <span class="uid-mono">{{ scope.row.rfidUid }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Toy MAC" align="center" width="150">
                                    <template slot-scope="scope">
                                        <span class="uid-mono">{{ scope.row.macAddress }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Toy Alias" prop="deviceAlias" align="center" width="140" show-overflow-tooltip></el-table-column>
                                <el-table-column label="Card Type" align="center" width="110">
                                    <template slot-scope="scope">
                                        <el-tag size="small" :type="scope.row.cardType === 'content' ? 'warning' : (scope.row.cardType === 'ai' ? 'danger' : 'info')">
                                            {{ scope.row.cardType || 'unknown' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Content Pack" align="center" min-width="180" show-overflow-tooltip>
                                    <template slot-scope="scope">
                                        <span>{{ scope.row.contentPackName || scope.row.contentPackCode || '-' }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Version" align="center" width="130">
                                    <template slot-scope="scope">
                                        <span>{{ scope.row.clientVersion || '-' }} → {{ scope.row.latestVersion || '-' }}</span>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Update?" align="center" width="95">
                                    <template slot-scope="scope">
                                        <el-tag size="small" :type="scope.row.updateRequired ? 'warning' : 'success'">
                                            {{ scope.row.updateRequired ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                                <el-table-column label="Recognized" align="center" width="105">
                                    <template slot-scope="scope">
                                        <el-tag size="small" :type="scope.row.recognized ? 'success' : 'info'">
                                            {{ scope.row.recognized ? 'Yes' : 'No' }}
                                        </el-tag>
                                    </template>
                                </el-table-column>
                            </el-table>

                            <div class="table_bottom">
                                <div class="ctrl_btn"></div>
                                <div class="custom-pagination">
                                    <el-select v-model="cardTapPageSize" @change="handleCardTapPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="cardTapCurrentPage === 1" @click="goFirstCardTap">First</button>
                                    <button class="pagination-btn" :disabled="cardTapCurrentPage === 1" @click="goPrevCardTap">Previous</button>
                                    <button v-for="page in cardTapVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === cardTapCurrentPage }" @click="goToCardTapPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="cardTapCurrentPage === cardTapPageCount" @click="goNextCardTap">Next</button>
                                    <span class="total-text">Total {{ cardTapTotal }} records</span>
                                </div>
                            </div>
                        </template>

                        <!-- Lookup & Test Tab -->
                        <template v-if="activeTab === 'console'">
                            <div class="console-container">
                                <div class="section-header">
                                    <div class="section-info">
                                        <h3 class="section-title">
                                            <i class="el-icon-search"></i> Lookup &amp; Test
                                        </h3>
                                        <p class="section-description">
                                            Test RFID card lookups to verify card-to-content mappings before deploying to devices.
                                            <el-tooltip content="Use this console to test what happens when a physical RFID card is tapped on a device. Enter a UID and use the buttons to simulate different lookup flows." placement="top">
                                                <i class="el-icon-question section-help"></i>
                                            </el-tooltip>
                                        </p>
                                    </div>
                                </div>

                                <!-- Manual UID lookup (methods/data already existed; UI restored) -->
                                <div class="console-input-section">
                                    <div class="console-input">
                                        <el-input
                                            v-model="consoleLookupUid"
                                            placeholder="Enter RFID UID (e.g. 5C42C905)"
                                            clearable
                                            @keyup.enter.native="handleConsoleLookup">
                                            <template slot="prepend"><i class="el-icon-postcard"></i></template>
                                        </el-input>
                                        <div class="console-sequence">
                                            <span>Seq</span>
                                            <el-input-number v-model="consoleSequence" :min="1" size="small" controls-position="right"></el-input-number>
                                        </div>
                                    </div>
                                    <div class="console-actions">
                                        <el-button type="primary" icon="el-icon-search" :loading="consoleLookupLoading" @click="handleConsoleLookup">Lookup Card Mapping</el-button>
                                        <el-button icon="el-icon-collection" :loading="consoleSeriesLoading" @click="handleSeriesLookup">Series</el-button>
                                        <el-button icon="el-icon-document" :loading="consoleContentLoading" @click="handleContentLookup">Content (seq)</el-button>
                                        <el-button icon="el-icon-download" :loading="consoleDownloadLoading" @click="handleDownloadLookup">Download</el-button>
                                    </div>

                                    <!-- The resolved card, rendered the way it reads in the Content
                                         Packs grid. Preview only: nothing here edits the pack. -->
                                    <div v-if="consoleLookupResult" class="lookup-result">
                                        <div class="lookup-verdict" :class="{ failed: !consoleLookupResult.success }">
                                            <i :class="consoleLookupResult.success ? 'el-icon-success' : 'el-icon-warning-outline'"></i>
                                            <span class="lookup-verdict-text">{{ consoleLookupResult.success ? 'Resolved' : 'Not resolved' }}</span>
                                            <span class="lookup-verdict-type">{{ consoleLookupResult.type }}</span>
                                        </div>

                                        <div v-if="!consoleLookupResult.success" class="lookup-error">
                                            {{ consoleLookupResult.data.error }}
                                        </div>

                                        <article v-else class="pack-card preview">
                                            <figure class="pack-visual">
                                                <img
                                                    v-if="lookupArtwork && !lookupThumbError"
                                                    :src="lookupArtwork"
                                                    :alt="lookupPreview.title"
                                                    @error="lookupThumbError = true" />
                                                <div v-else class="pack-visual-empty">
                                                    <i class="el-icon-picture-outline"></i>
                                                    <span>No artwork</span>
                                                </div>
                                            </figure>

                                            <div class="pack-body">
                                                <div class="pack-title-row">
                                                    <h4 class="pack-title" :title="lookupPreview.title">{{ lookupPreview.title }}</h4>
                                                </div>
                                                <div class="pack-code">{{ lookupPreview.packCode || lookupPreview.uid }}</div>

                                                <!-- AI card: the agent this tap starts -->
                                                <div v-if="lookupPreview.agentName" class="preview-agent">
                                                    <span class="rowid-mark accent">{{ lookupAgentInitials }}</span>
                                                    <div class="preview-agent-text">
                                                        <span class="preview-agent-name">{{ lookupPreview.agentName }}</span>
                                                        <span class="preview-agent-sub">
                                                            <template v-if="lookupPreview.languageName">Speaks {{ lookupPreview.languageName }}</template>
                                                            <template v-else>Language not set</template>
                                                            <template v-if="lookupPreview.runtimeAgentName && lookupPreview.runtimeAgentName !== lookupPreview.agentName">
                                                                · runs on {{ lookupPreview.runtimeAgentName }}
                                                            </template>
                                                        </span>
                                                    </div>
                                                </div>
                                                <p v-if="lookupPreview.promptText" class="pack-desc preview-prompt">{{ lookupPreview.promptText }}</p>
                                                <div class="pack-meta">
                                                    <span>{{ lookupPreview.uid }}</span>
                                                    <span v-if="lookupPreview.contentType">{{ lookupPreview.contentType }}</span>
                                                    <span v-if="lookupPreview.languageCode">{{ lookupPreview.languageCode }}</span>
                                                    <span v-if="lookupPreview.voiceId">voice {{ lookupPreview.voiceId }}</span>
                                                    <span v-if="lookupPreview.version">v{{ lookupPreview.version }}</span>
                                                    <span>{{ lookupPreview.tracks.length }} items</span>
                                                </div>
                                            </div>

                                            <div v-if="lookupPreview.tracks.length" class="preview-tracks">
                                                <div v-for="track in lookupPreview.tracks" :key="track.key" class="preview-track">
                                                    <span class="preview-track-seq">{{ track.sequence }}</span>
                                                    <img
                                                        v-if="thumbSrc(track) && !failedThumbs[track.key]"
                                                        :src="thumbSrc(track)"
                                                        :alt="track.title"
                                                        class="preview-track-thumb"
                                                        @error="onThumbError(track)" />
                                                    <span
                                                        v-else-if="track.imageKind === 'device' && !failedThumbs[track.key]"
                                                        class="preview-track-thumb is-loading">
                                                        <i class="el-icon-loading"></i>
                                                    </span>
                                                    <span v-else class="preview-track-thumb is-empty">
                                                        <i class="el-icon-picture-outline"></i>
                                                    </span>
                                                    <span class="preview-track-title">{{ track.title || 'Untitled' }}</span>
                                                    <span v-if="track.story" class="preview-track-story">{{ track.story }}</span>
                                                    <el-button
                                                        v-if="track.audioUrl"
                                                        type="text"
                                                        :icon="playingUrl === track.audioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'"
                                                        @click="togglePreviewAudio(track.audioUrl)"></el-button>
                                                </div>
                                            </div>
                                        </article>

                                        <div class="lookup-raw">
                                            <el-button type="text" @click="consoleShowRawJson = !consoleShowRawJson">
                                                {{ consoleShowRawJson ? 'Hide' : 'Show' }} raw JSON
                                            </el-button>
                                            <pre v-if="consoleShowRawJson" class="lookup-raw-json">{{ JSON.stringify(consoleLookupResult.data, null, 2) }}</pre>
                                        </div>
                                    </div>
                                </div>

                                <!-- NFC Live Reader Panel -->
                                <div class="nfc-live-panel" :class="{ connected: nfcConnected, scanning: nfcScanning }">
                                    <div class="nfc-status-row">
                                        <div class="nfc-indicator">
                                            <span class="nfc-dot" :class="{ active: nfcConnected, pulse: nfcScanning }"></span>
                                            <span class="nfc-label">{{ nfcConnected ? 'NFC Reader Connected' : 'NFC Reader Offline' }}</span>
                                        </div>
                                        <el-button size="mini" :type="nfcConnected ? 'danger' : 'success'" plain @click="toggleNfcConnection">
                                            {{ nfcConnected ? 'Disconnect' : 'Connect Reader' }}
                                        </el-button>
                                    </div>
                                    <div v-if="nfcConnected" class="nfc-tap-hint">
                                        <i class="el-icon-mobile-phone"></i> Tap a card on the reader to auto-lookup
                                    </div>
                                    <div v-if="nfcLastTap" class="nfc-last-tap">
                                        <span class="nfc-tap-label">Last tap:</span>
                                        <el-tag type="primary" effect="dark" size="small" class="nfc-uid-tag">{{ nfcLastTap.uid }}</el-tag>
                                        <span class="nfc-tap-time">{{ nfcLastTap.timeAgo }}</span>
                                    </div>
                                    <!-- NFC Tap History -->
                                    <div v-if="nfcTapHistory.length > 0" class="nfc-history">
                                        <div class="nfc-history-header">
                                            <span class="nfc-history-title">Recent Taps</span>
                                            <el-button size="mini" type="text" @click="nfcTapHistory = []">Clear</el-button>
                                        </div>
                                        <div class="nfc-history-list">
                                            <div v-for="(tap, idx) in nfcTapHistory" :key="idx" class="nfc-history-item" @click="lookupHistoryTap(tap)">
                                                <el-tag size="mini" :type="tap.found ? 'success' : 'danger'" effect="plain" class="nfc-history-status">
                                                    {{ tap.found ? 'Mapped' : 'Unknown' }}
                                                </el-tag>
                                                <span class="nfc-history-uid">{{ tap.uid }}</span>
                                                <span class="nfc-history-content" v-if="tap.title">{{ tap.title }}</span>
                                                <span class="nfc-history-time">{{ tap.timeAgo }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- NFC Detail Dialog -->
                                <el-dialog
                                    :visible.sync="nfcDetailVisible"
                                    :close-on-click-modal="!nfcNewCardUid.trim()"
                                    :title="nfcDetailData ? nfcDetailData.title || nfcDetailData.rfid_uid || 'Card Details' : 'Card Details'"
                                    width="600px"
                                    :append-to-body="true"
                                    custom-class="nfc-detail-dialog"
                                >
                                    <div v-if="nfcDetailData" class="nfc-detail-content">
                                        <div class="nfc-detail-summary">
                                            <div class="nfc-detail-row">
                                                <span class="nfc-detail-label">UID</span>
                                                <el-tag effect="dark" size="small" class="nfc-uid-tag">{{ nfcDetailData.rfid_uid || nfcDetailUid }}</el-tag>
                                            </div>
                                            <div class="nfc-detail-row" v-if="nfcDetailData.contentType">
                                                <span class="nfc-detail-label">Type</span>
                                                <el-tag size="small" type="info">{{ nfcDetailData.contentType }}</el-tag>
                                            </div>
                                            <div class="nfc-detail-row" v-if="nfcDetailData.title">
                                                <span class="nfc-detail-label">Title</span>
                                                <span class="nfc-detail-value">{{ nfcDetailData.title }}</span>
                                            </div>
                                            <div class="nfc-detail-row" v-if="nfcDetailData.packCode">
                                                <span class="nfc-detail-label">Pack Code</span>
                                                <span class="nfc-detail-value" style="font-family: monospace;">{{ nfcDetailData.packCode }}</span>
                                            </div>
                                            <div class="nfc-detail-row" v-if="nfcDetailData.categoryName">
                                                <span class="nfc-detail-label">Category</span>
                                                <el-tag size="small" type="success">{{ nfcDetailData.categoryName }}</el-tag>
                                            </div>
                                            <div class="nfc-detail-row" v-if="nfcDetailData.version">
                                                <span class="nfc-detail-label">Version</span>
                                                <span class="nfc-detail-value">{{ nfcDetailData.version }}</span>
                                            </div>
                                        </div>

                                        <!-- Cards with same content -->
                                        <div v-if="nfcDetailData.packCode || nfcDetailData.contentType === 'prompt'" class="nfc-linked-cards">
                                            <div class="nfc-linked-header">
                                                <h4 class="nfc-detail-section-title">Cards with same content
                                                    <el-tag size="mini" type="info" effect="plain" style="margin-left: 6px;">{{ nfcDetailData.packCode || nfcDetailData.title }}</el-tag>
                                                </h4>
                                                <el-button size="mini" icon="el-icon-refresh" circle @click="loadLinkedCards" :loading="nfcLinkedLoading"></el-button>
                                            </div>

                                            <div v-if="nfcLinkedLoading" class="nfc-linked-loading">
                                                <i class="el-icon-loading"></i> Loading...
                                            </div>

                                            <div v-else-if="nfcLinkedCards.length > 0" class="nfc-linked-list">
                                                <div v-for="(card, ci) in nfcLinkedCards" :key="ci" class="nfc-linked-item">
                                                    <el-tag size="small" :type="card.rfidUid === (nfcDetailData.rfid_uid || nfcDetailUid) ? 'primary' : ''" effect="dark" class="nfc-uid-tag">
                                                        {{ card.rfidUid }}
                                                    </el-tag>
                                                    <span class="nfc-linked-notes" v-if="card.notes">{{ card.notes }}</span>
                                                    <el-tag size="mini" :type="card.active ? 'success' : 'info'" effect="plain">{{ card.active ? 'Active' : 'Inactive' }}</el-tag>
                                                    <el-button
                                                        size="mini" type="danger" icon="el-icon-delete" circle plain
                                                        @click="removeLinkedCard(card)"
                                                        :loading="card._deleting"
                                                    ></el-button>
                                                    <el-tag v-if="card.rfidUid === (nfcDetailData.rfid_uid || nfcDetailUid)" size="mini" type="warning" effect="plain">current</el-tag>
                                                </div>
                                            </div>

                                            <div v-else class="nfc-linked-empty">
                                                No other cards mapped to this content.
                                            </div>

                                            <!-- Add new card -->
                                            <div class="nfc-add-card">
                                                <el-input
                                                    v-model="nfcNewCardUid"
                                                    placeholder="Tap or type new card UID"
                                                    size="small"
                                                    class="nfc-add-input"
                                                    @keyup.enter.native="addLinkedCard"
                                                >
                                                    <template slot="prepend"><i class="el-icon-postcard"></i></template>
                                                </el-input>
                                                <el-button size="small" type="primary" icon="el-icon-plus" @click="addLinkedCard" :loading="nfcAddingCard" :disabled="!nfcNewCardUid.trim()">
                                                    Add Card
                                                </el-button>
                                            </div>
                                        </div>

                                        <!-- Raw JSON toggle -->
                                        <div class="nfc-detail-raw-toggle">
                                            <el-button size="mini" type="text" @click="nfcShowRawJson = !nfcShowRawJson">
                                                {{ nfcShowRawJson ? 'Hide' : 'Show' }} Raw JSON
                                            </el-button>
                                        </div>
                                        <pre v-if="nfcShowRawJson" class="nfc-detail-json">{{ JSON.stringify(nfcDetailData, null, 2) }}</pre>
                                    </div>

                                    <div v-else class="nfc-detail-not-found">
                                        <i class="el-icon-warning-outline" style="font-size: 40px; color: #e6a23c; margin-bottom: 12px;"></i>
                                        <p>No mapping found for <strong>{{ nfcDetailUid }}</strong></p>
                                        <p style="color: var(--text-light); font-size: 13px;">This card is not mapped to any content yet.</p>
                                    </div>
                                </el-dialog>
                            </div>
                        </template>
                    </el-card>
                </div>
            </div>
        </div>

        <!-- Dialogs -->


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
            :question-packs="questionPacksDropdown"
            :packs="packsDropdown"
            :content-packs="contentPacksDropdown"
            @submit="handleCardSubmit"
            @cancel="cardDialogVisible = false"
        />

        <RfidContentPackDialog
            :title="contentPackDialogTitle"
            :visible.sync="contentPackDialogVisible"
            :form="contentPackForm"
            @submit="handleContentPackSubmit"
            @cancel="contentPackDialogVisible = false"
            @content-type-created="onContentTypeCreated"
        />

        <RfidSeriesDialog
            :title="seriesDialogTitle"
            :visible.sync="seriesDialogVisible"
            :form="seriesForm"
            :question-packs="questionPacksDropdown"
            :content-packs="contentPacksDropdown"
            @submit="handleSeriesSubmit"
            @cancel="seriesDialogVisible = false"
        />


        <el-footer>
            <version-footer />
        </el-footer>
    </div>
</template>

<script>
import ListToolbar from '@/components/ListToolbar.vue';
import listControls from '@/mixins/listControls';
import Api from "@/apis/api";
import VersionFooter from "@/components/VersionFooter.vue";
import RfidPackDialog from "@/components/RfidPackDialog.vue";
import RfidCardDialog from "@/components/RfidCardDialog.vue";
import RfidContentPackDialog from "@/components/RfidContentPackDialog.vue";
import RfidSeriesDialog from "@/components/RfidSeriesDialog.vue";
import { contentTypeLabel, customContentTypes } from "@/utils/contentTypes";
import { isBinUrl, loadLvglBinAsDataUrl } from "@/utils/lvglBin";

// Most content items store their artwork as an LVGL `.bin` — the frame the
// toy's screen draws. A browser cannot put one in an <img>, so those are
// decoded to a PNG data URL client-side before the row renders.
function imageKind(url) {
    if (!url) return 'none';
    return isBinUrl(url) ? 'device' : 'image';
}

// Matches the server's `scope` value for per-child custom-card packs. The
// catalogue grid excludes them unless this is the selected filter.
const CUSTOM_PACK_SCOPE = 'custom';

export default {
  name: 'RfidManagement',
    mixins: [listControls],
    components: { ListToolbar, VersionFooter, RfidPackDialog, RfidCardDialog, RfidContentPackDialog, RfidSeriesDialog },
    data() {
        return {
            // Track thumbnails whose URL failed to load, so the row shows a
            // placeholder instead of the browser's broken-image glyph and the
            // alt text spilling out of a 28px box.
            failedThumbs: {},
            // url -> PNG data URL, for the `.bin` frames decoded in the browser
            decodedThumbs: {},
            // list controls — one toolbar drives whichever tab is open
            sortBy: 'name',
            sortDir: 'asc',
            searchTimer: null,
            activeTab: 'contentPacks',
            searchKeyword: '',
            pageSizeOptions: [10, 20, 50, 100],

            // Custom Cards — issued UID allowlist plus the per-device packages
            customCardsList: [],
            customCardsLoading: false,
            customCardsSaving: false,
            customCardsSelected: [],
            customCardUidInput: '',
            customPacksList: [],
            customPacksLoading: false,

            // Questions
            questionsList: [],
            questionsLoading: false,
            questionsCurrentPage: 1,
            questionsPageSize: 10,
            questionsTotal: 0,
            isAllQuestionsSelected: false,
            questionDialogVisible: false,
            questionDialogTitle: 'Add AI Prompt',
            questionForm: { id: null, code: '', title: '', promptText: '', language: 'en', category: '', difficulty: 3, allowCaching: true, cachedAudioUrl: '', systemPromptOverride: '', active: true },

            // Packs
            packsList: [],
            packsLoading: false,
            packsCurrentPage: 1,
            packsPageSize: 10,
            packsTotal: 0,
            isAllPacksSelected: false,
            packDialogVisible: false,
            packDialogTitle: 'Add Product SKU',
            packForm: { id: null, packCode: '', name: '', description: '', ageMin: 3, ageMax: 16, active: true },

            // Cards
            cardsList: [],
            cardsLoading: false,
            cardsCurrentPage: 1,
            cardsPageSize: 10,
            cardsTotal: 0,
            isAllCardsSelected: false,
            cardDialogVisible: false,
            cardDialogTitle: 'Add Card Mapping',
            cardForm: { id: null, rfidUid: '', questionPackId: null, contentPackId: null, packCode: '', packId: null, actionType: 'content', aiAgentName: 'Cheeko', aiLanguageCode: 'en', aiLanguageName: 'English', aiVoiceId: '', thumbnailUrl: '', actionData: {}, notes: '', active: true },

            // AI Cards
            aiCardsList: [],
            aiCardsLoading: false,
            aiCardsCurrentPage: 1,
            aiCardsPageSize: 10,
            aiCardsTotal: 0,
            isAllAiCardsSelected: false,

            // Series
            seriesList: [],
            seriesLoading: false,
            seriesCurrentPage: 1,
            seriesPageSize: 10,
            seriesTotal: 0,
            isAllSeriesSelected: false,
            seriesDialogVisible: false,
            seriesDialogTitle: 'Add Bulk Range',
            seriesForm: { id: null, startUid: '', endUid: '', questionPackId: null, contentPackId: null, cardType: null, actionData: {}, priority: 0, notes: '', active: true },

            // Content Packs
            contentPacksList: [],
            contentPacksLoading: false,
            contentPacksTypeFilter: '',
            contentPackTypes: [],
            contentPacksCurrentPage: 1,
            contentPacksPageSize: 10,
            contentPacksTotal: 0,
            isAllContentPacksSelected: false,
            contentPackDialogVisible: false,
            contentPackDialogTitle: 'Add Content Pack',
            contentPackForm: { id: null, packCode: '', name: '', description: '', thumbnailUrl: '', contentType: 'story_pack', language: 'en', status: 'draft', version: 1, items: [], active: true },


            // Card Tap Analytics
            cardTapLogsList: [],
            cardTapLogsLoading: false,
            cardTapCurrentPage: 1,
            cardTapPageSize: 10,
            cardTapTotal: 0,
            cardTapSummaryLoading: false,
            cardTapSummary: {
                dateRange: { from: null, to: null },
                totals: {
                    totalTaps: 0,
                    uniqueCards: 0,
                    uniqueDevices: 0,
                    unknownTaps: 0,
                    updateRequiredTaps: 0
                },
                topCards: [],
                topDevices: [],
                topUpdateRequiredCards: [],
                topUpdateRequiredDevices: [],
                dailyTrend: []
            },

            // Dropdown data
            questionsDropdown: [],
            packsDropdown: [],
            contentPacksDropdown: [],
            questionPacksDropdown: [],

            // NFC Live Reader
            nfcConnected: false,
            nfcScanning: false,
            nfcSocket: null,
            nfcLastTap: null,
            nfcTapHistory: [],
            nfcReconnectTimer: null,
            nfcTimeAgoTimer: null,
            nfcDetailVisible: false,
            nfcDetailData: null,
            nfcDetailUid: '',
            nfcShowRawJson: false,
            nfcLinkedCards: [],
            nfcLinkedLoading: false,
            nfcNewCardUid: '',
            nfcAddingCard: false,

            // Console
            consoleLookupUid: '',
            consoleLookupLoading: false,
            consoleSeriesLoading: false,
            consoleContentLoading: false,
            consoleDownloadLoading: false,
            consoleSequence: 1,
            consoleLookupResult: null,
            consoleShowRawJson: false,
            lookupThumbError: false,
            playingUrl: null,

            // Stats
            stats: {
                totalPrompts: 0,
                totalContentPacks: 0,
                totalProductSkus: 0,
                totalCards: 0,
                totalAiCards: 0,
                totalSeries: 0,
                totalQuestionPacks: 0,
                totalCardTaps: 0
            },
            statsLoading: false
        };
    },
    beforeDestroy() {
        if (this._statsRefreshTimer) clearTimeout(this._statsRefreshTimer);
        this.disconnectNfc();
        this.stopPreviewAudio();
    },
    created() {

        this.loadDropdownData();
        this.loadStats();
        this._rfidEverActivated = false;
        // Deep link: /rfid-management/cards opens straight on the cards tab
        const initialTab = this.$route.params.tab;
        if (initialTab && this.isValidTab(initialTab)) {
            this.switchTab(initialTab);
        } else {
            this.switchTab('contentPacks');
        }
    },
    watch: {
        '$route'(to) {
            const tab = to.params.tab;
            if (tab && tab !== this.activeTab && this.isValidTab(tab)) {
                this.switchTab(tab);
            }
        }
    },
    activated() {
        // keep-alive fires activated right after the first mount too — skip that
        // one (created already loaded the default tab); refresh on re-entry only
        if (!this._rfidEverActivated) {
            this._rfidEverActivated = true;
            return;
        }
        this.fetchActiveTabList();
    },
    computed: {
        /**
         * contentPackId -> thumbnail URL. Built once per pack-list change so the
         * Card Mappings table does not scan the pack array for every cell.
         */
        contentPackThumbs() {
            const map = {};
            for (const pack of this.contentPacksDropdown) {
                if (pack && pack.thumbnailUrl) map[pack.id] = pack.thumbnailUrl;
            }
            return map;
        },

    // The active tab's rows, and the sort/group vocabulary that fits them
    tabRows() {
      return ({
        packs: this.packsList,
        cards: this.cardsList,
        aiCards: this.aiCardsList,
        customCards: this.customCardsList,
        series: this.seriesList,
        contentPacks: this.contentPacksList
      })[this.activeTab] || [];
    },
    tabHasList() {
      return ['packs', 'cards', 'aiCards', 'customCards', 'series', 'contentPacks'].indexOf(this.activeTab) !== -1;
    },
    tabNoun() {
      return ({
        packs: 'SKUs', cards: 'cards', aiCards: 'AI cards',
        customCards: 'custom cards', series: 'ranges', contentPacks: 'content packs'
      })[this.activeTab] || 'items';
    },
    tabSearchPlaceholder() {
      return this.activeTab === 'cards' || this.activeTab === 'aiCards'
        ? 'Enter RFID UID (e.g. 5C42C905)'
        : 'Search name or code';
    },
    tabSortOptions() {
      const common = [{ label: 'Name', value: 'name' }, { label: 'Created', value: 'createDate' }];
      return ({
        packs: [{ label: 'Pack code', value: 'packCode' }].concat(common),
        cards: [{ label: 'Card UID', value: 'cardUid' }].concat(common),
        aiCards: [
          { label: 'Card UID', value: 'cardUid' },
          { label: 'AI agent', value: 'actionData.agent_name' },
          { label: 'Language', value: 'actionData.language_name' }
        ].concat(common),
        series: [{ label: 'Series code', value: 'seriesCode' }].concat(common),
        contentPacks: common,
        customCards: common
      })[this.activeTab] || common;
    },
    tabGroupOptions() {
      return [
        { label: 'None', value: '' },
        { label: 'Content pack', value: 'packName' },
        { label: 'Card type', value: 'cardType' }
      ];
    },
    sourceRows() {
      return this.tabRows;
    },
    selectedCount() {
      return this.tabRows.filter(row => row.selected).length;
    },
    allSelected() {
      return this.tabRows.length > 0 && this.selectedCount === this.tabRows.length;
    },
        // Content type filter options, built from the types actually in use so a
        // type created in the pack editor shows up here too.
        // The resolved lookup, flattened into the same shape the pack grid renders:
        // a title, a code, and a numbered track list. Grouped packs come back as
        // stories rather than items, so both are folded into one list here.
        lookupPreview() {
            const data = (this.consoleLookupResult && this.consoleLookupResult.data) || {};
            const tracks = [];

            (data.items || []).forEach((item, index) => {
                tracks.push({
                    key: `i-${index}`,
                    sequence: item.sequence || index + 1,
                    title: item.title,
                    audioUrl: item.audioUrl,
                    imageUrl: item.imageUrl,
                    imageKind: imageKind(item.imageUrl),
                    story: null
                });
            });

            (data.stories || []).forEach((story, sIndex) => {
                (story.audio || []).forEach((audio, aIndex) => {
                    const image = (story.images || []).find(img => img.index === audio.index);
                    tracks.push({
                        key: `s-${sIndex}-${aIndex}`,
                        sequence: audio.index,
                        title: story.title,
                        audioUrl: audio.url,
                        imageUrl: image ? image.url : null,
                        imageKind: imageKind(image ? image.url : null),
                        story: `Story ${story.index || sIndex + 1}`
                    });
                });
            });

            return {
                title: data.title || data.agentName || data.characterName || 'Untitled card',
                packCode: data.packCode,
                uid: data.rfid_uid || this.consoleLookupUid,
                contentType: data.contentType,
                version: data.version,
                promptText: data.promptText,
                thumbnailUrl: data.thumbnailUrl,
                // AI cards resolve to a character rather than a pack: the agent
                // is what the tap actually starts, so it leads the preview.
                agentName: data.agentName || data.characterName || null,
                runtimeAgentName: data.runtimeAgentName || null,
                languageName: data.languageName || data.actionData?.language_name || null,
                languageCode: data.languageCode || data.actionData?.language_code || null,
                voiceId: data.voiceId || null,
                tracks
            };
        },

        // The pack's own artwork when it has some, otherwise the first track's
        // picture, so a pack with per-item images still previews as a card.
        lookupArtwork() {
            const preview = this.lookupPreview;
            if (preview.thumbnailUrl) return preview.thumbnailUrl;
            const withImage = preview.tracks.find(track => track.imageUrl);
            return withImage ? withImage.imageUrl : null;
        },

        showingCustomPacks() {
            return this.contentPacksTypeFilter === CUSTOM_PACK_SCOPE;
        },

        lookupAgentInitials() {
            const name = String(this.lookupPreview.agentName || '').trim();
            if (!name) return '—';
            const parts = name.split(/\s+/).filter(Boolean);
            return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
        },

        contentPackTypeOptions() {
            // Custom cards are content packs a parent recorded, not catalogue
            // content, so they are their own choice rather than a content type.
            //
            // Types are otherwise derived from saved packs, so a playlist with
            // no packs yet would be invisible here. Merging the ones created
            // from the pack editor keeps a new, empty playlist selectable.
            const derived = new Set(this.contentPackTypes);
            customContentTypes().forEach(t => derived.add(t.value));
            return [
                { value: CUSTOM_PACK_SCOPE, label: 'Custom Cards' },
                ...[...derived].sort().map(value => ({ value, label: contentTypeLabel(value) }))
            ];
        },
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
        // Content Packs pagination
        contentPacksPageCount() {
            return Math.ceil(this.contentPacksTotal / this.contentPacksPageSize);
        },
        contentPacksVisiblePages() {
            return this.getVisiblePages(this.contentPacksCurrentPage, this.contentPacksPageCount);
        },
        // Cards pagination
        cardsPageCount() {
            return Math.ceil(this.cardsTotal / this.cardsPageSize);
        },
        cardsVisiblePages() {
            return this.getVisiblePages(this.cardsCurrentPage, this.cardsPageCount);
        },
        // AI Cards pagination
        aiCardsPageCount() {
            return Math.ceil(this.aiCardsTotal / this.aiCardsPageSize);
        },
        aiCardsVisiblePages() {
            return this.getVisiblePages(this.aiCardsCurrentPage, this.aiCardsPageCount);
        },
        // Series pagination
        seriesPageCount() {
            return Math.ceil(this.seriesTotal / this.seriesPageSize);
        },
        seriesVisiblePages() {
            return this.getVisiblePages(this.seriesCurrentPage, this.seriesPageCount);
        },
        // Card Tap Analytics pagination
        cardTapPageCount() {
            return Math.ceil(this.cardTapTotal / this.cardTapPageSize);
        },
        cardTapVisiblePages() {
            return this.getVisiblePages(this.cardTapCurrentPage, this.cardTapPageCount);
        }
    },
    methods: {
    // Shared sort/search for whichever tab's table is rendering
    onThumbError(track) {
      this.$set(this.failedThumbs, track.key, true);
    },

    /**
     * A web image renders straight from its URL; a device `.bin` renders once
     * it has been decoded, which is kicked off the first time it is seen.
     */
    thumbSrc(track) {
      if (!track.imageUrl) return null;
      if (track.imageKind !== 'device') return track.imageUrl;

      const decoded = this.decodedThumbs[track.imageUrl];
      if (decoded === undefined) this.decodeTrackThumb(track);
      return decoded || null;
    },

    decodeTrackThumb(track) {
      // Mark it in flight so the getter does not queue the same URL again on
      // every re-render.
      this.$set(this.decodedThumbs, track.imageUrl, null);
      loadLvglBinAsDataUrl(track.imageUrl).then(dataUrl => {
        if (dataUrl) this.$set(this.decodedThumbs, track.imageUrl, dataUrl);
        else this.$set(this.failedThumbs, track.key, true);
      });
    },

    sortRows(list) {
      const rows = (list || []).slice();
      const q = (this.searchKeyword || '').trim().toLowerCase();
      const filtered = !q ? rows : rows.filter(row =>
        ['name', 'packCode', 'cardUid', 'seriesCode', 'packName'].some(field => {
          const value = row[field];
          return value !== null && value !== undefined && String(value).toLowerCase().includes(q);
        }));
      if (this.sortBy) {
        filtered.sort((a, b) => this.compareRows(a, b, this.sortBy, this.sortDir));
      }
      if (this.groupBy) {
        filtered.sort((a, b) => this.compareRows(a, b, this.groupBy, 'asc'));
      }
      return filtered;
    },
    selectAllRows() {
      this.tabRows.forEach(row => { this.$set(row, 'selected', true); });
    },
    clearSelection() {
      this.tabRows.forEach(row => { this.$set(row, 'selected', false); });
    },
    bulkExport() {
      const rows = this.tabRows.filter(row => row.selected);
      if (!rows.length) {
        this.$message.warning('Nothing to export.');
        return;
      }
      const cols = Object.keys(rows[0]).filter(k => k !== 'selected' && typeof rows[0][k] !== 'object');
      const escape = value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
      const csv = [cols.join(',')]
        .concat(rows.map(row => cols.map(col => escape(row[col])).join(',')))
        .join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `rfid-${this.activeTab}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
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

        handleThumbnailError(event) {
            event.target.style.display = 'none';
        },

        // Broken pack thumbnail → fall back to the placeholder icon
        // Preview-only playback for the Lookup & Test result. One element, so a
        // second play always replaces the first rather than stacking.
        togglePreviewAudio(url) {
            if (this.playingUrl === url) {
                this.stopPreviewAudio();
                return;
            }
            this.stopPreviewAudio();
            this._previewAudio = new Audio(url);
            this._previewAudio.addEventListener('ended', () => { this.playingUrl = null; });
            this._previewAudio.play().catch(() => {
                this.$message.error('Could not play this audio');
                this.playingUrl = null;
            });
            this.playingUrl = url;
        },

        stopPreviewAudio() {
            if (this._previewAudio) {
                this._previewAudio.pause();
                this._previewAudio = null;
            }
            this.playingUrl = null;
        },

        resetLookupPreview() {
            this.lookupThumbError = false;
            this.consoleShowRawJson = false;
            this.stopPreviewAudio();
        },

        onPackThumbError(pack) {
            this.$set(pack, '_thumbError', true);
        },

        /**
         * Artwork for a card mapping. In practice no mapping carries its own
         * `thumbnail_url` — the picture belongs to the content pack the card
         * points at — but a card's own value wins if one is ever set directly.
         * Returns null when there is nothing loadable, which is what draws the
         * placeholder. `imageKind` filters out `.bin` framebuffers, which are
         * screen data for the toy rather than anything an <img> can render.
         */
        cardThumbnail(row) {
            if (!row || row._thumbError) return null;
            const url = row.thumbnailUrl || this.contentPackThumbs[row.contentPackId] || null;
            return url && imageKind(url) === 'image' ? url : null;
        },

        onCardThumbError(row) {
            this.$set(row, '_thumbError', true);
        },

        switchTab(tab) {
            this.activeTab = tab;
            this.searchKeyword = '';
            this.contentPacksTypeFilter = '';
            if (tab === 'questions') this.fetchQuestions();
            else if (tab === 'packs') this.fetchPacks();
            else if (tab === 'cards') this.fetchCards();
            else if (tab === 'contentPacks') { this.fetchContentPacks(); this.loadContentPackTypes(); }
            else if (tab === 'series') this.fetchSeries();
            else if (tab === 'aiCards') this.fetchAiCards();
            else if (tab === 'cardAnalytics') this.fetchCardTapAnalytics();
            else if (tab === 'customCards') this.fetchCustomCardsTab();
            // Deep-linkable tabs: keep the URL on the active tab so browser
            // back/forward and shared links land on the same view
            const target = `/rfid-management/${tab}`;
            if (this.$route.path !== target) {
                this.$router.push(target).catch(() => {});
            }
        },

        // Refresh whichever tab is currently shown (used on keep-alive re-entry)
        fetchActiveTabList() {
            const tab = this.activeTab;
            if (tab === 'questions') this.fetchQuestions();
            else if (tab === 'packs') this.fetchPacks();
            else if (tab === 'cards') this.fetchCards();
            else if (tab === 'contentPacks') this.fetchContentPacks();
            else if (tab === 'series') this.fetchSeries();
            else if (tab === 'aiCards') this.fetchAiCards();
            else if (tab === 'cardAnalytics') this.fetchCardTapAnalytics();
            else if (tab === 'customCards') this.fetchCustomCardsTab();
        },

        isValidTab(tab) {
            return ['contentPacks', 'packs', 'cards', 'aiCards', 'customCards', 'series', 'cardAnalytics', 'console', 'questions'].includes(tab);
        },

        // ── Custom Cards ────────────────────────────────────────────────────
        fetchCustomCardsTab() {
            this.fetchCustomCards();
            this.fetchCustomPacks();
        },

        fetchCustomCards() {
            this.customCardsLoading = true;
            Api.rfid.getCustomCardList(({ data }) => {
                this.customCardsLoading = false;
                if (data.code === 0) {
                    this.customCardsList = data.data || [];
                } else {
                    this.$message.error(data.msg || 'Failed to load custom cards');
                }
            });
        },

        fetchCustomPacks() {
            this.customPacksLoading = true;
            Api.rfid.getCustomPackList(({ data }) => {
                this.customPacksLoading = false;
                if (data.code === 0) {
                    this.customPacksList = data.data || [];
                } else {
                    this.$message.error(data.msg || 'Failed to load custom packages');
                }
            });
        },

        handleCustomCardSelection(rows) {
            this.customCardsSelected = rows || [];
        },

        addCustomCards() {
            // Accepts a pasted batch: commas, spaces or newlines all separate UIDs,
            // because these arrive from a fulfilment spreadsheet.
            const uids = this.customCardUidInput.split(/[\s,]+/).filter(Boolean);
            if (uids.length === 0) {
                this.$message.warning('Enter at least one RFID UID');
                return;
            }

            this.customCardsSaving = true;
            Api.rfid.addCustomCards(uids, ({ data }) => {
                this.customCardsSaving = false;
                if (data.code === 0) {
                    const result = data.data || {};
                    let msg = `Registered ${result.created || 0} card(s)`;
                    if (result.skipped) msg += `, ${result.skipped} already issued`;
                    if (result.invalid && result.invalid.length) msg += `, ${result.invalid.length} invalid`;
                    this.$message.success(msg);
                    this.customCardUidInput = '';
                    this.fetchCustomCards();
                } else {
                    this.$message.error(data.msg || 'Failed to register custom cards');
                }
            });
        },

        deleteCustomCard(row) {
            this.confirmDeleteCustomCards([row.id], `custom card ${row.rfidUid}`);
        },

        deleteSelectedCustomCards() {
            if (this.customCardsSelected.length === 0) {
                this.$message.warning('Select at least one card');
                return;
            }
            this.confirmDeleteCustomCards(
                this.customCardsSelected.map(row => row.id),
                `${this.customCardsSelected.length} custom card(s)`
            );
        },

        confirmDeleteCustomCards(ids, label) {
            this.$confirm(
                `Delete ${label}? Tapping it will then report an unknown card.`,
                'Confirm', { type: 'warning' }
            ).then(() => {
                Api.rfid.deleteCustomCards(ids, ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted');
                        this.fetchCustomCards();
                    } else {
                        this.$message.error(data.msg || 'Failed to delete');
                    }
                });
            }).catch(() => { });
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
            } else if (this.activeTab === 'contentPacks') {
                this.contentPacksCurrentPage = 1;
                this.fetchContentPacks();
            } else if (this.activeTab === 'series') {
                this.seriesCurrentPage = 1;
                this.fetchSeries();
            } else if (this.activeTab === 'aiCards') {
                this.aiCardsCurrentPage = 1;
                this.fetchAiCards();
            } else if (this.activeTab === 'cardAnalytics') {
                this.cardTapCurrentPage = 1;
                this.fetchCardTapAnalytics();
            }
        },

        // keys: subset of ['questions','packs','contentPacks','questionPacks'] to refresh;
        // omit to refresh all four (initial load). Mutations refresh only what they touched.
        loadDropdownData(keys = ['questions', 'packs', 'contentPacks', 'questionPacks']) {
            if (keys.includes('questions')) {
                Api.rfid.getQuestionList(({ data }) => {
                    if (data.code === 0) {
                        this.questionsDropdown = data.data || [];
                    }
                });
            }
            if (keys.includes('packs')) {
                Api.rfid.getPackList(({ data }) => {
                    if (data.code === 0) {
                        this.packsDropdown = data.data || [];
                    }
                });
            }
            if (keys.includes('contentPacks')) {
                Api.rfid.getContentPackList(({ data }) => {
                    if (data.code === 0) {
                        this.contentPacksDropdown = data.data || [];
                    }
                });
            }
            if (keys.includes('questionPacks')) {
                Api.rfid.getQuestionPackList(({ data }) => {
                    if (data.code === 0) {
                        this.questionPacksDropdown = data.data || [];
                    }
                });
            }
        },

        scheduleStatsRefresh() {
            // Coalesce bursts of mutations (batch deletes etc.) into one refresh
            if (this._statsRefreshTimer) clearTimeout(this._statsRefreshTimer);
            this._statsRefreshTimer = setTimeout(() => {
                this._statsRefreshTimer = null;
                this.loadStats();
            }, 1200);
        },

        loadStats() {
            this.statsLoading = true;
            let completed = 0;
            const checkDone = () => {
                completed++;
                if (completed >= 2) this.statsLoading = false;
            };
            // One aggregate call replaces the six page:1,limit:1 probes
            Api.rfid.getRfidStatsOverview(({ data }) => {
                if (data.code === 0 && data.data) {
                    this.stats.totalQuestionPacks = data.data.totalQuestionPacks || 0;
                    this.stats.totalContentPacks = data.data.totalContentPacks || 0;
                    this.stats.totalProductSkus = data.data.totalProductSkus || 0;
                    this.stats.totalCards = data.data.totalCards || 0;
                    this.stats.totalSeries = data.data.totalSeries || 0;
                    this.stats.totalAiCards = data.data.totalAiCards || 0;
                }
                checkDone();
            });
            Api.rfid.getCardTapSummary({}, ({ data }) => {
                if (data.code === 0) this.stats.totalCardTaps = data.data?.totals?.totalTaps || 0;
                checkDone();
            });
        },

        getLanguageNameFromCode(code) {
            const languageMap = {
                en: 'English',
                hi: 'Hindi',
                te: 'Telugu',
                kn: 'Kannada',
                ta: 'Tamil',
                ml: 'Malayalam',
                de: 'German'
            };
            return languageMap[code] || code || '';
        },

        getAiCardTypeLabel(card) {
            const agentName = card?.actionData?.agent_name || card?.aiAgentName || '';
            if (agentName) return agentName;
            const notes = card?.notes || '';
            if (!notes) return 'AI Card';
            const n = notes.toLowerCase();
            if (n.includes('cheeko')) return 'Cheeko';
            if (n.includes('magic')) return 'Cheeko Magic';
            if (n.includes('astro')) return 'Cheeko Astronaut';
            return 'AI Card';
        },
        getAiCardTypeIcon(card) {
            const agentName = (card?.actionData?.agent_name || card?.aiAgentName || '').toLowerCase();
            if (agentName.includes('cheeko magic')) return 'el-icon-magic-stick';
            if (agentName.includes('astronaut')) return 'el-icon-discover';
            if (agentName.includes('cheeko')) return 'el-icon-chat-dot-round';
            const notes = card?.notes || '';
            if (!notes) return 'el-icon-cpu';
            const n = notes.toLowerCase();
            if (n.includes('magic')) return 'el-icon-magic-stick';
            if (n.includes('astro')) return 'el-icon-discover';
            return 'el-icon-cpu';
        },
        getAiCardTypeStyle(card) {
            const agentName = (card?.actionData?.agent_name || card?.aiAgentName || '').toLowerCase();
            if (agentName.includes('cheeko magic')) return 'warning';
            if (agentName.includes('astronaut')) return 'success';
            if (agentName.includes('cheeko')) return 'primary';
            const notes = card?.notes || '';
            if (!notes) return 'danger';
            const n = notes.toLowerCase();
            if (n.includes('cheeko')) return 'primary';
            if (n.includes('magic')) return 'warning';
            if (n.includes('astro')) return 'success';
            return 'danger';
        },
        // agent_name has been on action_data all along — it only ever fed the
        // tag colour, so the name itself was never visible.
        getAiCardAgentName(card) {
            return card?.actionData?.agent_name || card?.aiAgentName || '';
        },

        aiAgentInitials(card) {
            const name = String(this.getAiCardAgentName(card) || '').trim();
            if (!name) return '—';
            const parts = name.split(/\s+/).filter(Boolean);
            return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
        },

        getAiCardLanguageLabel(card) {
            return card?.actionData?.language_name || card?.aiLanguageName || card?.actionData?.language_code || card?.aiLanguageCode || '';
        },

        getResultTitle(result) {
            if (!result) return '';
            const typeMap = {
                'card': result.success ? 'Card Mapping Found' : 'Card Mapping Not Found',
                'series': result.success ? 'Bulk Range Found' : 'No Bulk Range for this UID',
                'download manifest': result.success ? 'Download Manifest Ready' : 'Download Manifest Not Found'
            };
            if (result.type && result.type.startsWith('content')) {
                return result.success ? 'Content Resolved' : 'Content Not Found';
            }
            return typeMap[result.type] || (result.success ? 'Found' : 'Not Found');
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

        getContentPackLabel(id) {
            if (!id) return '-';
            const cp = this.contentPacksDropdown.find(cp => cp.id === id);
            return cp ? cp.name : `#${id}`;
        },

        getQuestionPackLabel(id) {
            if (!id) return '-';
            const qp = this.questionPacksDropdown.find(qp => qp.id === id);
            return qp ? qp.name : `#${id}`;
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
            this.questionDialogTitle = 'Add AI Prompt';
            this.questionForm = { id: null, code: '', title: '', promptText: '', language: 'en', category: '', difficulty: 3, active: true };
            this.questionDialogVisible = true;
        },

        editQuestion(row) {
            this.questionDialogTitle = 'Edit AI Prompt';
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
                    this.loadDropdownData(['questions']);
                    this.scheduleStatsRefresh();
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
                        this.loadDropdownData(['questions']);
                        this.scheduleStatsRefresh();
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
            this.packDialogTitle = 'Add Product SKU';
            this.packForm = { id: null, packCode: '', name: '', description: '', ageMin: 3, ageMax: 16, active: true };
            this.packDialogVisible = true;
        },

        editPack(row) {
            this.packDialogTitle = 'Edit Product SKU';
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
                    this.loadDropdownData(['packs']);
                    this.scheduleStatsRefresh();
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
                        this.loadDropdownData(['packs']);
                        this.scheduleStatsRefresh();
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
            this.cardDialogTitle = 'Add Card Mapping';
            this.cardForm = { id: null, rfidUid: '', questionPackId: null, packCode: '', packId: null, contentPackId: null, actionType: 'content', aiAgentName: 'Cheeko', aiLanguageCode: 'en', aiLanguageName: 'English', aiVoiceId: '', thumbnailUrl: '', actionData: {}, notes: '', active: true };
            this.cardDialogVisible = true;
        },

        editCard(row) {
            this.cardDialogTitle = 'Edit Card Mapping';
            const form = { ...row };
            // Backward compatibility: convert legacy questionId to questionIds array
            if (!form.questionIds && form.questionId) {
                form.questionIds = [form.questionId];
            }
            if (!form.questionIds) {
                form.questionIds = [];
            }
            if (!form.actionType) {
                form.actionType = form.cardType === 'ai' ? 'ai' : (form.questionPackId ? 'qna' : 'content');
            }
            const actionData = form.actionData || {};
            form.aiAgentName = actionData.agent_name || form.aiAgentName || 'Cheeko';
            form.aiLanguageCode = actionData.language_code || form.aiLanguageCode || 'en';
            form.aiLanguageName = actionData.language_name || form.aiLanguageName || this.getLanguageNameFromCode(actionData.language_code || form.aiLanguageCode || 'en');
            form.aiVoiceId = actionData.voice_id || form.aiVoiceId || '';
            this.cardForm = form;
            this.cardDialogVisible = true;
        },

        handleCardSubmit({ form, done }) {
            if (form.cardType === 'ai' || form.actionType === 'ai') {
                const actionData = {
                    ...(form.actionData || {}),
                    agent_name: form.aiAgentName || 'Cheeko',
                    language_code: form.aiLanguageCode || 'en',
                    language_name: form.aiLanguageName || this.getLanguageNameFromCode(form.aiLanguageCode || 'en')
                };
                if (form.aiVoiceId) {
                    actionData.voice_id = form.aiVoiceId;
                } else {
                    delete actionData.voice_id;
                }
                form.cardType = 'ai';
                form.actionType = 'ai';
                form.actionData = actionData;
            }
            const api = form.id ? Api.rfid.updateCard : Api.rfid.addCard;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.cardDialogVisible = false;
                    this.fetchCards();
                    if (this.activeTab === 'aiCards') this.fetchAiCards();
                    this.scheduleStatsRefresh();
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
                        this.scheduleStatsRefresh();
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

        // ==================== AI CARDS ====================
        fetchAiCards() {
            this.aiCardsLoading = true;
            Api.rfid.getCardPage({
                page: this.aiCardsCurrentPage,
                limit: this.aiCardsPageSize,
                rfidUid: this.searchKeyword,
                cardType: 'ai'
            }, ({ data }) => {
                this.aiCardsLoading = false;
                if (data.code === 0) {
                    this.aiCardsList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.aiCardsTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load AI cards');
                }
            });
        },

        handleAiCardsPageSizeChange(val) {
            this.aiCardsPageSize = val;
            this.aiCardsCurrentPage = 1;
            this.fetchAiCards();
        },
        goFirstAiCards() { this.aiCardsCurrentPage = 1; this.fetchAiCards(); },
        goPrevAiCards() { if (this.aiCardsCurrentPage > 1) { this.aiCardsCurrentPage--; this.fetchAiCards(); } },
        goNextAiCards() { if (this.aiCardsCurrentPage < this.aiCardsPageCount) { this.aiCardsCurrentPage++; this.fetchAiCards(); } },
        goToAiCardsPage(page) { this.aiCardsCurrentPage = page; this.fetchAiCards(); },

        handleSelectAllAiCards() {
            this.isAllAiCardsSelected = !this.isAllAiCardsSelected;
            this.aiCardsList.forEach(row => { row.selected = this.isAllAiCardsSelected; });
        },

        showAddAiCardDialog() {
            this.cardDialogTitle = 'Add AI Card';
            this.cardForm = { id: null, rfidUid: '', questionPackId: null, packCode: '', packId: null, contentPackId: null, actionType: 'ai', cardType: 'ai', aiAgentName: 'Cheeko', aiLanguageCode: 'en', aiLanguageName: 'English', aiVoiceId: '', thumbnailUrl: '', actionData: {}, notes: '', active: true };
            this.cardDialogVisible = true;
        },

        deleteAiCard(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} AI card(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteCard(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchAiCards();
                        this.scheduleStatsRefresh();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedAiCards() {
            const selected = this.aiCardsList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteAiCard(selected);
        },

        // ==================== CONTENT PACKS ====================
        fetchContentPacks() {
            this.contentPacksLoading = true;
            const showingCustom = this.showingCustomPacks;
            Api.rfid.getContentPackPage({
                page: this.contentPacksCurrentPage,
                limit: this.contentPacksPageSize,
                packCode: this.searchKeyword,
                contentType: showingCustom ? '' : this.contentPacksTypeFilter,
                scope: showingCustom ? CUSTOM_PACK_SCOPE : ''
            }, ({ data }) => {
                this.contentPacksLoading = false;
                if (data.code === 0) {
                    this.contentPacksList = (data.data.list || []).map(item => ({ ...item, selected: false }));
                    this.contentPacksTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load content packs');
                }
            });
        },

        handleContentPacksTypeChange() {
            this.contentPacksCurrentPage = 1;
            this.fetchContentPacks();
        },

        loadContentPackTypes() {
            Api.rfid.getContentPackList(({ data }) => {
                if (data?.code !== 0) return;
                this.contentPackTypes = [...new Set(
                    (data.data || []).map(pack => pack.contentType).filter(Boolean)
                )].sort();
            });
        },

        handleContentPacksPageSizeChange(val) {
            this.contentPacksPageSize = val;
            this.contentPacksCurrentPage = 1;
            this.fetchContentPacks();
        },
        goFirstContentPacks() { this.contentPacksCurrentPage = 1; this.fetchContentPacks(); },
        goPrevContentPacks() { if (this.contentPacksCurrentPage > 1) { this.contentPacksCurrentPage--; this.fetchContentPacks(); } },
        goNextContentPacks() { if (this.contentPacksCurrentPage < this.contentPacksPageCount) { this.contentPacksCurrentPage++; this.fetchContentPacks(); } },
        goToContentPacksPage(page) { this.contentPacksCurrentPage = page; this.fetchContentPacks(); },

        handleSelectAllContentPacks() {
            this.isAllContentPacksSelected = !this.isAllContentPacksSelected;
            this.contentPacksList.forEach(row => { row.selected = this.isAllContentPacksSelected; });
        },

        showAddContentPackDialog() {
            this.contentPackDialogTitle = 'Add Content Pack';
            this.contentPackForm = { id: null, packCode: '', name: '', description: '', thumbnailUrl: '', contentType: 'prompt', language: 'en', contentMd: '', totalItems: 0, items: [], active: true };
            this.contentPackDialogVisible = true;
        },

        editContentPack(row) {
            this.contentPackDialogTitle = 'Edit Content Pack';
            // Fetch full pack details to ensure items array is loaded
            Api.rfid.getContentPackByCode(row.packCode, ({ data }) => {
                if (data.code === 0 && data.data) {
                    const fullPack = data.data;
                    // Ensure items array exists
                    if (!fullPack.items) {
                        fullPack.items = [];
                    }
                    this.contentPackForm = { ...fullPack };
                    this.contentPackDialogVisible = true;
                } else {
                    // Fallback to row data if fetch fails
                    const form = { ...row };
                    if (!form.items) {
                        form.items = [];
                    }
                    this.contentPackForm = form;
                    this.contentPackDialogVisible = true;
                }
            });
        },

        handleContentPackSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updateContentPack : Api.rfid.addContentPack;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Added successfully');
                    this.contentPackDialogVisible = false;
                    this.fetchContentPacks();
                    this.loadContentPackTypes();
                    this.loadDropdownData(['contentPacks']);
                    this.scheduleStatsRefresh();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deleteContentPack(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} content pack(s)?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteContentPack(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchContentPacks();
                        this.loadDropdownData(['contentPacks']);
                        this.scheduleStatsRefresh();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedContentPacks() {
            const selected = this.contentPacksList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteContentPack(selected);
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
            this.seriesDialogTitle = 'Add Bulk Range';
            this.seriesForm = { id: null, startUid: '', endUid: '', questionPackId: null, contentPackId: null, priority: 0, notes: '', active: true };
            this.seriesDialogVisible = true;
        },

        editSeries(row) {
            this.seriesDialogTitle = 'Edit Bulk Range';
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
                    this.scheduleStatsRefresh();
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
                        this.scheduleStatsRefresh();
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


        // ==================== CARD TAP ANALYTICS ====================
        buildCardTapSearchParams() {
            const keyword = (this.searchKeyword || '').trim();
            if (!keyword) return {};
            const isMac = keyword.includes(':') || keyword.includes('-') || /^[0-9a-fA-F]{12}$/.test(keyword);
            return isMac ? { mac: keyword } : { uid: keyword };
        },

        fetchCardTapAnalytics() {
            const searchParams = this.buildCardTapSearchParams();

            this.cardTapLogsLoading = true;
            Api.rfid.getCardTapLogs({
                page: this.cardTapCurrentPage,
                limit: this.cardTapPageSize,
                ...searchParams
            }, ({ data }) => {
                this.cardTapLogsLoading = false;
                if (data.code === 0) {
                    this.cardTapLogsList = (data.data.list || []).map(item => ({ ...item }));
                    this.cardTapTotal = data.data.total || 0;
                } else {
                    this.$message.error(data.msg || 'Failed to load card tap logs');
                }
            });

            this.cardTapSummaryLoading = true;
            Api.rfid.getCardTapSummary(searchParams, ({ data }) => {
                this.cardTapSummaryLoading = false;
                if (data.code === 0) {
                    this.cardTapSummary = data.data || this.cardTapSummary;
                    this.stats.totalCardTaps = data.data?.totals?.totalTaps || 0;
                }
            });
        },

        handleCardTapPageSizeChange(val) {
            this.cardTapPageSize = val;
            this.cardTapCurrentPage = 1;
            this.fetchCardTapAnalytics();
        },
        goFirstCardTap() { this.cardTapCurrentPage = 1; this.fetchCardTapAnalytics(); },
        goPrevCardTap() { if (this.cardTapCurrentPage > 1) { this.cardTapCurrentPage--; this.fetchCardTapAnalytics(); } },
        goNextCardTap() { if (this.cardTapCurrentPage < this.cardTapPageCount) { this.cardTapCurrentPage++; this.fetchCardTapAnalytics(); } },
        goToCardTapPage(page) { this.cardTapCurrentPage = page; this.fetchCardTapAnalytics(); },

        // ==================== CONSOLE ====================
        // ==================== NFC LIVE READER ====================
        toggleNfcConnection() {
            if (this.nfcConnected) {
                this.disconnectNfc();
            } else {
                this.connectNfc();
            }
        },

        connectNfc() {
            if (this.nfcSocket) {
                this.nfcSocket.close();
            }

            const wsUrl = 'ws://localhost:8765';
            try {
                this.nfcSocket = new WebSocket(wsUrl);
            } catch (e) {
                this.$message.error('Failed to connect to NFC bridge');
                return;
            }

            this.nfcSocket.onopen = () => {
                this.nfcConnected = true;
                this.nfcScanning = true;
                this.$message.success('NFC Reader connected');
                if (this.nfcReconnectTimer) {
                    clearTimeout(this.nfcReconnectTimer);
                    this.nfcReconnectTimer = null;
                }
                // Start time-ago updater
                this.nfcTimeAgoTimer = setInterval(() => this.updateTimeAgos(), 10000);
            };

            this.nfcSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'nfc_tap') {
                        this.handleNfcTap(data.uid);
                    }
                } catch (e) { /* ignore parse errors */ }
            };

            this.nfcSocket.onclose = () => {
                this.nfcConnected = false;
                this.nfcScanning = false;
                if (this.nfcTimeAgoTimer) {
                    clearInterval(this.nfcTimeAgoTimer);
                    this.nfcTimeAgoTimer = null;
                }
            };

            this.nfcSocket.onerror = () => {
                this.nfcConnected = false;
                this.nfcScanning = false;
                this.$message.error('NFC bridge not running. Start it with: python nfc_bridge.py');
            };
        },

        disconnectNfc() {
            if (this.nfcSocket) {
                this.nfcSocket.close();
                this.nfcSocket = null;
            }
            this.nfcConnected = false;
            this.nfcScanning = false;
            if (this.nfcTimeAgoTimer) {
                clearInterval(this.nfcTimeAgoTimer);
                this.nfcTimeAgoTimer = null;
            }
        },

        handleNfcTap(uid) {
            const now = Date.now();
            this.nfcScanning = false;
            setTimeout(() => { if (this.nfcConnected) this.nfcScanning = true; }, 300);

            this.consoleLookupUid = uid;
            this.nfcLastTap = { uid, timestamp: now, timeAgo: 'just now' };

            // If detail dialog is open, fill the "Add Card" input instead
            if (this.nfcDetailVisible && this.nfcDetailData) {
                // Check if this card is already in the linked list
                if (this.nfcLinkedCards.some(c => c.rfidUid === uid)) {
                    this.$message.warning(`Card ${uid} is already mapped to this content`);
                    return;
                }
                this.nfcNewCardUid = uid;
                this.$message.info(`Card ${uid} ready to add`);
                return;
            }

            // Auto-lookup and show dialog
            Api.rfid.lookupCard(uid, ({ data }) => {
                const found = data.code === 0 && data.data;
                const title = found ? (data.data.title || data.data.packName || data.data.contentType || 'Mapped') : null;
                const responseData = found ? data.data : null;

                // Add to history with stored data
                const historyEntry = { uid, timestamp: now, timeAgo: 'just now', found: !!found, title, data: responseData };
                this.nfcTapHistory.unshift(historyEntry);
                if (this.nfcTapHistory.length > 10) this.nfcTapHistory.pop();

                // Auto-open detail dialog
                this.nfcDetailUid = uid;
                this.nfcDetailData = responseData;
                this.nfcShowRawJson = false;
                this.nfcNewCardUid = '';
                this.nfcDetailVisible = true;
                if (responseData) {
                    this.loadLinkedCards();
                } else {
                    this.nfcLinkedCards = [];
                }
            });
        },

        lookupHistoryTap(tap) {
            const openDialog = (responseData) => {
                this.nfcDetailUid = tap.uid;
                this.nfcDetailData = responseData;
                this.nfcShowRawJson = false;
                this.nfcNewCardUid = '';
                this.nfcDetailVisible = true;
                if (responseData) {
                    this.loadLinkedCards();
                } else {
                    this.nfcLinkedCards = [];
                }
            };
            if (tap.data) {
                openDialog(tap.data);
            } else {
                Api.rfid.lookupCard(tap.uid, ({ data }) => {
                    openDialog(data.code === 0 && data.data ? data.data : null);
                });
            }
        },

        loadLinkedCards() {
            if (!this.nfcDetailData) return;
            this.nfcLinkedLoading = true;
            const uid = this.nfcDetailData.rfid_uid || this.nfcDetailUid;

            // First get the card mapping to find contentPackId/categoryId
            Api.rfid.getCardByUid(uid, ({ data }) => {
                if (data.code === 0 && data.data) {
                    const mapping = data.data;

                    // Store for addLinkedCard
                    this.nfcDetailData._contentPackId = mapping.contentPackId;
                    this.nfcDetailData._categoryId = mapping.categoryId;
                    this.nfcDetailData._cardType = mapping.cardType;
                    this.nfcDetailData._notes = mapping.notes;

                    let searchBy;
                    if (mapping.contentPackId) {
                        searchBy = { contentPackId: mapping.contentPackId };
                    } else if (mapping.categoryId) {
                        searchBy = { categoryId: mapping.categoryId };
                    } else if (mapping.cardType === 'ai') {
                        // AI cards — search all AI cards, then filter by same notes (card type)
                        searchBy = { cardType: 'ai' };
                    } else {
                        searchBy = { packCode: this.nfcDetailData.packCode };
                    }

                    Api.rfid.getCardPage({ page: 1, limit: 50, ...searchBy }, ({ data: d2 }) => {
                        this.nfcLinkedLoading = false;
                        if (d2.code === 0 && d2.data && d2.data.list) {
                            let cards = d2.data.list;
                            // For AI cards, filter by same notes (card type label)
                            if (mapping.cardType === 'ai' && mapping.notes) {
                                cards = cards.filter(c => c.notes === mapping.notes);
                            }
                            this.nfcLinkedCards = cards.map(c => ({ ...c, _deleting: false }));
                        } else {
                            this.nfcLinkedCards = [];
                        }
                    });
                } else {
                    this.nfcLinkedLoading = false;
                    this.nfcLinkedCards = [];
                }
            });
        },

        addLinkedCard() {
            const newUid = this.nfcNewCardUid.trim().toUpperCase().replace(/[:-]/g, '');
            if (!newUid) return;
            if (!this.nfcDetailData) return;

            this.nfcAddingCard = true;

            const isAiCard = this.nfcDetailData._cardType === 'ai' || this.nfcDetailData.contentType === 'prompt';
            const contentPackId = this.nfcDetailData._contentPackId
                || (this.nfcLinkedCards.find(c => c.contentPackId) || {}).contentPackId
                || null;
            const categoryId = this.nfcDetailData._categoryId
                || (this.nfcLinkedCards.find(c => c.categoryId) || {}).categoryId
                || null;

            const cardData = isAiCard ? {
                rfidUid: newUid,
                cardType: 'ai',
                actionType: 'ai',
                active: true,
                notes: this.nfcDetailData._notes || this.nfcDetailData.title || 'AI Card'
            } : {
                rfidUid: newUid,
                packCode: this.nfcDetailData.packCode || null,
                contentPackId: contentPackId,
                categoryId: categoryId,
                cardType: 'content',
                active: true,
                notes: `Linked to ${this.nfcDetailData.title || this.nfcDetailData.packCode}`
            };

            // Check if card already exists — update it instead of creating
            const existing = this.nfcLinkedCards.find(c => c.rfidUid === newUid);
            if (existing) {
                // Update existing card to point to this content
                Api.rfid.updateCard({ ...cardData, id: existing.id }, ({ data }) => {
                    this.nfcAddingCard = false;
                    if (data.code === 0) {
                        this.$message.success(`Card ${newUid} updated to this content`);
                        this.nfcNewCardUid = '';
                        this.loadLinkedCards();
                    } else {
                        this.$message.error(data.msg || 'Failed to update card');
                    }
                });
                return;
            }

            // Try to add — if it already exists elsewhere, fetch its ID and update
            Api.rfid.addCard(cardData, ({ data }) => {
                if (data.code === 0) {
                    this.nfcAddingCard = false;
                    this.$message.success(`Card ${newUid} mapped successfully`);
                    this.nfcNewCardUid = '';
                    this.loadLinkedCards();
                    this.scheduleStatsRefresh();
                } else if (data.msg && data.msg.includes('already exists')) {
                    // Card exists with different content — update it
                    Api.rfid.getCardByUid(newUid, ({ data: uidData }) => {
                        if (uidData.code === 0 && uidData.data) {
                            Api.rfid.updateCard({ ...cardData, id: uidData.data.id }, ({ data: upData }) => {
                                this.nfcAddingCard = false;
                                if (upData.code === 0) {
                                    this.$message.success(`Card ${newUid} remapped to this content`);
                                    this.nfcNewCardUid = '';
                                    this.loadLinkedCards();
                                    this.scheduleStatsRefresh();
                                } else {
                                    this.$message.error(upData.msg || 'Failed to update card');
                                }
                            });
                        } else {
                            this.nfcAddingCard = false;
                            this.$message.error('Failed to find existing card for update');
                        }
                    });
                } else {
                    this.nfcAddingCard = false;
                    this.$message.error(data.msg || 'Failed to add card');
                }
            });
        },

        removeLinkedCard(card) {
            this.$confirm(`Remove card ${card.rfidUid} from this content?`, 'Confirm', {
                confirmButtonText: 'Remove',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                card._deleting = true;
                Api.rfid.deleteCard([card.id], ({ data }) => {
                    card._deleting = false;
                    if (data.code === 0) {
                        this.$message.success('Card removed');
                        this.loadLinkedCards();
                        this.scheduleStatsRefresh();
                    } else {
                        this.$message.error(data.msg || 'Failed to remove card');
                    }
                });
            }).catch(() => {});
        },

        updateTimeAgos() {
            const now = Date.now();
            const fmt = (ts) => {
                const diff = Math.floor((now - ts) / 1000);
                if (diff < 10) return 'just now';
                if (diff < 60) return `${diff}s ago`;
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                return `${Math.floor(diff / 3600)}h ago`;
            };
            if (this.nfcLastTap) {
                this.nfcLastTap = { ...this.nfcLastTap, timeAgo: fmt(this.nfcLastTap.timestamp) };
            }
            this.nfcTapHistory = this.nfcTapHistory.map(t => ({ ...t, timeAgo: fmt(t.timestamp) }));
        },

        handleConsoleLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleLookupLoading = true;
            this.consoleLookupResult = null;
            this.resetLookupPreview();

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
            this.resetLookupPreview();

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
        },

        handleContentLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleContentLoading = true;
            this.consoleLookupResult = null;
            this.resetLookupPreview();

            Api.rfid.lookupContent(this.consoleLookupUid.trim(), this.consoleSequence, ({ data }) => {
                this.consoleContentLoading = false;
                if (data.code === 0 && data.data) {
                    this.consoleLookupResult = {
                        success: true,
                        type: `content (seq ${this.consoleSequence})`,
                        data: data.data
                    };
                } else {
                    this.consoleLookupResult = {
                        success: false,
                        type: 'content',
                        data: { error: data.msg || 'Content not found', uid: this.consoleLookupUid, sequence: this.consoleSequence }
                    };
                }
            });
        },

        handleDownloadLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleDownloadLoading = true;
            this.consoleLookupResult = null;
            this.resetLookupPreview();

            Api.rfid.getContentDownload(this.consoleLookupUid.trim(), ({ data }) => {
                this.consoleDownloadLoading = false;
                if (data.code === 0 && data.data) {
                    this.consoleLookupResult = {
                        success: true,
                        type: 'download manifest',
                        data: data.data
                    };
                } else {
                    this.consoleLookupResult = {
                        success: false,
                        type: 'download',
                        data: { error: data.msg || 'Download manifest not found', uid: this.consoleLookupUid }
                    };
                }
            });
        }
    }
};
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.welcome {
    min-height: 0;
    display: flex;
    position: relative;
    flex-direction: column;
    background: transparent;
}

.main-wrapper {
    margin: 0;
    border-radius: 0;
    min-height: 0;
    height: auto;
    box-shadow: none;
    position: relative;
    background: transparent;
    display: flex;
    flex-direction: column;
}

.operation-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    flex-wrap: wrap;
    gap: 10px;
}

.page-title {
  margin: 0;
  font-family: $font-display;
  font-size: 34px;
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.025em;
  color: $text-dark;

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
    background: $surface;
    border: none;
    color: white;
}

.tab-navigation {
    display: flex;
    gap: 26px;
    padding: 0;
    margin-bottom: 22px;
    background: transparent;
    border-bottom: 1px solid $border-color;
    // Mobile: tabs scroll sideways instead of wrapping into a blob
    overflow-x: auto;
}

.tab-btn {
    padding: 0 0 11px;
    border-radius: 0;
    background: transparent;
    color: $text-gray;
    cursor: pointer;
    font-weight: 400;
    font-size: 13px;
    white-space: nowrap;
    flex: 0 0 auto;
    transition: color 0.15s ease, box-shadow 0.15s ease;

    i { margin-right: 5px; }

    &.active {
        background: transparent;
        color: $text-dark;
        font-weight: 550;
        box-shadow: inset 0 -2px 0 0 $text-dark;
    }

    &:hover:not(.active) {
        background: transparent;
        color: $text-body;
    }
}

.content-panel {
    flex: 1;
    display: flex;
    overflow: visible;
    height: auto;
    border-radius: 0;
    background: transparent;
    border: 0;
}

.content-area {
    flex: 1;
    height: auto;
    min-width: 0;
    overflow: visible;
    background: transparent;
    display: flex;
    flex-direction: column;
}

.rfid-card {
    background: $surface;
    flex: 1;
    display: flex;
    flex-direction: column;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    box-shadow: none;
    overflow: hidden;

    ::v-deep .el-card__body {
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: visible;
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
        box-shadow: none;

        &:hover {
            transform: translateY(-1px);
            box-shadow: none;
        }
    }

    .el-button--primary {
        background: $text-dark;
        color: white;
    }

    .el-button--success {
        background: $success;
        color: white;
    }

    .el-button--danger {
        background: $danger;
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
        border: 1px solid $border-color;
        background: $surface-sunk;
        color: $text-body;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s ease;

        &:hover {
            background: $border-color;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        &.active {
            background: $text-dark !important;
            color: $white !important;
            border-color: $text-dark !important;
        }
    }

    .total-text {
        color: $text-light;
        font-size: 14px;
        margin-left: 10px;
    }
}

.filter-group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.filter-label {
    font-size: 12px;
    color: $text-light;
    white-space: nowrap;
}

.type-filter-select {
    width: 160px;

    :deep(.el-input__inner) {
        height: 28px;
        line-height: 28px;
        border-radius: 4px;
        border: 1px solid $border-color;
        background: $surface-sunk;
        color: $text-body;
    }
}

.page-size-select {
    width: 120px;
    margin-right: 10px;

    :deep(.el-input__inner) {
        height: 32px;
        line-height: 32px;
        border-radius: 4px;
        border: 1px solid $border-color;
        background: $surface-sunk;
        color: $text-body;
        font-size: 14px;
    }
}

:deep(.transparent-table) {
    background: $surface;
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;

    .el-table__body-wrapper {
        flex: 1;
        overflow-y: auto;
    }

    .el-table__header th {
        background: $surface !important;
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
    background-color: $surface-sunk !important;
    border-color: $border-color !important;
}

:deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: $text-dark !important;
    border-color: $text-dark !important;
}

:deep(.el-table .el-button--text) {
    color: $text-gray;
}

:deep(.el-table .el-button--text:hover) {
    color: $text-dark;
}

:deep(.el-loading-mask) {
    background-color: rgba(255, 255, 255, 0.6) !important;
    backdrop-filter: blur(2px);
}

:deep(.el-loading-spinner .path) {
    stroke: $primary;
}

:deep(.el-loading-text) {
    color: $primary !important;
}

/* Console Tab Styles */
/* Stats Bar */
.stats-bar {
    display: flex;
    gap: 16px;
    padding: 0 24px 8px;
    min-height: 64px;
    // Mobile: the KPI strip scrolls sideways instead of squeezing
    overflow-x: auto;
}

.stat-item {
    flex: 1 0 120px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: $surface;
    border-radius: 10px;
    box-shadow: none;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
        transform: translateY(-2px);
        box-shadow: none;
    }
}

.stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;

    &.prompts { background: $surface-sunk; color: $text-gray; }
    &.content { background: $surface-sunk; color: $text-gray; }
    &.skus { background: $surface-sunk; color: $text-gray; }
    &.cards { background: $surface-sunk; color: $text-gray; }
    &.series { background: $surface-sunk; color: $text-gray; }
    &.analytics { background: $surface-sunk; color: $text-gray; }
}

.stat-content {
    .stat-value {
        font-size: 20px;
        font-weight: 700;
        color: $text-dark;
        line-height: 1.2;
    }

    .stat-label {
        font-size: 11px;
        color: $text-light;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}

/* Section Headers — flush with the card body's own padding, so the title
   starts on the same line as the toolbar and the grid below it. */
.section-header {
    padding: 0 0 14px;
    border-bottom: 1px solid $divider-color;
    margin-bottom: 16px;
}

.section-info {
    .section-title {
        margin: 0 0 5px;
        font-size: 13.5px;
        font-weight: 590;
        letter-spacing: -0.01em;
        color: $text-dark;
        display: flex;
        align-items: center;
        gap: 8px;

        i {
            color: $text-light;
        }
    }

    .section-count {
        font-weight: 500;
        font-size: 11px;
    }

    .section-description {
        margin: 0;
        font-size: 12.5px;
        color: $text-gray;
        line-height: 1.55;
        max-width: 82ch;
    }

    .section-help {
        color: $text-light;
        cursor: help;
        margin-left: 4px;

        &:hover {
            color: $text-dark;
        }
    }
}

/* Card table helpers */
.uid-mono {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    color: $text-body;
    letter-spacing: 0.5px;
}

.text-muted {
    color: $text-light;
}

.content-badge {
    i {
        margin-right: 3px;
    }
}

.analytics-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin: 0 0 14px;
}

.analytics-kpi {
    background: $surface-sunk;
    border: 1px solid $border-color;
    border-radius: 10px;
    padding: 10px 12px;

    &.warning {
        background: $warning-bg;
        border-color: darken($warning-bg, 6%);
    }

    &.danger {
        background: $danger-bg;
        border-color: darken($danger-bg, 6%);
    }
}

.analytics-kpi-label {
    font-size: 11px;
    color: $text-gray;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}

.analytics-kpi-value {
    margin-top: 4px;
    font-size: 22px;
    font-weight: 700;
    color: $text-dark;
}

.analytics-insights {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin: 0 0 14px;
}

.insight-card {
    background: $surface;
    border: 1px solid $border-color;
    border-radius: 10px;
    padding: 10px 12px;
}

.insight-title {
    font-size: 12px;
    font-weight: 700;
    color: $text-body;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}

.insight-list {
    max-height: 172px;
    overflow-y: auto;
}

.insight-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: $text-body;
    padding: 4px 0;
    border-bottom: 1px dashed $border-color;
}

.insight-row:last-child {
    border-bottom: none;
}

.insight-empty {
    font-size: 12px;
    color: $text-light;
    padding: 6px 0;
}

.content-pack-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    background: $surface;
    color: white;
    font-size: 12px;
    font-weight: 500;
}

.qa-pack-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    background: $surface;
    color: white;
    font-size: 12px;
    font-weight: 500;
}

/* Console Tab Styles */
/* NFC Live Reader Panel */
.nfc-live-panel {
    margin: 0 0 16px;
    padding: 14px 18px;
    border-radius: 10px;
    border: 1.5px dashed $border-color;
    background: $surface-sunk;
    transition: all 0.3s ease;

    &.connected {
        border-color: $success;
        background: $surface;
    }
}

.nfc-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.nfc-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
}

.nfc-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: $text-light;
    display: inline-block;
    transition: background 0.3s;

    &.active {
        background: $success;
    }

    &.pulse {
        animation: nfc-pulse 2s infinite;
    }
}

@keyframes nfc-pulse {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: none; }
}

.nfc-label {
    font-size: 13px;
    font-weight: 500;
    color: $text-body;
}

.nfc-tap-hint {
    margin-top: 8px;
    font-size: 12px;
    color: $text-light;

    i {
        animation: nfc-tap-bounce 1.5s infinite;
    }
}

@keyframes nfc-tap-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
}

.nfc-last-tap {
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}

.nfc-tap-label {
    color: $text-light;
    font-weight: 500;
}

.nfc-uid-tag {
    font-family: 'SF Mono', 'Fira Code', monospace;
    letter-spacing: 0.5px;
}

.nfc-tap-time {
    color: $text-light;
    font-size: 11px;
}

.nfc-history {
    margin-top: 10px;
    border-top: 1px solid $divider-color;
    padding-top: 8px;
}

.nfc-history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}

.nfc-history-title {
    font-size: 12px;
    font-weight: 500;
    color: $text-light;
}

.nfc-history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
}

.nfc-history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
        background: $surface-sunk;
    }
}

.nfc-history-uid {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-weight: 500;
    color: $text-dark;
    min-width: 100px;
}

.nfc-history-content {
    color: $text-body;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nfc-history-time {
    color: $text-light;
    font-size: 11px;
    flex-shrink: 0;
}

/* NFC Detail Dialog */
.nfc-detail-content {
    max-height: 65vh;
    overflow-y: auto;
}

.nfc-detail-summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 16px;
    border-bottom: 1px solid $divider-color;
}

.nfc-detail-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.nfc-detail-label {
    font-size: 13px;
    font-weight: 500;
    color: $text-light;
    min-width: 80px;
}

.nfc-detail-value {
    font-size: 13px;
    color: $text-dark;
}

.nfc-detail-section-title {
    font-size: 14px;
    font-weight: 600;
    color: $text-dark;
    margin: 16px 0 10px;
}

.nfc-detail-stories {
    margin-top: 4px;
}

.nfc-detail-story {
    margin-bottom: 12px;
    padding: 10px 12px;
    background: $surface-sunk;
    border-radius: 8px;
    border: 1px solid $divider-color;
}

.nfc-story-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.nfc-story-title {
    font-size: 13px;
    font-weight: 500;
    color: $text-dark;
}

.nfc-story-tracks {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.nfc-story-track {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 4px 0;
}

.nfc-track-num {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: $surface-sunk;
    color: $info;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
}

.nfc-track-title {
    font-weight: 500;
    color: $text-body;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nfc-track-url {
    color: $text-light;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-family: monospace;
    font-size: 11px;
}

/* NFC Linked Cards */
.nfc-linked-cards {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid $divider-color;
}

.nfc-linked-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;

    .nfc-detail-section-title {
        margin: 0;
    }
}

.nfc-linked-loading {
    text-align: center;
    padding: 16px;
    color: $text-light;
    font-size: 13px;
}

.nfc-linked-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
}

.nfc-linked-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: $surface-sunk;
    border-radius: 6px;
    border: 1px solid $divider-color;
}

.nfc-linked-notes {
    flex: 1;
    font-size: 12px;
    color: $text-light;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nfc-linked-empty {
    text-align: center;
    padding: 12px;
    color: $text-light;
    font-size: 13px;
}

.nfc-add-card {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    align-items: center;
}

.nfc-add-input {
    flex: 1;
}

.nfc-detail-raw-toggle {
    margin-top: 12px;
    text-align: center;
}

.nfc-detail-json {
    background: $surface-sunk;
    border: 1px solid $divider-color;
    color: $text-body;
    font-family: $font-mono;
    border-radius: $radius-md;
    padding: 14px 16px;
    font-size: 11px;
    line-height: 1.5;
    max-height: 300px;
    overflow: auto;
    margin-top: 8px;
}

.nfc-detail-not-found {
    text-align: center;
    padding: 30px 0;
}

.console-container {
    padding: 20px;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.console-input-section {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    align-items: flex-end;
    flex-wrap: wrap;

    .console-input {
        flex: 1;
        max-width: 400px;
        min-width: 200px;
    }

    .console-sequence {
        width: 90px;
    }
}

.sequence-group {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .sequence-label {
        font-size: 12px;
        color: $text-gray;
        font-weight: 500;

        i {
            font-size: 12px;
            color: $text-light;
            cursor: help;
        }
    }
}

.console-actions {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

/* ---------- Lookup & Test result ----------------------------------------
   The resolved card previewed with the same chrome as the Content Packs
   grid, minus every control that would change it. */
.lookup-result {
    flex: 1 0 100%;
    margin-top: 4px;
    margin-bottom: 20px;
}

.lookup-verdict {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-bottom: 12px;
    margin-bottom: 16px;
    border-bottom: 1px solid $divider-color;

    i {
        color: $success;
        font-size: 13px;
    }

    .lookup-verdict-text {
        font-size: 13px;
        font-weight: 590;
        color: $text-dark;
    }

    .lookup-verdict-type {
        font-family: $font-mono;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        color: $text-light;
    }

    &.failed i { color: $danger; }
}

.lookup-error {
    padding: 14px 16px;
    background: $danger-bg;
    border: 1px solid darken($danger-bg, 6%);
    border-radius: $radius-md;
    font-size: 12.5px;
    color: $danger;
}

.pack-card.preview {
    max-width: 420px;
    cursor: default;

    &:hover { border-color: $border-color; }
}

.preview-prompt {
    -webkit-line-clamp: 4;
}

.preview-tracks {
    border-top: 1px solid $divider-color;
    max-height: 320px;
    overflow-y: auto;
}

.preview-track {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;

    & + .preview-track {
        border-top: 1px solid $divider-color;
    }
}

.preview-track-seq {
    flex: 0 0 auto;
    min-width: 18px;
    font-family: $font-mono;
    font-size: 10px;
    color: $text-light;
}

.preview-agent {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0 2px;
    padding: 10px 12px;
    background: $surface-sunk;
    border-radius: $radius-md;
}

.preview-agent-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.preview-agent-name {
    font-size: 13px;
    font-weight: 560;
    color: $text-dark;
}

.preview-agent-sub {
    font-size: 11.5px;
    color: $text-gray;
    margin-top: 1px;
}

.preview-track-thumb {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: $radius-sm;
    border: 1px solid $border-color;
    background: $surface-sunk;
    // `cover` fills the box at any source aspect; `contain` left letterbox
    // gaps and made portrait art read as a sliver.
    object-fit: cover;
    object-position: center;
    display: block;
    overflow: hidden;

    &.is-empty,
    &.is-loading,
    &.is-device {
        display: flex;
        align-items: center;
        justify-content: center;
        color: $text-light;
        font-size: 13px;
    }

    &.is-device {
        background: $accent-wash;
        color: $primary-dark;
        border-color: $accent-wash;
    }
}

.preview-track-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: $text-body;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.preview-track-story {
    flex: 0 0 auto;
    font-family: $font-mono;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: $text-light;
}

.lookup-raw {
    margin-top: 12px;

    :deep(.el-button--text) {
        padding: 0;
        font-size: 11.5px;
        color: $text-light;

        &:hover { color: $text-dark; }
    }
}

.lookup-raw-json {
    margin: 8px 0 0;
    padding: 14px 16px;
    max-height: 320px;
    overflow: auto;
    background: $surface-sunk;
    border: 1px solid $divider-color;
    border-radius: $radius-md;
    font-family: $font-mono;
    font-size: 11px;
    line-height: 1.6;
    color: $text-body;
}

.lookup-guide {
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: left;
    max-width: 400px;

    .guide-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: $text-gray;

        .el-tag {
            min-width: 130px;
            text-align: center;
        }
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
            color: $text-dark;

            i {
                margin-right: 6px;
            }

            .el-icon-success {
                color: $success;
            }

            .el-icon-error {
                color: $danger;
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
    color: $text-light;

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

/* ---------- Content pack grid --------------------------------------------
   One flat surface per pack: a 1px rule, the card artwork whole, then the
   text. No inner bands, no elevation — the same chrome as every other card
   on the page. */
.pack-grid-container {
    padding: 4px 0 0;
    min-height: 200px;
}
.pack-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
    // Every tile is the same ratio, so cards line up bottom to bottom. The cap
    // stops a wide viewport blowing a card up to full column width.
    align-items: stretch;
    justify-items: stretch;
    gap: 16px;
    padding-bottom: 20px;
}
.pack-card {
    position: relative;
    width: 100%;
    max-width: 216px;
    display: flex;
    flex-direction: column;
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-lg;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.18s ease, background-color 0.18s ease;

    &:hover {
        border-color: $text-light;
    }

    &.selected {
        border-color: $text-dark;
        background: $row-selected;
    }
}

.pack-select {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    padding: 3px;
    background: $surface;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    line-height: 0;
}

/* One tile ratio for every card, so a pack with no artwork is the same size as
   one with. It is portrait because the card faces are: at 3:4 the artwork
   fills the tile edge to edge, and `contain` means an odd ratio letterboxes
   rather than losing the subject to a crop. */
.pack-visual {
    position: relative;
    margin: 0;
    aspect-ratio: 3 / 4;
    background: $surface-sunk;
    border-bottom: 1px solid $divider-color;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
    }
}

.pack-visual-empty {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 6px;
    color: $text-light;

    i { font-size: 22px; }

    span {
        font-family: $font-mono;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.11em;
    }
}

.pack-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    padding: 13px 14px 12px;
}

.pack-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
}

.pack-title {
    margin: 0;
    font-size: 12.5px;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: $text-dark;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.pack-status {
    flex: 0 0 auto;
    font-family: $font-mono;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: $text-light;

    &.live { color: $success; }
}

.pack-code {
    margin-top: 5px;
    font-family: $font-mono;
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: $text-light;
    word-break: break-all;
}

.pack-desc {
    margin: 9px 0 0;
    flex: 1 1 auto;
    font-size: 11.5px;
    line-height: 1.5;
    color: $text-gray;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.pack-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin-top: 11px;
    font-family: $font-mono;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: $text-light;

    span + span {
        padding-left: 8px;
        border-left: 1px solid $divider-color;
    }
}

.pack-actions {
    display: flex;
    gap: 14px;
    padding: 9px 14px;
    border-top: 1px solid $divider-color;

    :deep(.el-button--text) {
        padding: 0;
        font-size: 11.5px;
        color: $text-gray;

        &:hover { color: $text-dark; }

        &.is-danger:hover { color: $danger; }
    }
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 64px 0;
    background: $surface-sunk;
    border: 1px solid $divider-color;
    border-radius: $radius-lg;
    text-align: center;

    .empty-icon {
        font-size: 24px;
        color: $text-light;
    }

    .empty-title {
        font-family: $font-display;
        font-size: 19px;
        color: $text-body;
    }
}
.ai-card-thumbnail {
    width: 56px;
    height: 42px;
    margin: 0 auto;
    border-radius: $radius-sm;
    border: 1px solid $border-color;
    background: $surface-sunk;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ai-card-thumbnail img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
}

// ---------- Card Mappings thumbnail ----------
// Small enough to keep the row height it already had; the artwork is printed on
// the physical card, so it is fitted whole rather than cropped to fill.
.thumb-cell {
    width: 46px;
    height: 46px;
    margin: 0 auto;
    border-radius: $radius-sm;
    border: 1px solid $border-color;
    background: $surface-sunk;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-in;

    img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
    }

    &.is-empty {
        cursor: default;
        border-style: dashed;
    }

    svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: $text-light;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0.55;
    }
}
/* Stat Icons */
.stat-icon.qa-packs {
    color: $secondary-purple;
    background: $surface-sunk;
}
</style>
