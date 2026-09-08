<template>
  <div class="global-search-wrapper" v-click-outside="closeDropdown">
    <el-input
      v-model="query"
      placeholder="Search pages, agents, devices…"
      class="global-search-input"
      clearable
      @input="onInput"
      @focus="onFocus"
      @keydown.native.enter="openActive"
      @keydown.native.up.prevent="move(-1)"
      @keydown.native.down.prevent="move(1)"
      @keydown.native.esc="closeDropdown"
      @clear="reset"
    >
      <i slot="prefix" class="el-icon-search"></i>
    </el-input>

    <transition name="dropdown-fade">
      <div v-if="isOpen" class="gs-panel">
        <div v-if="isLoading && !rows.length" class="gs-state">
          <i class="el-icon-loading"></i><span>Searching…</span>
        </div>

        <template v-else-if="rows.length">
          <div class="gs-scroll">
            <div v-for="group in groups" :key="group.key" class="gs-group">
              <div class="gs-group-head">
                <i :class="group.icon"></i>
                <span>{{ group.label }}</span>
                <em v-if="group.more">+{{ group.more }}</em>
              </div>
              <div
                v-for="row in group.rows"
                :key="row.uid"
                class="gs-row"
                :class="{ on: row.index === activeIndex }"
                :ref="'row' + row.index"
                @click="open(row)"
                @mouseenter="activeIndex = row.index"
              >
                <span class="gs-name" v-html="mark(row.name)"></span>
                <span v-if="row.meta" class="gs-meta">{{ row.meta }}</span>
              </div>
            </div>
          </div>
          <div class="gs-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </template>

        <div v-else class="gs-state gs-empty">
          <i class="el-icon-search"></i>
          <span>No matches for “{{ query }}”</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import { mapGetters } from 'vuex'
import Api from '@/apis/api'

// Every screen the search can jump to. Drill-downs that need context
// (role-config, device-management, voice-print, a single family) are left out:
// landing on them without an id shows an empty page.
const PAGES = [
  { label: 'Overview', path: '/overview', admin: true, keywords: 'dashboard home summary stats' },
  { label: 'Agents', path: '/home', keywords: 'characters roles assistants' },
  { label: 'Templates', path: '/template-management', admin: true, keywords: 'agent template preset prompt' },
  { label: 'Family 360', path: '/families', admin: true, keywords: 'families parents households' },
  { label: 'Users', path: '/user-management', admin: true, keywords: 'accounts members people parents' },
  { label: 'Kid Profiles', path: '/kid-profiles', admin: true, keywords: 'children kids grade profile' },
  { label: 'Engagement', path: '/engagement', admin: true, keywords: 'usage retention activity' },
  { label: 'Game Analytics', path: '/game-analytics', admin: true, keywords: 'games math riddle word ladder scores' },
  { label: 'Active Devices', path: '/active-devices', admin: true, keywords: 'online live sessions toys' },
  { label: 'Conversations', path: '/conversations', admin: true, keywords: 'chat history transcript messages' },
  { label: 'Quiz Progress', path: '/quiz-progress', keywords: 'quiz learning progress' },
  { label: 'RFID · Content Packs', path: '/rfid-management/contentPacks', admin: true, keywords: 'rfid content pack audio story music' },
  { label: 'RFID · Question Packs', path: '/rfid-management/packs', admin: true, keywords: 'rfid question pack' },
  { label: 'RFID · Cards', path: '/rfid-management/cards', admin: true, keywords: 'rfid card uid tag' },
  { label: 'RFID · Series', path: '/rfid-management/series', admin: true, keywords: 'rfid series collection' },
  { label: 'RFID · AI Cards', path: '/rfid-management/aiCards', admin: true, keywords: 'rfid ai card' },
  { label: 'RFID · Custom Cards', path: '/rfid-management/customCards', admin: true, keywords: 'rfid custom card upload' },
  { label: 'RFID · Questions', path: '/rfid-management/questions', admin: true, keywords: 'rfid question quiz' },
  { label: 'RFID · Card Analytics', path: '/rfid-management/cardAnalytics', admin: true, keywords: 'rfid taps analytics' },
  { label: 'AI Cost', path: '/costs', admin: true, keywords: 'spend billing cost llm tts' },
  { label: 'Raw Tokens', path: '/token-analytics', admin: true, keywords: 'tokens usage llm' },
  { label: 'Fleet & Ops', path: '/operate', admin: true, keywords: 'operations fleet health' },
  { label: 'Devices', path: '/all-devices', admin: true, keywords: 'esp32 toys mac hardware firmware' },
  { label: 'OTA Firmware', path: '/ota-management', admin: true, keywords: 'firmware update version release' },
  { label: 'Runtime Providers', path: '/runtime-providers', admin: true, keywords: 'llm tts stt provider livekit' },
  { label: 'Email Reports', path: '/email-reports', admin: true, keywords: 'email report schedule digest' },
  { label: 'Dictionaries', path: '/dict-management', admin: true, keywords: 'dict dictionary type data' },
  { label: 'Parameters', path: '/params-management', admin: true, keywords: 'params settings config system' },
  { label: 'Server Side', path: '/server-side-management', admin: true, keywords: 'server websocket mcp restart' }
]

