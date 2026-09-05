<template>
  <div class="family-profile" v-loading="loading">
    <div class="profile-topbar">
      <el-button type="text" icon="el-icon-back" @click="$router.push('/families')">All families</el-button>
    </div>

    <template v-if="profile">
      <!-- Identity header -->
      <div class="card identity">
        <div class="avatar">{{ initials }}</div>
        <div class="identity-main">
          <h2 class="kid-name">{{ profile.kid.name }}</h2>
          <p class="kid-meta">
            <span v-if="ageLabel">{{ ageLabel }} · </span>
            <span v-if="profile.kid.grade">{{ profile.kid.grade }} · </span>
            {{ profile.parent.displayName || 'Parent not linked' }}
          </p>
          <div class="interest-tags" v-if="profile.kid.interests && profile.kid.interests.length">
            <el-tag v-for="tag in profile.kid.interests.slice(0, 6)" :key="tag" size="mini" class="tag">{{ tag }}</el-tag>
          </div>
        </div>
        <div class="quota" v-if="profile.quota && profile.quota.allowance !== null">
          <div class="quota-num">{{ profile.quota.remaining }}</div>
          <div class="quota-label">questions left<br />{{ profile.quota.questionsUsed }} used</div>
        </div>
      </div>

      <!-- Week KPIs -->
      <div class="week-grid">
        <div class="card kpi">
          <div class="kpi-value">{{ weekHours }}<span class="kpi-unit">h</span></div>
          <div class="kpi-label">play this week</div>
          <BaseChart v-if="profile.thisWeek.sparkline.length" :option="spark(profile.thisWeek.sparkline)" height="40px" />
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ profile.thisWeek.sessions }}</div>
          <div class="kpi-label">active days this week</div>
        </div>
        <div class="card kpi" v-if="bestStreak !== null">
          <div class="kpi-value">{{ bestStreak }}<span class="kpi-unit">d</span></div>
          <div class="kpi-label">longest streak</div>
        </div>
        <div class="card kpi">
          <div class="kpi-value">{{ toysOnline }}<span class="kpi-unit">/{{ profile.devices.length }}</span></div>
          <div class="kpi-label">toys online</div>
        </div>
      </div>

      <!-- Devices -->
      <h3 class="section-title">Toys</h3>
      <div class="device-grid">
        <div v-for="device in profile.devices" :key="device.macAddress" class="card device-card">
          <div class="device-head">
            <span class="device-alias">{{ device.alias }}</span>
            <span class="online-badge" :class="device.online ? 'on' : 'off'">
              {{ device.online ? 'Online' : 'Offline' }}
            </span>
          </div>
          <div class="device-mac mono">{{ device.macAddress }}</div>
          <div class="device-meta">
            <span v-if="device.battery !== null">🔋 {{ device.battery }}%</span>
            <span v-if="device.firmware">fw {{ device.firmware }}</span>
            <span v-if="device.lastConnectedAt">last seen {{ shortDate(device.lastConnectedAt) }}</span>
          </div>
        </div>
        <div v-if="!profile.devices.length" class="card card-empty">No toys linked to this family yet.</div>
      </div>

      <!-- Loves + conversations -->
      <div class="two-col">
        <div class="card">
          <h4 class="card-subtitle">Loves most <span class="muted">(this period)</span></h4>
          <template v-if="loveCards.length || loveGames.length">
            <div v-for="pack in loveCards" :key="'c' + pack.name" class="mini-row">
              <span class="mini-name">{{ pack.name }}</span>
              <span class="mini-value">{{ pack.taps }} taps</span>
            </div>
            <div v-for="game in loveGames" :key="'g' + game.name" class="mini-row">
              <span class="mini-name">{{ game.name }}</span>
              <span class="mini-value">{{ game.plays }} plays</span>
            </div>
          </template>
          <div v-else class="card-empty">No taps or plays recorded yet.</div>
        </div>
        <div class="card">
          <h4 class="card-subtitle">Recent conversations</h4>
          <div v-if="profile.recentSummaries.length" class="summaries">
            <div v-for="(s, i) in profile.recentSummaries" :key="i" class="summary-item">
              <p class="summary-text">{{ s.summary }}</p>
              <p class="summary-meta mono">{{ s.macAddress }} · {{ shortDate(s.updatedAt) }}</p>
            </div>
          </div>
          <div v-else class="card-empty">No conversations yet.</div>
        </div>
      </div>
    </template>

    <div v-else-if="!loading" class="card card-empty big">Family profile not found.</div>
  </div>
</template>

<script>
import BaseChart from '@/components/charts/BaseChart.vue';
import { ensureEcharts, sparklineOption } from '@/components/charts/presets';
import Api from '@/apis/api';

