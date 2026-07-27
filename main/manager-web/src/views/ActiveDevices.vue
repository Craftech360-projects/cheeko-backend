<template>
  <div class="active-devices">
    <HeaderBar />
    <el-main class="main-content">
      <!-- Page Title -->
      <div class="page-header">
        <h1>Active Devices</h1>
        <p class="subtitle">Devices with RFID taps, voice sessions, games or radio on a given day</p>
      </div>

      <!-- Date Filter -->
      <el-card class="filter-card" shadow="never">
        <div class="filter-row">
          <span class="filter-label">Date:</span>
          <el-date-picker
            v-model="selectedDate"
            type="date"
            format="yyyy-MM-dd"
            value-format="yyyy-MM-dd"
            :clearable="false"
            @change="fetchData"
          />
          <el-button type="primary" @click="fetchData" :loading="isLoading">
            <i class="el-icon-refresh"></i> Refresh
          </el-button>
        </div>
      </el-card>

      <!-- Active Devices Table -->
      <el-card class="table-card" shadow="never">
        <div slot="header" class="card-header">
          <span>Active Devices on {{ selectedDate }}</span>
        </div>
        <el-table
          :data="devices"
          v-loading="isLoading"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="mac_address" label="MAC" min-width="150">
            <template slot-scope="scope">
              <code class="mac-address">{{ scope.row.mac_address }}</code>
            </template>
          </el-table-column>
          <el-table-column label="Kid Name" min-width="130">
            <template slot-scope="scope">
              <span :class="{ 'deleted-device': !scope.row.device_id }">
                {{ displayName(scope.row.kid_name, scope.row.device_id, scope.row.owner_username) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="Parent Name" min-width="160">
            <template slot-scope="scope">
              <span :class="{ 'deleted-device': !scope.row.device_id }">
                {{ displayName(scope.row.parent_name, scope.row.device_id, scope.row.owner_username) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="tap_count" label="Taps" min-width="80" align="center" />
          <el-table-column prop="session_count" label="Sessions" min-width="90" align="center" />
          <el-table-column prop="game_count" label="Games" min-width="80" align="center" />
          <el-table-column prop="radio_count" label="Radio" min-width="80" align="center" />
          <el-table-column label="Last Activity" min-width="160">
            <template slot-scope="scope">
              {{ formatDateTime(scope.row.last_activity) }}
            </template>
          </el-table-column>
          <el-table-column label="Actions" min-width="90" align="center">
            <template slot-scope="scope">
              <el-button type="text" @click="openDetail(scope.row)">View</el-button>
            </template>
          </el-table-column>
          <template slot="empty">
            <span>No active devices for this date.</span>
          </template>
        </el-table>
      </el-card>

      <!-- Device Detail Drawer -->
      <el-drawer
        :title="drawerTitle"
        :visible.sync="drawerVisible"
        direction="rtl"
        size="45%"
      >
        <div class="drawer-body">
          <el-tabs v-model="activeTab" @tab-click="handleTabClick">
            <!-- RFID Tab -->
            <el-tab-pane label="RFID" name="rfid">
              <el-table :data="rfidRows" v-loading="rfidLoading" stripe style="width: 100%">
                <el-table-column label="Pack" min-width="140">
                  <template slot-scope="scope">
                    <span v-if="scope.row.pack">{{ scope.row.pack }}</span>
                    <span v-else class="unresolved-pack">Unresolved</span>
                  </template>
                </el-table-column>
                <el-table-column prop="taps" label="Taps" min-width="80" align="center" />
                <el-table-column prop="cards" label="Cards" min-width="80" align="center" />
                <el-table-column label="Last Tap" min-width="160">
                  <template slot-scope="scope">
                    {{ formatDateTime(scope.row.last_tap) }}
                  </template>
                </el-table-column>
                <template slot="empty">
                  <span>No RFID taps on this date.</span>
                </template>
              </el-table>
            </el-tab-pane>

            <!-- Images Tab -->
            <el-tab-pane label="Images" name="images">
              <div v-loading="imagesLoading">
                <div v-if="images.length > 0" class="images-grid">
                  <div v-for="img in images" :key="img.key" class="image-tile">
                    <el-image :src="img.url" lazy fit="cover" class="image-thumb">
                      <div slot="error" class="image-slot-error">
                        <i class="el-icon-picture-outline"></i>
                      </div>
                    </el-image>
                    <div class="image-timestamp">{{ formatDateTime(img.createdAt) }}</div>
                  </div>
                </div>
                <div v-else class="empty-note">
                  <i class="el-icon-picture-outline"></i>
                  <p>No images found for this date.</p>
                  <p class="empty-note-sub">
                    Generated images are only retained for ~7 days (S3 lifecycle rule), so
                    this is expected for older dates.
                  </p>
                </div>
              </div>
            </el-tab-pane>

            <!-- Games Tab -->
            <el-tab-pane label="Games" name="games">
              <el-table :data="gameRows" v-loading="gamesLoading" stripe style="width: 100%">
                <el-table-column prop="game_name" label="Game" min-width="120" />
                <el-table-column prop="level" label="Level" min-width="70" align="center" />
                <el-table-column prop="difficulty_level" label="Difficulty" min-width="90" />
                <el-table-column prop="score" label="Score" min-width="70" align="center" />
                <el-table-column label="Duration" min-width="90" align="center">
                  <template slot-scope="scope">
                    {{ formatDuration(scope.row.duration_ms) }}
                  </template>
                </el-table-column>
                <el-table-column label="Played At" min-width="90">
                  <template slot-scope="scope">
                    {{ formatTime(scope.row.played_at) }}
                  </template>
                </el-table-column>
                <template slot="empty">
                  <span>No games played on this date.</span>
                </template>
              </el-table>
            </el-tab-pane>

            <!-- Radio Tab -->
            <el-tab-pane label="Radio" name="radio">
              <el-table :data="radioRows" v-loading="radioLoading" stripe style="width: 100%">
                <el-table-column prop="station" label="Station" min-width="160" />
                <el-table-column label="Duration" min-width="90" align="center">
                  <template slot-scope="scope">
                    {{ formatDuration(scope.row.duration_ms) }}
                  </template>
                </el-table-column>
                <el-table-column label="Played At" min-width="90">
                  <template slot-scope="scope">
                    {{ formatTime(scope.row.played_at) }}
                  </template>
                </el-table-column>
                <template slot="empty">
                  <span>No radio played on this date.</span>
                </template>
              </el-table>
            </el-tab-pane>

            <!-- Chat Tab -->
            <el-tab-pane label="Chat" name="chat">
              <div v-loading="chatLoading" class="tab-fill">
                <div v-if="chatRows.length > 0" class="chat-list">
                  <template v-for="row in chatRows">
                    <div v-if="row.startsSession" :key="row.id + '-sep'" class="chat-session-sep">
                      <span>Session started {{ formatTime(row.created_at) }}</span>
                    </div>
                    <div
                      :key="row.id"
                      class="chat-row"
                      :class="chatTypeClass(row.chat_type)"
                    >
                      <div class="chat-bubble">
                        <div class="chat-meta">
                          <span class="chat-speaker">{{ chatTypeLabel(row.chat_type) }}</span>
                          <span class="chat-time">{{ formatTime(row.created_at) }}</span>
                        </div>
                        <div class="chat-content">
                          <template v-for="(part, i) in chatParts(row.content)">
                            <span v-if="part.tag" :key="i" class="chat-tag">{{ part.tag }}</span>
                            <span v-else :key="i">{{ part.text }}</span>
                          </template>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
                <div v-else class="empty-note">
                  <i class="el-icon-chat-dot-round"></i>
                  <p>No chat messages found for this date.</p>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-drawer>
    </el-main>
  </div>
</template>

<script>
import Api from '@/apis/api';
import HeaderBar from '@/components/HeaderBar.vue';

export default {
  name: 'ActiveDevices',
  components: { HeaderBar },
  data() {
    return {
      isLoading: false,
      selectedDate: this.getToday(),
      devices: [],

      drawerVisible: false,
      activeTab: 'rfid',
      currentRow: null,

      rfidRows: [],
      rfidLoading: false,
      images: [],
      imagesLoading: false,
      chatRows: [],
      chatLoading: false,
      gameRows: [],
      gamesLoading: false,
      radioRows: [],
      radioLoading: false
    };
  },
  computed: {
    drawerTitle() {
      return this.currentRow ? `Device ${this.currentRow.mac_address}` : 'Device';
    }
  },
  mounted() {
    this.fetchData();
  },
  methods: {
    getToday() {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    fetchData() {
      this.isLoading = true;
      Api.activeDevices.getActiveDevices(this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          this.devices = res.data.data || [];
        }
        this.isLoading = false;
      }, () => {
        this.isLoading = false;
      });
    },
    // Resolution order:
    //   1. real kid/parent name
    //   2. no ai_device row at all -> device deleted, activity orphaned
    //   3. owner sys_user (device bound to admin with no kid_profile)
    displayName(name, deviceId, ownerUsername) {
      if (name) return name;
      if (!deviceId) return '(device deleted)';
      if (ownerUsername) return `(owner: ${ownerUsername})`;
      return '—';
    },
    openDetail(row) {
      this.currentRow = row;
      this.drawerVisible = true;
      this.activeTab = 'rfid';
      this.rfidRows = [];
      this.images = [];
      this.chatRows = [];
      this.gameRows = [];
      this.radioRows = [];
      this.fetchRfid();
    },
    handleTabClick(tab) {
      if (tab.name === 'rfid' && this.rfidRows.length === 0) this.fetchRfid();
      if (tab.name === 'images' && this.images.length === 0) this.fetchImages();
      if (tab.name === 'chat' && this.chatRows.length === 0) this.fetchChat();
      if (tab.name === 'games' && this.gameRows.length === 0) this.fetchGames();
      if (tab.name === 'radio' && this.radioRows.length === 0) this.fetchRadio();
    },
    fetchGames() {
      if (!this.currentRow) return;
      this.gamesLoading = true;
      Api.activeDevices.getDeviceGames(this.currentRow.mac_address, this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          this.gameRows = res.data.data || [];
        }
        this.gamesLoading = false;
      }, () => {
        this.gamesLoading = false;
      });
    },
    fetchRadio() {
      if (!this.currentRow) return;
      this.radioLoading = true;
      Api.activeDevices.getDeviceRadio(this.currentRow.mac_address, this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          this.radioRows = res.data.data || [];
        }
        this.radioLoading = false;
      }, () => {
        this.radioLoading = false;
      });
    },
    fetchRfid() {
      if (!this.currentRow) return;
      this.rfidLoading = true;
      Api.activeDevices.getDeviceRfid(this.currentRow.mac_address, this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          this.rfidRows = res.data.data || [];
        }
        this.rfidLoading = false;
      }, () => {
        this.rfidLoading = false;
      });
    },
    fetchImages() {
      if (!this.currentRow) return;
      this.imagesLoading = true;
      Api.activeDevices.getDeviceImages(this.currentRow.mac_address, this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          this.images = res.data.data || [];
        }
        this.imagesLoading = false;
      }, () => {
        this.imagesLoading = false;
      });
    },
    fetchChat() {
      if (!this.currentRow) return;
      this.chatLoading = true;
      Api.activeDevices.getDeviceChat(this.currentRow.mac_address, this.selectedDate, (res) => {
        if (res.data && res.data.code === 0) {
          const rows = res.data.data || [];
          let lastSession = null;
          this.chatRows = rows.map((row) => {
            const startsSession = row.session_id !== lastSession;
            lastSession = row.session_id;
            return { ...row, startsSession };
          });
        }
        this.chatLoading = false;
      }, () => {
        this.chatLoading = false;
      });
    },
    // The agent emits face-expression tags inline, e.g. "[happy] Yes!".
    // Split them out so they render as chips instead of cluttering the text.
    chatParts(content) {
      if (!content) return [];
      return String(content)
        .split(/(\[[a-z ]{2,20}\])/gi)
        .filter((piece) => piece.trim() !== '')
        .map((piece) => (/^\[[a-z ]{2,20}\]$/i.test(piece)
          ? { tag: piece.slice(1, -1) }
          : { text: piece }));
    },
    chatTypeLabel(chatType) {
      if (chatType === 1 || chatType === '1') return 'Child';
      if (chatType === 2 || chatType === '2') return 'Cheeko';
      return 'Unknown';
    },
    chatTypeClass(chatType) {
      if (chatType === 1 || chatType === '1') return 'chat-user';
      if (chatType === 2 || chatType === '2') return 'chat-assistant';
      return '';
    },
    formatDateTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    formatDuration(ms) {
      if (!ms && ms !== 0) return '-';
      const totalSeconds = Math.round(ms / 1000);
      if (totalSeconds < 60) return `${totalSeconds}s`;
      return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
    },
    formatTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }
};
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.active-devices {
  min-height: 100vh;
  background: linear-gradient(145deg, #fff5eb, #fff7f0);
}

.main-content {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;

  h1 {
    color: #3d4566;
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px 0;
  }

  .subtitle {
    color: #818cae;
    font-size: 14px;
    margin: 0;
  }
}

.filter-card {
  margin-bottom: 20px;
  border-radius: 12px;

  .filter-row {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-wrap: wrap;
  }

  .filter-label {
    font-weight: 500;
    color: #3d4566;
  }
}

.table-card {
  border-radius: 12px;
  border: none;
  margin-bottom: 20px;

  .card-header {
    font-size: 16px;
    font-weight: 600;
    color: #3d4566;
  }
}

.mac-address {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.deleted-device {
  color: #bfbfbf;
  font-style: italic;
}

::v-deep .el-table {
  border-radius: 8px;

  th {
    background: #fafafa !important;
    color: #3d4566;
    font-weight: 600;
  }
}

// The drawer is full-height, but Element's body wrapper does not pass that
// height down, so the tab content collapsed to its natural size and left the
// lower half of the drawer blank. Chain height through body -> tabs -> pane
// so the chat list can flex into whatever space is left.
::v-deep .el-drawer__body {
  height: calc(100% - 60px);
  overflow: hidden;
}

.drawer-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 20px 20px;
}

::v-deep .el-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  .el-tabs__content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .el-tab-pane {
    height: 100%;
  }
}