const formatMac = (mac) => {
  if (!mac) return 'Unknown'
  const cleaned = String(mac).replace(/[:-]/g, '').toUpperCase()
  return cleaned.match(/.{1,2}/g)?.join(':') || mac
}

// List pages read ?q= through the deepLinkSearch mixin, so a result opens the
// page with its own search box already narrowed to the row that was clicked.
const listRoute = (path, term) => ({ path, query: { q: term } })

// Each source: where the rows come from, which fields the keyword hits, how a
// row reads, and where clicking it lands. `remote` sources let the backend do
// the filtering and are re-fetched per keyword; the rest are pulled once and
// filtered here.
const SOURCES = [
  {
    key: 'pages',
    label: 'Pages',
    icon: 'el-icon-menu',
    limit: 5,
    fetch: (vm, q, done) => done(PAGES.filter(p => !p.admin || vm.isSuperAdmin)),
    fields: ['label', 'keywords', 'path'],
    name: p => p.label,
    meta: p => p.path,
    route: p => ({ path: p.path })
  },
  {
    key: 'agents',
    label: 'Agents',
    icon: 'el-icon-s-custom',
    fetch: (vm, q, done) => vm.isSuperAdmin
      ? Api.agent.getAgentList({ page: 1, limit: 500 }, done)
      : Api.agent.getUserAgentList({ page: 1, limit: 200 }, done),
    fields: ['agentName', 'ownerUsername', 'systemPrompt'],
    name: a => a.agentName,
    meta: a => a.ownerUsername || '',
    route: a => ({ path: '/role-config', query: { agentId: a.agentId || a.id } })
  },
  {
    key: 'devices',
    label: 'Devices',
    icon: 'el-icon-cpu',
    admin: true,
    remote: true,
    fetch: (vm, q, done) => Api.admin.getAllDevices({ page: 1, limit: 20, keywords: q }, done),
    name: d => formatMac(d.macAddress),
    meta: d => d.alias || d.bindUserName || 'Unbound',
    route: d => listRoute('/all-devices', d.macAddress)
  },
  {
    key: 'families',
    label: 'Families',
    icon: 'el-icon-user',
    admin: true,
    remote: true,
    // One call returns kids, parents and devices already matched server-side.
    fetch: (vm, q, done) => Api.admin.searchFamilies(q, (res) => {
      const g = res?.data?.data || {}
      done([
        ...(g.kids || []).map(k => ({ ...k, kind: 'Kid' })),
        ...(g.parents || []).map(p => ({ ...p, kind: 'Parent' })),
        ...(g.devices || []).map(d => ({ ...d, kind: 'Toy' }))
      ])
    }),
    name: f => f.label,
    meta: f => f.kind,
    route: f => ({ path: `/families/${encodeURIComponent(f.id)}` })
  },
  {
    key: 'users',
    label: 'Users',
    icon: 'el-icon-user-solid',
    admin: true,
    fetch: (vm, q, done) => Api.admin.getUserList({ page: 1, limit: 500, mobile: '' }, done),
    fields: ['username', 'mobile'],
    name: u => u.username || u.mobile,
    meta: u => u.mobile || '',
    route: u => (u.mobile ? listRoute('/user-management', u.mobile) : { path: '/user-management' })
  },
  {
    key: 'templates',
    label: 'Templates',
    icon: 'el-icon-document-copy',
    admin: true,
    fetch: (vm, q, done) => Api.agent.getAgentTemplate(done, true),
    fields: ['agentName', 'systemPrompt', 'language'],
    name: t => t.agentName,
    meta: t => t.language || '',
    route: t => listRoute('/template-management', t.agentName)
  },
  {
    key: 'contentPacks',
    label: 'Content Packs',
    icon: 'el-icon-folder-opened',
    admin: true,
    fetch: (vm, q, done) => Api.rfid.getContentPackList(done),
    fields: ['name', 'packCode', 'contentType'],
    name: p => p.name || p.packCode,
    meta: p => p.packCode || '',
    route: p => listRoute('/rfid-management/contentPacks', p.packCode || p.name)
  },
  {
    key: 'rfidCards',
    label: 'RFID Cards',
    icon: 'el-icon-postcard',
    admin: true,
    fetch: (vm, q, done) => Api.rfid.getCardPage({ page: 1, limit: 500 }, done),
    fields: ['rfidUid', 'packCode', 'name'],
    name: c => c.rfidUid,
    meta: c => c.packCode || '',
    route: c => listRoute('/rfid-management/cards', c.rfidUid)
  },
  {
    key: 'rfidSeries',
    label: 'RFID Series',
    icon: 'el-icon-collection',
    admin: true,
    fetch: (vm, q, done) => Api.rfid.getSeriesList(done),
    fields: ['name', 'seriesCode', 'description'],
    name: s => s.name || s.seriesCode,
    meta: s => s.seriesCode || '',
    route: s => listRoute('/rfid-management/series', s.seriesCode || s.name)
  },
  {
    key: 'rfidPacks',
    label: 'Question Packs',
    icon: 'el-icon-box',
    admin: true,
    fetch: (vm, q, done) => Api.rfid.getPackList(done),
    fields: ['name', 'packCode'],
    name: p => p.name || p.packCode,
    meta: p => p.packCode || '',
    route: p => listRoute('/rfid-management/packs', p.packCode || p.name)
  },
  {
    key: 'rfidQuestions',
    label: 'RFID Questions',
    icon: 'el-icon-question',
    admin: true,
    fetch: (vm, q, done) => Api.rfid.getQuestionList(done),
    fields: ['code', 'category', 'title', 'question'],
    name: q2 => q2.code,
    meta: q2 => q2.category || '',
    route: q2 => listRoute('/rfid-management/questions', q2.code)
  },
  {
    key: 'dictTypes',
    label: 'Dictionaries',
    icon: 'el-icon-notebook-2',
    admin: true,
    fetch: (vm, q, done) => Api.dict.getDictTypeList({ page: 1, limit: 200 }, done),
    fields: ['dictName', 'dictType', 'remark'],
    name: d => d.dictName,
    meta: d => d.dictType || '',
    route: d => listRoute('/dict-management', d.dictName)
  },
  {
    key: 'params',
    label: 'Parameters',
    icon: 'el-icon-s-tools',
    admin: true,
    fetch: (vm, q, done) => Api.admin.getParamsList({ page: 1, limit: 500, paramCode: '' }, done),
    fields: ['paramCode', 'paramValue', 'remark'],
    name: p => p.paramCode,
    meta: p => (p.paramValue || '').slice(0, 28),
    route: p => listRoute('/params-management', p.paramCode)
  },
  {
    key: 'ota',
    label: 'OTA Firmware',
    icon: 'el-icon-upload2',
    admin: true,
    fetch: (vm, q, done) => Api.ota.getOtaList({ page: 1, limit: 200 }, done),
    fields: ['firmwareName', 'version', 'type', 'remark'],
    name: o => o.firmwareName || o.version,
    meta: o => o.version || '',
    route: o => (o.firmwareName ? listRoute('/ota-management', o.firmwareName) : { path: '/ota-management' })
  },
  {
    key: 'providers',
    label: 'Runtime Providers',
    icon: 'el-icon-connection',
    admin: true,
    // The endpoint returns one array per provider type, not a flat list.
    fetch: (vm, q, done) => Api.runtimeProviders.getProviders((res) => {
      const groups = res?.data?.data || {}
      done(Object.keys(groups).reduce(
        (acc, type) => acc.concat((groups[type] || []).map(row => ({ ...row, type }))),
        []
      ))
    }),
    fields: ['provider_name', 'model_name', 'model', 'type'],
    name: p => p.provider_name || p.model_name,
    meta: p => (p.type || '').toUpperCase(),
    route: p => listRoute('/runtime-providers', p.provider_name || p.model_name || '')
  }
]

