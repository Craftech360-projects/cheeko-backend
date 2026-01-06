<template>
  <div class="global-search-wrapper" v-click-outside="closeDropdown">
    <el-input
      v-model="searchQuery"
      placeholder="Search everything..."
      class="global-search-input"
      @input="handleSearchInput"
      @focus="handleFocus"
      @keydown.native.enter="handleEnterKey"
      @keydown.native.up.prevent="navigateUp"
      @keydown.native.down.prevent="navigateDown"
      @keydown.native.esc="closeDropdown"
      clearable
      @clear="handleClear"
    >
      <i slot="prefix" class="el-icon-search"></i>
    </el-input>

    <transition name="dropdown-fade">
      <div v-if="showDropdown && searchQuery.length >= 2" class="search-dropdown">
        <!-- Loading State -->
        <div v-if="isLoading" class="loading-state">
          <i class="el-icon-loading"></i>
          <span>Searching...</span>
        </div>

        <!-- Results -->
        <div v-else-if="hasResults" class="results-container">
          <!-- Agents -->
          <div v-if="results.agents.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-user"></i>
              <span>Agents</span>
              <span class="category-count">{{ results.agents.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.agents.slice(0, 5)"
              :key="'agent-' + item.agentId"
              class="result-item"
              :class="{ highlighted: isHighlighted('agents', idx) }"
              @click="navigateToResult('agent', item)"
              @mouseenter="setHighlight('agents', idx)"
            >
              <span class="result-name">{{ item.agentName }}</span>
              <span class="result-meta">{{ item.ownerUsername || 'Your agent' }}</span>
            </div>
          </div>

          <!-- Devices (Admin only) -->
          <div v-if="isSuperAdmin && results.devices.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-monitor"></i>
              <span>Devices</span>
              <span class="category-count">{{ results.devices.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.devices.slice(0, 5)"
              :key="'device-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('devices', idx) }"
              @click="navigateToResult('device', item)"
              @mouseenter="setHighlight('devices', idx)"
            >
              <span class="result-name">{{ formatMac(item.macAddress) }}</span>
              <span class="result-meta">{{ item.bindUserName || 'Unbound' }}</span>
            </div>
          </div>

          <!-- Users (Admin only) -->
          <div v-if="isSuperAdmin && results.users.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-user-solid"></i>
              <span>Users</span>
              <span class="category-count">{{ results.users.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.users.slice(0, 5)"
              :key="'user-' + item.userid"
              class="result-item"
              :class="{ highlighted: isHighlighted('users', idx) }"
              @click="navigateToResult('user', item)"
              @mouseenter="setHighlight('users', idx)"
            >
              <span class="result-name">{{ item.username || item.mobile }}</span>
              <span class="result-meta">{{ item.mobile }}</span>
            </div>
          </div>

          <!-- Models (Admin only) -->
          <div v-if="isSuperAdmin && results.models.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-cpu"></i>
              <span>Models</span>
              <span class="category-count">{{ results.models.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.models.slice(0, 5)"
              :key="'model-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('models', idx) }"
              @click="navigateToResult('model', item)"
              @mouseenter="setHighlight('models', idx)"
            >
              <span class="result-name">{{ item.modelName }}</span>
              <span class="result-meta">{{ item.modelType }}</span>
            </div>
          </div>

          <!-- RFID Questions (Admin only) -->
          <div v-if="isSuperAdmin && results.rfidQuestions.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-question"></i>
              <span>RFID Questions</span>
              <span class="category-count">{{ results.rfidQuestions.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.rfidQuestions.slice(0, 5)"
              :key="'rfidq-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('rfidQuestions', idx) }"
              @click="navigateToResult('rfidQuestion', item)"
              @mouseenter="setHighlight('rfidQuestions', idx)"
            >
              <span class="result-name">{{ item.code }}</span>
              <span class="result-meta">{{ item.category }}</span>
            </div>
          </div>

          <!-- RFID Packs (Admin only) -->
          <div v-if="isSuperAdmin && results.rfidPacks.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-box"></i>
              <span>RFID Packs</span>
              <span class="category-count">{{ results.rfidPacks.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.rfidPacks.slice(0, 5)"
              :key="'rfidp-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('rfidPacks', idx) }"
              @click="navigateToResult('rfidPack', item)"
              @mouseenter="setHighlight('rfidPacks', idx)"
            >
              <span class="result-name">{{ item.name }}</span>
              <span class="result-meta">{{ item.packCode }}</span>
            </div>
          </div>

          <!-- RFID Cards (Admin only) -->
          <div v-if="isSuperAdmin && results.rfidCards.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-bank-card"></i>
              <span>RFID Cards</span>
              <span class="category-count">{{ results.rfidCards.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.rfidCards.slice(0, 5)"
              :key="'rfidc-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('rfidCards', idx) }"
              @click="navigateToResult('rfidCard', item)"
              @mouseenter="setHighlight('rfidCards', idx)"
            >
              <span class="result-name">{{ item.rfidUid }}</span>
              <span class="result-meta">{{ item.packCode }}</span>
            </div>
          </div>

          <!-- Dict Types (Admin only) -->
          <div v-if="isSuperAdmin && results.dictTypes.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-notebook-2"></i>
              <span>Dictionaries</span>
              <span class="category-count">{{ results.dictTypes.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.dictTypes.slice(0, 5)"
              :key="'dict-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('dictTypes', idx) }"
              @click="navigateToResult('dictType', item)"
              @mouseenter="setHighlight('dictTypes', idx)"
            >
              <span class="result-name">{{ item.dictName }}</span>
              <span class="result-meta">{{ item.dictType }}</span>
            </div>
          </div>

          <!-- Parameters (Admin only) -->
          <div v-if="isSuperAdmin && results.params.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-setting"></i>
              <span>Parameters</span>
              <span class="category-count">{{ results.params.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.params.slice(0, 5)"
              :key="'param-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('params', idx) }"
              @click="navigateToResult('param', item)"
              @mouseenter="setHighlight('params', idx)"
            >
              <span class="result-name">{{ item.paramCode }}</span>
              <span class="result-meta">{{ item.paramValue ? item.paramValue.substring(0, 30) + '...' : '' }}</span>
            </div>
          </div>

          <!-- OTA (Admin only) -->
          <div v-if="isSuperAdmin && results.ota.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-upload2"></i>
              <span>OTA Firmware</span>
              <span class="category-count">{{ results.ota.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.ota.slice(0, 5)"
              :key="'ota-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('ota', idx) }"
              @click="navigateToResult('ota', item)"
              @mouseenter="setHighlight('ota', idx)"
            >
              <span class="result-name">{{ item.version }}</span>
              <span class="result-meta">{{ item.releaseNotes ? item.releaseNotes.substring(0, 30) + '...' : '' }}</span>
            </div>
          </div>

          <!-- Providers (Admin only) -->
          <div v-if="isSuperAdmin && results.providers.length" class="result-category">
            <div class="category-header">
              <i class="el-icon-connection"></i>
              <span>Providers</span>
              <span class="category-count">{{ results.providers.length }}</span>
            </div>
            <div
              v-for="(item, idx) in results.providers.slice(0, 5)"
              :key="'provider-' + item.id"
              class="result-item"
              :class="{ highlighted: isHighlighted('providers', idx) }"
              @click="navigateToResult('provider', item)"
              @mouseenter="setHighlight('providers', idx)"
            >
              <span class="result-name">{{ item.name }}</span>
              <span class="result-meta">{{ item.modelType }}</span>
            </div>
          </div>
        </div>

        <!-- No Results -->
        <div v-else class="no-results">
          <i class="el-icon-search"></i>
          <span>No results found for "{{ searchQuery }}"</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import { mapGetters } from 'vuex'
import Api from '@/apis/api'

export default {
  name: 'GlobalSearchDropdown',
  directives: {
    'click-outside': {
      bind(el, binding) {
        el._clickOutside = (event) => {
          if (!(el === event.target || el.contains(event.target))) {
            binding.value(event)
          }
        }
        document.addEventListener('click', el._clickOutside)
      },
      unbind(el) {
        document.removeEventListener('click', el._clickOutside)
      }
    }
  },
  data() {
    return {
      searchQuery: '',
      showDropdown: false,
      isLoading: false,
      debounceTimer: null,
      highlightedCategory: null,
      highlightedIndex: -1,
      results: {
        agents: [],
        devices: [],
        users: [],
        models: [],
        rfidQuestions: [],
        rfidPacks: [],
        rfidCards: [],
        dictTypes: [],
        params: [],
        ota: [],
        providers: []
      }
    }
  },
  computed: {
    ...mapGetters(['getIsSuperAdmin']),
    isSuperAdmin() {
      return this.getIsSuperAdmin
    },
    hasResults() {
      return Object.values(this.results).some(arr => arr.length > 0)
    },
    // Get all visible categories with their items for keyboard navigation
    visibleCategories() {
      const categories = []
      if (this.results.agents.length) {
        categories.push({ key: 'agents', items: this.results.agents.slice(0, 5) })
      }
      if (this.isSuperAdmin) {
        if (this.results.devices.length) {
          categories.push({ key: 'devices', items: this.results.devices.slice(0, 5) })
        }
        if (this.results.users.length) {
          categories.push({ key: 'users', items: this.results.users.slice(0, 5) })
        }
        if (this.results.models.length) {
          categories.push({ key: 'models', items: this.results.models.slice(0, 5) })
        }
        if (this.results.rfidQuestions.length) {
          categories.push({ key: 'rfidQuestions', items: this.results.rfidQuestions.slice(0, 5) })
        }
        if (this.results.rfidPacks.length) {
          categories.push({ key: 'rfidPacks', items: this.results.rfidPacks.slice(0, 5) })
        }
        if (this.results.rfidCards.length) {
          categories.push({ key: 'rfidCards', items: this.results.rfidCards.slice(0, 5) })
        }
        if (this.results.dictTypes.length) {
          categories.push({ key: 'dictTypes', items: this.results.dictTypes.slice(0, 5) })
        }
        if (this.results.params.length) {
          categories.push({ key: 'params', items: this.results.params.slice(0, 5) })
        }
        if (this.results.ota.length) {
          categories.push({ key: 'ota', items: this.results.ota.slice(0, 5) })
        }
        if (this.results.providers.length) {
          categories.push({ key: 'providers', items: this.results.providers.slice(0, 5) })
        }
      }
      return categories
    }
  },
  methods: {
    handleFocus() {
      if (this.searchQuery.length >= 2) {
        this.showDropdown = true
      }
    },
    handleSearchInput() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      if (this.searchQuery.length >= 2) {
        this.showDropdown = true
        this.isLoading = true
        this.debounceTimer = setTimeout(() => {
          this.performSearch()
        }, 300)
      } else {
        this.clearResults()
        this.showDropdown = false
      }
    },
    handleClear() {
      this.clearResults()
      this.closeDropdown()
    },
    async performSearch() {
      const query = this.searchQuery.trim()
      if (!query) {
        this.isLoading = false
        return
      }

      const searchRegex = new RegExp(query, 'i')
      const promises = []

      // Reset results
      this.clearResults()

      // Agents - available to all users
      promises.push(
        new Promise((resolve) => {
          Api.agent.getUserAgentList((res) => {
            if (res.data?.code === 0) {
              const list = res.data.data || []
              this.results.agents = list.filter(a =>
                searchRegex.test(a.agentName) ||
                searchRegex.test(a.systemPrompt || '')
              ).slice(0, 10)
            }
            resolve()
          })
        })
      )

      // Admin-only searches
      if (this.isSuperAdmin) {
        // Devices (search by MAC address, keywords)
        promises.push(
          new Promise((resolve) => {
            Api.admin.getAllDevices({ page: 1, limit: 100, keywords: query }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.devices = list.slice(0, 10)
              }
              resolve()
            })
          })
        )

        // Users
        promises.push(
          new Promise((resolve) => {
            Api.admin.getUserList({ page: 1, limit: 100, mobile: '' }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.users = list.filter(u =>
                  searchRegex.test(u.username || '') ||
                  searchRegex.test(u.mobile || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // Models
        promises.push(
          new Promise((resolve) => {
            Api.model.getModelList({ modelType: '', modelName: '', page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.models = list.filter(m =>
                  searchRegex.test(m.modelName || '') ||
                  searchRegex.test(m.modelCode || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // RFID Questions
        promises.push(
          new Promise((resolve) => {
            Api.rfid.getQuestionPage({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.rfidQuestions = list.filter(q =>
                  searchRegex.test(q.code || '') ||
                  searchRegex.test(q.category || '') ||
                  searchRegex.test(q.title || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // RFID Packs
        promises.push(
          new Promise((resolve) => {
            Api.rfid.getPackPage({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.rfidPacks = list.filter(p =>
                  searchRegex.test(p.name || '') ||
                  searchRegex.test(p.packCode || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // RFID Cards
        promises.push(
          new Promise((resolve) => {
            Api.rfid.getCardPage({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.rfidCards = list.filter(c =>
                  searchRegex.test(c.rfidUid || '') ||
                  searchRegex.test(c.packCode || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // Dict Types
        promises.push(
          new Promise((resolve) => {
            Api.dict.getDictTypeList({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.dictTypes = list.filter(d =>
                  searchRegex.test(d.dictName || '') ||
                  searchRegex.test(d.dictType || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // Parameters
        promises.push(
          new Promise((resolve) => {
            Api.admin.getParamsList({ page: 1, limit: 100, paramCode: '' }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.params = list.filter(p =>
                  searchRegex.test(p.paramCode || '') ||
                  searchRegex.test(p.paramValue || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // OTA
        promises.push(
          new Promise((resolve) => {
            Api.ota.getOtaList({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.ota = list.filter(o =>
                  searchRegex.test(o.version || '') ||
                  searchRegex.test(o.releaseNotes || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )

        // Providers
        promises.push(
          new Promise((resolve) => {
            Api.model.getModelProvidersPage({ page: 1, limit: 100 }, (res) => {
              if (res.data?.code === 0) {
                const list = res.data.data?.list || []
                this.results.providers = list.filter(p =>
                  searchRegex.test(p.name || '') ||
                  searchRegex.test(p.providerCode || '')
                ).slice(0, 10)
              }
              resolve()
            })
          })
        )
      }

      try {
        await Promise.all(promises)
      } catch (error) {
        console.error('Search failed:', error)
      } finally {
        this.isLoading = false
      }
    },
    formatMac(mac) {
      if (!mac) return 'Unknown'
      const cleaned = mac.replace(/[:-]/g, '').toUpperCase()
      return cleaned.match(/.{1,2}/g)?.join(':') || mac
    },
    navigateToResult(type, item) {
      this.closeDropdown()
      this.searchQuery = ''

      const routes = {
        agent: { path: '/role-config', query: { agentId: item.agentId || item.id } },
        device: { path: '/device-management', query: { agentId: item.agentId, deviceId: item.id } },
        user: { path: '/user-management', query: { userId: item.userid } },
        model: { path: '/model-config', query: { modelId: item.id, modelType: item.modelType } },
        rfidQuestion: { path: '/rfid-management', query: { tab: 'questions', id: item.id } },
        rfidPack: { path: '/rfid-management', query: { tab: 'packs', id: item.id } },
        rfidCard: { path: '/rfid-management', query: { tab: 'cards', id: item.id } },
        dictType: { path: '/dict-management', query: { typeId: item.id } },
        param: { path: '/params-management', query: { paramId: item.id } },
        ota: { path: '/ota-management', query: { otaId: item.id } },
        provider: { path: '/provider-management', query: { providerId: item.id } }
      }

      const route = routes[type]
      if (route) {
        this.$router.push(route).catch(() => {})
      }
    },
    closeDropdown() {
      this.showDropdown = false
      this.highlightedCategory = null
      this.highlightedIndex = -1
    },
    clearResults() {
      Object.keys(this.results).forEach(key => {
        this.results[key] = []
      })
    },
    isHighlighted(category, index) {
      return this.highlightedCategory === category && this.highlightedIndex === index
    },
    setHighlight(category, index) {
      this.highlightedCategory = category
      this.highlightedIndex = index
    },
    navigateUp() {
      if (!this.visibleCategories.length) return

      if (this.highlightedCategory === null) {
        // Start from last item
        const lastCat = this.visibleCategories[this.visibleCategories.length - 1]
        this.highlightedCategory = lastCat.key
        this.highlightedIndex = lastCat.items.length - 1
      } else {
        // Find current position
        const catIdx = this.visibleCategories.findIndex(c => c.key === this.highlightedCategory)
        if (this.highlightedIndex > 0) {
          this.highlightedIndex--
        } else if (catIdx > 0) {
          const prevCat = this.visibleCategories[catIdx - 1]
          this.highlightedCategory = prevCat.key
          this.highlightedIndex = prevCat.items.length - 1
        }
      }
    },
    navigateDown() {
      if (!this.visibleCategories.length) return

      if (this.highlightedCategory === null) {
        // Start from first item
        this.highlightedCategory = this.visibleCategories[0].key
        this.highlightedIndex = 0
      } else {
        // Find current position
        const catIdx = this.visibleCategories.findIndex(c => c.key === this.highlightedCategory)
        const currentCat = this.visibleCategories[catIdx]
        if (this.highlightedIndex < currentCat.items.length - 1) {
          this.highlightedIndex++
        } else if (catIdx < this.visibleCategories.length - 1) {
          const nextCat = this.visibleCategories[catIdx + 1]
          this.highlightedCategory = nextCat.key
          this.highlightedIndex = 0
        }
      }
    },
    handleEnterKey() {
      if (this.highlightedCategory && this.highlightedIndex >= 0) {
        const cat = this.visibleCategories.find(c => c.key === this.highlightedCategory)
        if (cat && cat.items[this.highlightedIndex]) {
          const typeMap = {
            agents: 'agent',
            devices: 'device',
            users: 'user',
            models: 'model',
            rfidQuestions: 'rfidQuestion',
            rfidPacks: 'rfidPack',
            rfidCards: 'rfidCard',
            dictTypes: 'dictType',
            params: 'param',
            ota: 'ota',
            providers: 'provider'
          }
          this.navigateToResult(typeMap[this.highlightedCategory], cat.items[this.highlightedIndex])
        }
      }
    }
  },
  beforeDestroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.global-search-wrapper {
  position: relative;
  min-width: 200px;
  max-width: 280px;
  flex-grow: 1;
}

.global-search-input {
  width: 100%;
}

.global-search-input ::v-deep .el-input__inner {
  height: 32px;
  border-radius: 16px;
  background-color: #fff;
  border: 1px solid #e4e6ef;
  padding-left: 35px;
  font-size: 13px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
}

.global-search-input ::v-deep .el-input__inner:focus {
  border-color: $primary;
  box-shadow: 0 2px 8px rgba($primary, 0.15);
}

.global-search-input ::v-deep .el-input__prefix {
  left: 12px;
  color: #909399;
}

.search-dropdown {
  position: fixed;
  top: 55px;
  right: 80px;
  min-width: 350px;
  max-width: 420px;
  max-height: 450px;
  overflow-y: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  border: 1px solid #ebeef5;
  z-index: 9999;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: #909399;
  font-size: 14px;
}

.loading-state i {
  font-size: 18px;
  color: $primary;
}

.results-container {
  padding: 8px 0;
}

.result-category {
  margin-bottom: 4px;
}

.result-category:last-child {
  margin-bottom: 0;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  background: #f5f7fa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.category-header i {
  font-size: 14px;
  color: $primary;
}

.category-count {
  margin-left: auto;
  background: rgba($primary, 0.1);
  color: $primary;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.result-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.result-item:hover,
.result-item.highlighted {
  background: rgba($primary, 0.08);
}

.result-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: 12px;
  color: #909399;
  margin-left: 12px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: #909399;
  font-size: 14px;
}

.no-results i {
  font-size: 32px;
  opacity: 0.5;
}

/* Dropdown fade animation */
.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.dropdown-fade-enter,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Custom scrollbar */
.search-dropdown::-webkit-scrollbar {
  width: 6px;
}

.search-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.search-dropdown::-webkit-scrollbar-thumb {
  background: #dcdfe6;
  border-radius: 3px;
}

.search-dropdown::-webkit-scrollbar-thumb:hover {
  background: #c0c4cc;
}
</style>