.unresolved-pack {
  color: #bfbfbf;
  font-style: italic;
}

.images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}

.image-tile {
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}

.image-thumb {
  width: 100%;
  height: 140px;
  display: block;
}

.image-slot-error {
  width: 100%;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;
  font-size: 24px;
  background: #f5f5f5;
}

.image-timestamp {
  padding: 6px 8px;
  font-size: 12px;
  color: #818cae;
  text-align: center;
}

.empty-note {
  padding: 40px 20px;
  text-align: center;
  color: #bfbfbf;

  i {
    font-size: 40px;
    margin-bottom: 12px;
  }

  p {
    margin: 4px 0;
  }

  .empty-note-sub {
    font-size: 12px;
    color: #c8c8c8;
    max-width: 360px;
    margin: 8px auto 0;
  }
}

.tab-fill {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 4px 4px;
}

.chat-session-sep {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 4px;
  font-size: 12px;
  color: #a0a6bb;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #ebeef5;
  }
}

.chat-row {
  display: flex;

  &.chat-user {
    justify-content: flex-end;
  }

  &.chat-assistant {
    justify-content: flex-start;
  }
}

.chat-bubble {
  max-width: 72%;
  border-radius: 12px;
  padding: 8px 12px;
  background: #f7f7f7;

  .chat-user & {
    background: rgba(#1890ff, 0.1);
    border-bottom-right-radius: 4px;
  }

  .chat-assistant & {
    background: rgba($primary, 0.1);
    border-bottom-left-radius: 4px;
  }
}

.chat-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  font-size: 12px;
  color: #818cae;
  margin-bottom: 4px;
}

.chat-speaker {
  font-weight: 600;
  color: #3d4566;
}

.chat-content {
  font-size: 14px;
  line-height: 1.5;
  color: #3d4566;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(#3d4566, 0.08);
  font-size: 11px;
  line-height: 16px;
  color: #6b7290;
  vertical-align: 1px;
}
</style>