// Every API module wraps its payload differently ({data:{data:{list}}},
// {data:{data}}, a bare array…). Walk down .data until an array turns up.
const toList = (payload) => {
  let node = payload
  for (let depth = 0; depth < 5 && node; depth++) {
    if (Array.isArray(node)) return node
    if (Array.isArray(node.list)) return node.list
    if (Array.isArray(node.records)) return node.records
    node = node.data
  }
  return []
}

const CACHE_TTL = 60000
// httpRequest retries a failed call forever and never calls back, so a source
// that is down would leave the whole search spinning.
const FETCH_TIMEOUT = 8000

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
      query: '',
      isOpen: false,
      isLoading: false,
      activeIndex: 0,
      results: SOURCES.reduce((acc, s) => { acc[s.key] = []; return acc }, {})
    }
  },
  created() {
    this.debounceTimer = null
    this.runId = 0
    this.cache = new Map()
  },
  computed: {
    ...mapGetters(['getIsSuperAdmin']),
    isSuperAdmin() {
      return this.getIsSuperAdmin
    },
    activeSources() {
      return SOURCES.filter(s => !s.admin || this.isSuperAdmin)
    },
    groups() {
      const out = []
      let index = 0
      this.activeSources.forEach(source => {
        const all = this.results[source.key]
        if (!all || !all.length) return
        const rows = all.slice(0, source.limit || 4).map(item => ({
          uid: `${source.key}-${index}`,
          index: index++,
          source,
          item,
          name: String(source.name(item) ?? ''),
          meta: source.meta ? String(source.meta(item) ?? '') : ''
        }))
        out.push({
          key: source.key,
          label: source.label,
          icon: source.icon,
          rows,
          more: all.length - rows.length
        })
      })
      return out
    },
    rows() {
      return this.groups.reduce((acc, g) => acc.concat(g.rows), [])
    }
  },
  methods: {
    onFocus() {
      if (this.query.trim().length >= 2) this.isOpen = true
    },
    onInput() {
      clearTimeout(this.debounceTimer)
      if (this.query.trim().length < 2) {
        this.isOpen = false
        this.clearResults()
        return
      }
      this.isOpen = true
      this.isLoading = true
      this.debounceTimer = setTimeout(this.search, 250)
    },
    reset() {
      this.query = ''
      this.clearResults()
      this.closeDropdown()
    },
    closeDropdown() {
      this.isOpen = false
      this.activeIndex = 0
    },
    clearResults() {
      this.isLoading = false
      SOURCES.forEach(s => { this.results[s.key] = [] })
    },
    // Pull a source's rows, honouring the cache. Remote sources cache per
    // keyword; local ones are fetched once and re-filtered in the browser.
    load(source, term) {
      const cacheKey = source.remote ? `${source.key}|${term}` : source.key
      const hit = this.cache.get(cacheKey)
      if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.list)

      return new Promise(resolve => {
        let settled = false
        const done = (payload) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const list = toList(payload)
          this.cache.set(cacheKey, { at: Date.now(), list })
          resolve(list)
        }
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          resolve([])
        }, FETCH_TIMEOUT)
        try {
          source.fetch(this, term, done)
        } catch (err) {
          console.error(`Global search: ${source.key} failed`, err)
          done(null)
        }
      })
    },
    async search() {
      const term = this.query.trim()
      if (term.length < 2) return

      const run = ++this.runId
      const needle = term.toLowerCase()

      await Promise.all(this.activeSources.map(async source => {
        const list = await this.load(source, term)
        if (run !== this.runId) return
        // Remote sources already matched server-side; rank by how early the
        // keyword lands so exact-ish rows come first.
        const matched = source.remote
          ? list
          : list
            .map(item => ({ item, rank: this.rank(source, item, needle) }))
            .filter(entry => entry.rank >= 0)
            .sort((a, b) => a.rank - b.rank)
            .map(entry => entry.item)
        this.results[source.key] = matched.slice(0, 25)
      }))

      if (run !== this.runId) return
      this.isLoading = false
      this.activeIndex = 0
    },
    rank(source, item, needle) {
      let best = -1
      for (const field of source.fields || []) {
        const value = item && item[field]
        if (!value) continue
        const at = String(value).toLowerCase().indexOf(needle)
        if (at === 0) return 0
        if (at > 0 && (best < 0 || at < best)) best = at
      }
      return best
    },
    move(step) {
      if (!this.rows.length) return
      const total = this.rows.length
      this.activeIndex = (this.activeIndex + step + total) % total
      this.$nextTick(() => {
        const el = this.$refs['row' + this.activeIndex]
        const node = Array.isArray(el) ? el[0] : el
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' })
      })
    },
    openActive() {
      const row = this.rows[this.activeIndex]
      if (row) this.open(row)
    },
    open(row) {
      this.reset()
      this.$router.push(row.source.route(row.item)).catch(() => {})
    },
    // Bold the matched slice. The value is escaped first — row names come
    // straight from the API.
    mark(text) {
      const escaped = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const needle = this.query.trim().toLowerCase()
      if (!needle) return escaped
      const at = escaped.toLowerCase().indexOf(needle)
      if (at < 0) return escaped
      return `${escaped.slice(0, at)}<b>${escaped.slice(at, at + needle.length)}</b>${escaped.slice(at + needle.length)}`
    }
  },
  beforeDestroy() {
    clearTimeout(this.debounceTimer)
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
  border-radius: $radius-sm;
  background-color: $surface;
  border: 1px solid $border-color;
  padding-left: 35px;
  font-size: 13px;
  box-shadow: none;
  transition: border-color 0.2s ease;
}

