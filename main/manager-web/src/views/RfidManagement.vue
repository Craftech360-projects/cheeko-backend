<template>
    <div class="welcome">
        <HeaderBar />

        <div class="operation-bar">
            <h2 class="page-title">RFID Card Management</h2>
            <div class="right-operations">
                <el-input placeholder="Search..." v-model="searchKeyword" class="search-input"
                    @keyup.enter.native="handleSearch" clearable />
                <el-button class="btn-search" @click="handleSearch">Search</el-button>
            </div>
        </div>

        <!-- Stats Overview Bar -->
        <div class="stats-bar" v-loading="statsLoading" element-loading-background="transparent">

            <div class="stat-item" @click="switchTab('questionPacks')">
                <div class="stat-icon qa-packs" style="background: rgba(155, 89, 182, 0.1); color: #9b59b6;"><i class="el-icon-chat-square"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalQuestionPacks }}</div>
                    <div class="stat-label">Q&A Packs</div>
                </div>
            </div>
            <div class="stat-item" @click="switchTab('contentPacks')">
                <div class="stat-icon content"><i class="el-icon-notebook-2"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalContentPacks }}</div>
                    <div class="stat-label">Content Packs</div>
                </div>
            </div>
            <div class="stat-item" @click="switchTab('packs')">
                <div class="stat-icon skus"><i class="el-icon-goods"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalProductSkus }}</div>
                    <div class="stat-label">Product SKUs</div>
                </div>
            </div>
            <div class="stat-item" @click="switchTab('cards')">
                <div class="stat-icon cards"><i class="el-icon-postcard"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalCards }}</div>
                    <div class="stat-label">Card Mappings</div>
                </div>
            </div>
            <div class="stat-item" @click="switchTab('series')">
                <div class="stat-icon series"><i class="el-icon-s-operation"></i></div>
                <div class="stat-content">
                    <div class="stat-value">{{ stats.totalSeries }}</div>
                    <div class="stat-label">Bulk Ranges</div>
                </div>
            </div>
        </div>

        <div class="main-wrapper">
            <!-- Tab Navigation -->
            <div class="tab-navigation">

                <div class="tab-btn" :class="{ active: activeTab === 'questionPacks' }" @click="switchTab('questionPacks')">
                    <i class="el-icon-chat-square"></i> Q&A Packs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'contentPacks' }" @click="switchTab('contentPacks')">
                    <i class="el-icon-notebook-2"></i> Content Packs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'packs' }" @click="switchTab('packs')">
                    <i class="el-icon-goods"></i> Product SKUs
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'cards' }" @click="switchTab('cards')">
                    <i class="el-icon-postcard"></i> Card Mappings
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'series' }" @click="switchTab('series')">
                    <i class="el-icon-s-operation"></i> Bulk Ranges
                </div>
                <div class="tab-btn" :class="{ active: activeTab === 'console' }" @click="switchTab('console')">
                    <i class="el-icon-search"></i> Lookup &amp; Test
                </div>
            </div>

            <div class="content-panel">
                <div class="content-area">
                    <el-card class="rfid-card" shadow="never">
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
                            <el-table ref="cardsTable" :data="cardsList" class="transparent-table" v-loading="cardsLoading"
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
                                <el-table-column label="Content Type" align="center" width="130">
                                    <template slot-scope="scope">
                                        <el-tag v-if="scope.row.contentPackId" type="warning" size="small" class="content-badge">
                                            <i class="el-icon-notebook-2"></i> Story/Rhyme
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


                        <!-- Q&A Packs Tab (Grid View) -->
                        <template v-if="activeTab === 'questionPacks'">
                            <div class="section-header">
                                <div class="section-info">
                                    <h3 class="section-title">
                                        <i class="el-icon-chat-square"></i> Q&A Packs
                                        <el-tag size="mini" type="info" class="section-count">{{ questionPacksTotal }} total</el-tag>
                                    </h3>
                                    <p class="section-description">
                                        Collections of AI prompts that form a structured conversation or game.
                                        <el-tooltip content="Q&A Packs allow you to group multiple questions together. When a card is tapped, the system intelligently sequences through these questions." placement="top">
                                            <i class="el-icon-question section-help"></i>
                                        </el-tooltip>
                                    </p>
                                </div>
                            </div>

                            <div class="table_top_actions" style="margin-bottom: 20px; display: flex; justify-content: space-between;">
                                <div>
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllQuestionPacks(true)">
                                        Select All
                                    </el-button>
                                    <el-button size="mini" type="success" icon="el-icon-plus" @click="showAddQuestionPackDialog">Create Pack</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedQuestionPacks">Delete Selected</el-button>
                                </div>
                            </div>

                            <div v-loading="questionPacksLoading" class="pack-grid-container" element-loading-background="rgba(255, 255, 255, 0.5)">
                                <div v-if="questionPacksList.length === 0 && !questionPacksLoading" class="empty-state">
                                    <i class="el-icon-chat-square empty-icon" style="font-size: 48px; color: #ddd; margin-bottom: 10px;"></i>
                                    <p style="color: #909399;">No Q&A Packs found</p>
                                    <el-button type="text" @click="showAddQuestionPackDialog">Create your first pack</el-button>
                                </div>

                                <div v-else class="pack-grid">
                                    <div v-for="pack in questionPacksList" :key="pack.id" class="pack-card" :class="{ selected: pack.selected }" @click="editQuestionPack(pack)">
                                        <div class="pack-card-selection" @click.stop="">
                                            <el-checkbox v-model="pack.selected"></el-checkbox>
                                        </div>
                                        <div class="pack-card-header">
                                            <div class="pack-title-row">
                                                <span class="pack-title" :title="pack.name">{{ pack.name }}</span>
                                                <el-tag size="mini" :type="pack.active ? 'success' : 'info'" effect="dark">{{ pack.active ? 'Active' : 'Draft' }}</el-tag>
                                            </div>
                                            <div class="pack-code">{{ pack.packCode }}</div>
                                        </div>
                                        <div class="pack-card-body">
                                            <div class="pack-desc">{{ pack.description || 'No description provided.' }}</div>
                                            <div class="pack-metrics">
                                                <el-tag size="mini" type="warning" effect="plain"><i class="el-icon-chat-dot-square"></i> {{ (pack.questionIds || []).length }} Qs</el-tag>
                                                <el-tag size="mini" type="primary" effect="plain"><i class="el-icon-flag"></i> {{ pack.language }}</el-tag>
                                                <el-tag size="mini" type="info" effect="plain" v-if="pack.category">{{ pack.category }}</el-tag>
                                            </div>
                                        </div>
                                        <div class="pack-card-footer">
                                            <div class="pack-version">v{{ pack.version }}</div>
                                            <div class="pack-actions">
                                                <el-button size="mini" icon="el-icon-edit" circle type="primary" plain @click.stop="editQuestionPack(pack)"></el-button>
                                                <el-button size="mini" icon="el-icon-delete" circle type="danger" plain @click.stop="deleteQuestionPack(pack)"></el-button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="table_bottom">
                                <div class="ctrl_btn"></div>
                                <div class="custom-pagination">
                                    <el-select v-model="questionPacksPageSize" @change="handleQuestionPacksPageSizeChange" class="page-size-select">
                                        <el-option v-for="item in pageSizeOptions" :key="item" :label="`${item} items/page`" :value="item"></el-option>
                                    </el-select>
                                    <button class="pagination-btn" :disabled="questionPacksCurrentPage === 1" @click="goFirstQuestionPacks">First</button>
                                    <button class="pagination-btn" :disabled="questionPacksCurrentPage === 1" @click="goPrevQuestionPacks">Previous</button>
                                    <button v-for="page in questionPacksVisiblePages" :key="page" class="pagination-btn"
                                        :class="{ active: page === questionPacksCurrentPage }" @click="goToQuestionPacksPage(page)">{{ page }}</button>
                                    <button class="pagination-btn" :disabled="questionPacksCurrentPage === questionPacksPageCount" @click="goNextQuestionPacks">Next</button>
                                    <span class="total-text">Total {{ questionPacksTotal }} records</span>
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

                            <div class="table_top_actions" style="margin-bottom: 20px; display: flex; justify-content: space-between;">
                                <div>
                                    <el-button size="mini" type="primary" class="select-all-btn" @click="handleSelectAllContentPacks(true)">
                                        Select All
                                    </el-button>
                                    <el-button size="mini" type="success" icon="el-icon-plus" @click="showAddContentPackDialog">Create Pack</el-button>
                                    <el-button size="mini" type="danger" icon="el-icon-delete" @click="deleteSelectedContentPacks">Delete Selected</el-button>
                                </div>
                            </div>

                            <div v-loading="contentPacksLoading" class="pack-grid-container" element-loading-background="rgba(255, 255, 255, 0.5)">
                                <div v-if="contentPacksList.length === 0 && !contentPacksLoading" class="empty-state">
                                    <i class="el-icon-notebook-2 empty-icon" style="font-size: 48px; color: #ddd; margin-bottom: 10px;"></i>
                                    <p style="color: #909399;">No Content Packs found</p>
                                    <el-button type="text" @click="showAddContentPackDialog">Create your first pack</el-button>
                                </div>

                                <div v-else class="pack-grid">
                                    <div v-for="pack in contentPacksList" :key="pack.id" class="pack-card" :class="{ selected: pack.selected }" @click="editContentPack(pack)">
                                        <div class="pack-card-selection" @click.stop="">
                                            <el-checkbox v-model="pack.selected"></el-checkbox>
                                        </div>
                                        <div class="pack-card-header">
                                            <div class="pack-title-row">
                                                <span class="pack-title" :title="pack.name">{{ pack.name }}</span>
                                                <el-tag size="mini" :type="pack.active ? 'success' : 'info'" effect="dark">{{ pack.active ? 'Active' : 'Draft' }}</el-tag>
                                            </div>
                                            <div class="pack-code">{{ pack.packCode }}</div>
                                        </div>
                                        <div class="pack-card-body">
                                            <div class="pack-desc">{{ pack.description || 'No description provided.' }}</div>
                                            <div class="pack-metrics">
                                                <el-tag size="mini" :type="pack.contentType === 'prompt' ? 'primary' : 'warning'" effect="plain">
                                                    <i :class="pack.contentType === 'prompt' ? 'el-icon-chat-line-round' : 'el-icon-reading'"></i>
                                                    {{ pack.contentType === 'prompt' ? 'AI' : 'TTS' }}
                                                </el-tag>
                                                <el-tag size="mini" type="info" effect="plain"><i class="el-icon-document"></i> {{ pack.totalItems || 0 }} Items</el-tag>
                                                <el-tag size="mini" type="success" effect="plain"><i class="el-icon-flag"></i> {{ pack.language }}</el-tag>
                                            </div>
                                        </div>
                                        <div class="pack-card-footer">
                                            <div class="pack-version">{{ pack.contentType === 'prompt' ? 'AI Generated' : 'Read-Aloud' }}</div>
                                            <div class="pack-actions">
                                                <el-button size="mini" icon="el-icon-edit" circle type="primary" plain @click.stop="editContentPack(pack)"></el-button>
                                                <el-button size="mini" icon="el-icon-delete" circle type="danger" plain @click.stop="deleteContentPack(pack)"></el-button>
                                            </div>
                                        </div>
                                    </div>
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
                                    <div class="sequence-group">
                                        <label class="sequence-label">Item #
                                            <el-tooltip content="Which numbered item in a Content Pack to retrieve (e.g., item 3 of a rhymes pack)" placement="top">
                                                <i class="el-icon-question"></i>
                                            </el-tooltip>
                                        </label>
                                        <el-input-number v-model="consoleSequence" :min="1" :max="99" class="console-sequence" controls-position="right"></el-input-number>
                                    </div>
                                </div>

                                <div class="console-actions">
                                    <el-tooltip content="Find the exact card mapping for this UID" placement="top">
                                        <el-button type="primary" :loading="consoleLookupLoading" @click="handleConsoleLookup">
                                            <i class="el-icon-search"></i> Find Card Mapping
                                        </el-button>
                                    </el-tooltip>
                                    <el-tooltip content="Check if this UID falls within any bulk range" placement="top">
                                        <el-button type="info" :loading="consoleSeriesLoading" @click="handleSeriesLookup">
                                            <i class="el-icon-s-operation"></i> Find Bulk Range
                                        </el-button>
                                    </el-tooltip>
                                    <el-tooltip content="Get the final content (AI prompt text or story item) for this UID + sequence" placement="top">
                                        <el-button type="success" :loading="consoleContentLoading" @click="handleContentLookup">
                                            <i class="el-icon-document"></i> Resolve Content
                                        </el-button>
                                    </el-tooltip>
                                    <el-tooltip content="Get audio download URLs for device offline playback" placement="top">
                                        <el-button type="warning" :loading="consoleDownloadLoading" @click="handleDownloadLookup">
                                            <i class="el-icon-download"></i> Download Manifest
                                        </el-button>
                                    </el-tooltip>
                                </div>

                                <div class="console-result" v-if="consoleLookupResult">
                                    <div class="result-header">
                                        <span class="result-label">
                                            <i :class="consoleLookupResult.success ? 'el-icon-success' : 'el-icon-error'"></i>
                                            {{ getResultTitle(consoleLookupResult) }}
                                        </span>
                                        <el-tag :type="consoleLookupResult.success ? 'success' : 'danger'" size="small">
                                            {{ consoleLookupResult.type || 'card' }}
                                        </el-tag>
                                    </div>
                                    <pre class="result-json">{{ JSON.stringify(consoleLookupResult.data, null, 2) }}</pre>
                                </div>

                                <div class="console-empty" v-else>
                                    <i class="el-icon-search" style="font-size: 48px; margin-bottom: 16px; color: #c0c4cc;"></i>
                                    <p style="font-size: 15px; margin-bottom: 20px;">Enter an RFID UID above and use the buttons to test different lookups</p>
                                    <div class="lookup-guide">
                                        <div class="guide-item">
                                            <el-tag size="small">Find Card Mapping</el-tag>
                                            <span>Exact UID match in Card Mappings</span>
                                        </div>
                                        <div class="guide-item">
                                            <el-tag size="small" type="info">Find Bulk Range</el-tag>
                                            <span>Check if UID falls in any start-end range</span>
                                        </div>
                                        <div class="guide-item">
                                            <el-tag size="small" type="success">Resolve Content</el-tag>
                                            <span>Get final content (prompt text or story item)</span>
                                        </div>
                                        <div class="guide-item">
                                            <el-tag size="small" type="warning">Download Manifest</el-tag>
                                            <span>Get audio URLs for device offline playback</span>
                                        </div>
                                    </div>
                                </div>
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
            :questions="questionsDropdown"
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

        <RfidQuestionPackDialog
            :title="questionPackDialogTitle"
            :visible.sync="questionPackDialogVisible"
            :form="questionPackForm"
            :questions="questionsDropdown"
            @submit="handleQuestionPackSubmit"
            @cancel="questionPackDialogVisible = false"
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
import RfidContentPackDialog from "@/components/RfidContentPackDialog.vue";
import RfidSeriesDialog from "@/components/RfidSeriesDialog.vue";
import RfidQuestionPackDialog from "@/components/RfidQuestionPackDialog.vue";