export default {
  name: 'FamilyProfile',
  components: { BaseChart },
  data() {
    return {
      loading: false,
      profile: null
    };
  },
  computed: {
    initials() {
      const name = this.profile?.kid?.name || '?';
      return String(name).trim().slice(0, 2).toUpperCase();
    },
    ageLabel() {
      const birth = this.profile?.kid?.birthDate;
      if (!birth) return '';
      const years = new Date().getFullYear() - new Date(birth).getFullYear();
      return years > 0 ? `${years} yrs` : '';
    },
    weekHours() {
      const seconds = this.profile?.thisWeek?.playSeconds || 0;
      return Math.round((seconds / 3600) * 10) / 10;
    },
    bestStreak() {
      const list = this.profile?.progress || [];
      if (!list.length) return null;
      return Math.max(...list.map(p => p.longestStreak || 0));
    },
    toysOnline() {
      return (this.profile?.devices || []).filter(d => d.online).length;
    },
    loveCards() {
      return this.profile?.contentLove?.cards || [];
    },
    loveGames() {
      return this.profile?.contentLove?.games || [];
    }
  },
  watch: {
    '$route.params.id'() {
      this.loadProfile();
    }
  },
  created() {
    ensureEcharts();
    this.loadProfile();
  },
  methods: {
    spark(values) {
      return sparklineOption(values);
    },
    shortDate(value) {
      if (!value) return '—';
      return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    },
    loadProfile() {
      this.loading = true;
      const id = this.$route.params.id;
      Api.admin.getFamilyProfile(id, ({ data }) => {
        this.loading = false;
        if (data.code === 0 && data.data) {
          this.profile = data.data;
        } else {
          this.profile = null;
        }
      }, () => {
        this.loading = false;
        this.profile = null;
      });
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/styles/theme.scss';

.family-profile {
  max-width: 1100px;
}

.profile-topbar {
  margin-bottom: 8px;
}

.card {
  background: #fff;
  border: 1px solid $border-color;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 4px 14px rgba(61, 69, 102, 0.05);
  min-width: 0;
}

.identity {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba($primary, 0.16);
  color: $primary-dark;
  font-weight: 700;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.kid-name {
  margin: 0;
  font-size: 19px;
  color: $text-dark;
}

.kid-meta {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: $text-gray;
}

.interest-tags {
  margin-top: 6px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;

  .tag {
    background: rgba($primary, 0.1);
    border-color: transparent;
    color: $primary-dark;
  }
}

.quota {
  margin-left: auto;
  text-align: center;

  .quota-num {
    font-size: 24px;
    font-weight: 700;
    color: $primary-dark;
    font-variant-numeric: tabular-nums;
  }

  .quota-label {
    font-size: 10.5px;
    color: $text-gray;
  }
}

.week-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: $text-dark;
  font-variant-numeric: tabular-nums;
}

.kpi-unit {
  font-size: 13px;
  color: $text-gray;
  font-weight: 500;
}

.kpi-label {
  font-size: 11.5px;
  color: $text-gray;
  margin: 2px 0 6px;
}

.section-title {
  margin: 4px 0 10px;
  font-size: 14px;
  color: $text-dark;
}

.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.device-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.device-alias {
  font-weight: 600;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.online-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
  white-space: nowrap;

  &.on { background: rgba(12, 163, 12, 0.12); color: #0a7a0a; }
  &.off { background: #f0f1f7; color: $text-gray; }
}

.device-mac {
  font-size: 11.5px;
  color: $text-gray;
  margin-top: 4px;
}

.device-meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  font-size: 11.5px;
  color: $text-gray;
  flex-wrap: wrap;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.card-subtitle {
  margin: 0 0 8px;
  font-size: 13px;
  color: $text-dark;
}

.muted {
  color: $text-gray;
  font-weight: 400;
}

.mini-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f4f5fa;
  font-size: 12.5px;

  &:last-child { border-bottom: none; }
}

.mini-name {
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-value {
  color: $text-gray;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.summaries {
  max-height: 260px;
  overflow-y: auto;
}

.summary-item {
  padding: 8px 0;
  border-bottom: 1px solid #f4f5fa;

  &:last-child { border-bottom: none; }
}

.summary-text {
  margin: 0;
  font-size: 12.5px;
  color: $text-dark;
}

.summary-meta {
  margin: 3px 0 0;
  font-size: 10.5px;
  color: $text-gray;
}

.card-empty {
  text-align: center;
  color: $text-gray;
  font-size: 12.5px;
  padding: 16px 0;

  &.big { padding: 48px 0; }
}

.mono {
  font-family: 'Consolas', 'Menlo', monospace;
}

@media (max-width: 900px) {
  .week-grid, .two-col { grid-template-columns: 1fr 1fr; }
}
</style>