.global-search-input ::v-deep .el-input__inner:focus {
  border-color: $primary;
  box-shadow: none;
}

.global-search-input ::v-deep .el-input__prefix {
  left: 12px;
  color: $text-light;
}

/* Anchored under the input rather than pinned to the viewport, so it stays a
   small panel instead of a sheet over the page. */
.gs-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 340px;
  max-width: calc(100vw - 32px);
  background: $surface;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  box-shadow: $shadow-overlay;
  overflow: hidden;
  z-index: 2000;
}

.gs-scroll {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.gs-group + .gs-group {
  border-top: 1px solid $divider-color;
}

.gs-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: $text-light;
}

.gs-group-head i {
  font-size: 11px;
}

.gs-group-head em {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  color: $text-light;
}

.gs-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 12px;
  cursor: pointer;
  line-height: 1.3;
}

.gs-row.on {
  background: $row-selected;
}

.gs-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gs-name ::v-deep b {
  color: $primary;
  font-weight: 600;
}

.gs-meta {
  flex: 0 0 auto;
  max-width: 110px;
  font-size: 11px;
  color: $text-light;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gs-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  font-size: 13px;
  color: $text-light;
}

.gs-empty {
  flex-direction: column;
  gap: 6px;
  padding: 24px 12px;
}

.gs-empty i {
  font-size: 20px;
  opacity: 0.4;
}

.gs-foot {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid $divider-color;
  background: $surface-sunk;
  font-size: 10px;
  color: $text-light;
}

.gs-foot kbd {
  display: inline-block;
  min-width: 14px;
  margin-right: 2px;
  padding: 0 3px;
  border: 1px solid $border-color;
  border-radius: 3px;
  background: $surface;
  font-family: $font-mono;
  font-size: 9px;
  text-align: center;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-fade-enter,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.gs-scroll::-webkit-scrollbar {
  width: 6px;
}

.gs-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.gs-scroll::-webkit-scrollbar-thumb {
  background: $border-color;
  border-radius: 3px;
}
</style>