export default {
    components: { HeaderBar, VersionFooter, RfidQuestionDialog, RfidPackDialog, RfidCardDialog, RfidContentPackDialog, RfidSeriesDialog, RfidQuestionPackDialog },
    data() {
        return {
            activeTab: 'questionPacks',
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
            cardForm: { id: null, rfidUid: '', questionPackId: null, contentPackId: null, packCode: '', packId: null, actionType: 'content', notes: '', active: true },

            // Series
            seriesList: [],
            seriesLoading: false,
            seriesCurrentPage: 1,
            seriesPageSize: 10,
            seriesTotal: 0,
            isAllSeriesSelected: false,
            seriesDialogVisible: false,
            seriesDialogTitle: 'Add Bulk Range',
            seriesForm: { id: null, startUid: '', endUid: '', questionId: null, packId: null, priority: 0, notes: '', active: true },

            // Content Packs
            contentPacksList: [],
            contentPacksLoading: false,
            contentPacksCurrentPage: 1,
            contentPacksPageSize: 10,
            contentPacksTotal: 0,
            isAllContentPacksSelected: false,
            contentPackDialogVisible: false,
            contentPackDialogTitle: 'Add Content Pack',
            contentPackForm: { id: null, packCode: '', name: '', description: '', contentType: 'story_pack', language: 'en', status: 'draft', version: 1, items: [], active: true },

            // Question Packs (NEW)
            questionPacksList: [],
            questionPacksLoading: false,
            questionPacksCurrentPage: 1,
            questionPacksPageSize: 10,
            questionPacksTotal: 0,
            isAllQuestionPacksSelected: false,
            questionPackDialogVisible: false,
            questionPackDialogTitle: 'Add Q&A Pack',
            questionPackForm: { id: null, packCode: '', name: '', description: '', questionIds: [], language: 'en', category: '', status: 'draft', version: 1, active: true },

            // Dropdown data
            questionsDropdown: [],
            packsDropdown: [],
            contentPacksDropdown: [],
            questionPacksDropdown: [],

            // Console
            consoleLookupUid: '',
            consoleLookupLoading: false,
            consoleSeriesLoading: false,
            consoleContentLoading: false,
            consoleDownloadLoading: false,
            consoleSequence: 1,
            consoleLookupResult: null,

            // Stats
            stats: {
                totalPrompts: 0,
                totalContentPacks: 0,
                totalProductSkus: 0,
                totalCards: 0,
                totalSeries: 0,
                totalQuestionPacks: 0
            },
            statsLoading: false
        };
    },
    created() {

        this.fetchQuestionPacks();
        this.loadDropdownData();
        this.loadStats();
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
        // Series pagination
        seriesPageCount() {
            return Math.ceil(this.seriesTotal / this.seriesPageSize);
        },
        seriesVisiblePages() {
            return this.getVisiblePages(this.seriesCurrentPage, this.seriesPageCount);
        },
        // Question Packs pagination (NEW)
        questionPacksPageCount() {
            return Math.ceil(this.questionPacksTotal / this.questionPacksPageSize);
        },
        questionPacksVisiblePages() {
            return this.getVisiblePages(this.questionPacksCurrentPage, this.questionPacksPageCount);
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
            else if (tab === 'contentPacks') this.fetchContentPacks();
            else if (tab === 'series') this.fetchSeries();
            else if (tab === 'questionPacks') this.fetchQuestionPacks();
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
            } else if (this.activeTab === 'questionPacks') {
                this.questionPacksCurrentPage = 1;
                this.fetchQuestionPacks();
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
            Api.rfid.getContentPackList(({ data }) => {
                if (data.code === 0) {
                    this.contentPacksDropdown = data.data || [];
                }
            });
        },

        loadStats() {
            this.statsLoading = true;
            let completed = 0;
            const checkDone = () => {
                completed++;
                if (completed >= 5) this.statsLoading = false;
            };
            Api.rfid.getQuestionPackPage({ page: 1, limit: 1 }, ({ data }) => {
                if (data.code === 0) this.stats.totalQuestionPacks = data.data.total || 0;
                checkDone();
            });
            Api.rfid.getContentPackPage({ page: 1, limit: 1 }, ({ data }) => {
                if (data.code === 0) this.stats.totalContentPacks = data.data.total || 0;
                checkDone();
            });
            Api.rfid.getPackPage({ page: 1, limit: 1 }, ({ data }) => {
                if (data.code === 0) this.stats.totalProductSkus = data.data.total || 0;
                checkDone();
            });
            Api.rfid.getCardPage({ page: 1, limit: 1 }, ({ data }) => {
                if (data.code === 0) this.stats.totalCards = data.data.total || 0;
                checkDone();
            });
            Api.rfid.getSeriesPage({ page: 1, limit: 1 }, ({ data }) => {
                if (data.code === 0) this.stats.totalSeries = data.data.total || 0;
                checkDone();
            });
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
                    this.loadDropdownData();
                    this.loadStats();
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
                        this.loadStats();
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
                    this.loadDropdownData();
                    this.loadStats();
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
                        this.loadStats();
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
            this.cardForm = { id: null, rfidUid: '', questionPackId: null, packCode: '', packId: null, contentPackId: null, notes: '', active: true };
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
                    this.loadStats();
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
                        this.loadStats();
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

        // ==================== CONTENT PACKS ====================
        fetchContentPacks() {
            this.contentPacksLoading = true;
            Api.rfid.getContentPackPage({
                page: this.contentPacksCurrentPage,
                limit: this.contentPacksPageSize,
                packCode: this.searchKeyword
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
            this.contentPackForm = { id: null, packCode: '', name: '', description: '', contentType: 'prompt', language: 'en', contentMd: '', totalItems: 0, items: [], active: true };
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
                    this.loadDropdownData();
                    this.loadStats();
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
                        this.loadDropdownData();
                        this.loadStats();
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
            this.seriesForm = { id: null, startUid: '', endUid: '', questionId: null, packId: null, priority: 0, notes: '', active: true };
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
                    this.loadStats();
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
                        this.loadStats();
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

        // ==================== QUESTION PACKS (NEW) ====================
        fetchQuestionPacks() {
            this.questionPacksLoading = true;
            Api.rfid.getQuestionPackPage({
                page: this.questionPacksCurrentPage,
                limit: this.questionPacksPageSize,
                name: this.searchKeyword
            }, ({ data }) => {
                this.questionPacksLoading = false;
                if (data.code === 0) {
                    this.questionPacksList = data.data.list.map(p => ({ ...p, selected: false }));
                    this.questionPacksTotal = data.data.total;
                }
            });
        },

        handleQuestionPacksPageSizeChange(val) {
            this.questionPacksPageSize = val;
            this.fetchQuestionPacks();
        },

        goFirstQuestionPacks() {
            this.questionPacksCurrentPage = 1;
            this.fetchQuestionPacks();
        },

        goPrevQuestionPacks() {
            if (this.questionPacksCurrentPage > 1) {
                this.questionPacksCurrentPage--;
                this.fetchQuestionPacks();
            }
        },

        goToQuestionPacksPage(page) {
            this.questionPacksCurrentPage = page;
            this.fetchQuestionPacks();
        },

        goNextQuestionPacks() {
            if (this.questionPacksCurrentPage < Math.ceil(this.questionPacksTotal / this.questionPacksPageSize)) {
                this.questionPacksCurrentPage++;
                this.fetchQuestionPacks();
            }
        },

        handleSelectAllQuestionPacks(val) {
            this.isAllQuestionPacksSelected = val;
            this.questionPacksList.forEach(item => item.selected = val);
        },

        showAddQuestionPackDialog() {
            this.questionPackDialogTitle = 'Add Q&A Pack';
            this.questionPackForm = { id: null, packCode: '', name: '', description: '', questionIds: [], questions: [], language: 'en', category: '', status: 'draft', version: 1, active: true };
            this.questionPackDialogVisible = true;
        },

        editQuestionPack(row) {
            this.questionPackDialogTitle = 'Edit Q&A Pack';
            // Ensure questionIds is array
            const form = { ...row };
            if (!form.questionIds) form.questionIds = [];
            this.questionPackForm = form;
            this.questionPackDialogVisible = true;
        },

        handleQuestionPackSubmit({ form, done }) {
            const api = form.id ? Api.rfid.updateQuestionPack : Api.rfid.addQuestionPack;
            api(form, ({ data }) => {
                done && done();
                if (data.code === 0) {
                    this.$message.success(form.id ? 'Updated successfully' : 'Created successfully');
                    this.questionPackDialogVisible = false;
                    this.fetchQuestionPacks();
                    this.loadStats();
                    this.loadDropdownData();
                } else {
                    this.$message.error(data.msg || 'Operation failed');
                }
            });
        },

        deleteQuestionPack(row) {
            const items = Array.isArray(row) ? row : [row];
            if (items.length === 0) return;
            this.$confirm(`Delete ${items.length} question packs?`, 'Warning', {
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                type: 'warning'
            }).then(() => {
                Api.rfid.deleteQuestionPack(items.map(i => i.id), ({ data }) => {
                    if (data.code === 0) {
                        this.$message.success('Deleted successfully');
                        this.fetchQuestionPacks();
                        this.loadStats();
                        this.loadDropdownData();
                    } else {
                        this.$message.error(data.msg || 'Delete failed');
                    }
                });
            }).catch(() => {});
        },

        deleteSelectedQuestionPacks() {
            const selected = this.questionPacksList.filter(r => r.selected);
            if (selected.length === 0) {
                this.$message.warning('Please select items to delete');
                return;
            }
            this.deleteQuestionPack(selected);
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
        },

        handleContentLookup() {
            if (!this.consoleLookupUid.trim()) {
                this.$message.warning('Please enter an RFID UID');
                return;
            }
            this.consoleContentLoading = true;
            this.consoleLookupResult = null;

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
/* Stats Bar */
.stats-bar {
    display: flex;
    gap: 16px;
    padding: 0 24px 8px;
    min-height: 64px;
}

.stat-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
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

    &.prompts { background: #eff6ff; color: #3b82f6; }
    &.content { background: #fff7ed; color: #f97316; }
    &.skus { background: #f0fdf4; color: #22c55e; }
    &.cards { background: #faf5ff; color: #a855f7; }
    &.series { background: #fef2f2; color: #ef4444; }
}

.stat-content {
    .stat-value {
        font-size: 20px;
        font-weight: 700;
        color: #1e293b;
        line-height: 1.2;
    }

    .stat-label {
        font-size: 11px;
        color: #94a3b8;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}

/* Section Headers */
.section-header {
    padding: 12px 16px 8px;
    border-bottom: 1px solid #f1f5f9;
    margin-bottom: 4px;
}

.section-info {
    .section-title {
        margin: 0 0 4px;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        display: flex;
        align-items: center;
        gap: 8px;

        i {
            color: #5f70f3;
        }
    }

    .section-count {
        font-weight: 500;
        font-size: 11px;
    }

    .section-description {
        margin: 0;
        font-size: 13px;
        color: #64748b;
        line-height: 1.5;
    }

    .section-help {
        color: #94a3b8;
        cursor: help;
        margin-left: 4px;

        &:hover {
            color: #5f70f3;
        }
    }
}

/* Card table helpers */
.uid-mono {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    color: #334155;
    letter-spacing: 0.5px;
}

.text-muted {
    color: #cbd5e1;
}

.content-badge {
    i {
        margin-right: 3px;
    }
}

/* Console Tab Styles */
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
        color: #64748b;
        font-weight: 500;

        i {
            font-size: 12px;
            color: #94a3b8;
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
        color: #64748b;

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

/* Q&A Packs Grid */
.pack-grid-container {
    padding: 10px 0;
    min-height: 200px;
}
.pack-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
    padding-bottom: 20px;
}
.pack-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.03);
    border: 1px solid #f0f0f0;
    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    cursor: pointer;
    height: 100%;
}
.pack-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.06);
    border-color: #d9ecff;
}
.pack-card.selected {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
}
.pack-card-selection {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 10;
}
.pack-card-header {
    background: linear-gradient(135deg, #ffffff 0%, #fcfcfc 100%);
    padding: 16px;
    border-bottom: 1px solid #f5f7fa;
}
.pack-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    gap: 10px;
}
.pack-title {
    font-weight: 600;
    font-size: 15px;
    color: #1a1a1a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.pack-code {
    font-size: 11px;
    color: #909399;
    font-family: 'Roboto Mono', monospace;
    background: #f4f4f5;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
}
.pack-card-body {
    padding: 16px;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
}
.pack-desc {
    font-size: 13px;
    color: #606266;
    margin-bottom: 16px;
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    flex-grow: 1;
}
.pack-metrics {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
.pack-card-footer {
    padding: 12px 16px;
    border-top: 1px solid #f5f7fa;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fafafa;
}
.pack-version {
    font-size: 11px;
    color: #909399;
    font-weight: 500;
}
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
    background: #fdfdfd;
    border-radius: 12px;
    border: 2px dashed #e4e7ed;
    text-align: center;
}
/* Stat Icons */
.stat-icon.qa-packs {
    color: #9b59b6;
    background: rgba(155, 89, 182, 0.1);
}
</style>
