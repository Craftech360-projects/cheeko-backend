<template>
  <div class="trophy-room" v-loading="loading" element-loading-background="rgba(26, 22, 36, 0.8)">

    <!-- ═══ Streak Banner ═══ -->
    <div class="streak-banner" v-if="streak && streak.current_streak > 0">
      <span class="streak-fire">🔥</span>
      <span class="streak-count">{{ streak.current_streak }}</span>
      <span class="streak-label">day streak</span>
      <span class="streak-best" v-if="streak.longest_streak > streak.current_streak">
        · best: {{ streak.longest_streak }}
      </span>
    </div>

    <!-- ═══ Game Cards with Progress Rings ═══ -->
    <div class="game-cards" v-if="progressList.length > 0">
      <div v-for="p in progressList" :key="p.game_type" class="game-card"
        :class="'game-card--' + p.game_type">
        <!-- SVG Progress Ring -->
        <div class="ring-container">
          <svg viewBox="0 0 120 120" class="progress-ring">
            <circle class="ring-bg" cx="60" cy="60" r="52" />
            <circle class="ring-fill" cx="60" cy="60" r="52"
              :style="{ strokeDashoffset: ringOffset(p) }" />
          </svg>
          <div class="ring-center">
            <span class="ring-level">{{ p.level }}</span>
            <span class="ring-label">LVL</span>
          </div>
        </div>
        <div class="game-info">
          <div class="game-title">
            <span class="game-icon">{{ gameIcon(p.game_type) }}</span>
            {{ gameName(p.game_type) }}
          </div>
          <div class="game-stats">
            <div class="mini-stat">
              <span class="mini-val">{{ p.total_played }}</span>
              <span class="mini-lbl">plays</span>
            </div>
            <div class="mini-stat">
              <span class="mini-val">{{ accuracy(p) }}%</span>
              <span class="mini-lbl">accuracy</span>
            </div>
            <div class="mini-stat">
              <span class="mini-val">{{ p.total_correct }}</span>
              <span class="mini-lbl">correct</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-trophy-case">
      <div class="empty-icon">🏆</div>
      <p>No games played yet — the trophy shelf awaits!</p>
    </div>

    <!-- ═══ Achievement Showcase ═══ -->
    <div class="achievement-showcase" v-if="achievements.length > 0 || upcomingAchievements.length > 0">
      <div class="section-header">
        <span class="section-icon">🏅</span>
        <h4>Achievements</h4>
        <span class="achievement-counter">{{ achievements.length }} / {{ totalAchievements }}</span>
      </div>

      <!-- Unlocked Badges -->
      <div class="badge-shelf">
        <el-tooltip v-for="a in achievements" :key="a.code"
          :content="achievementDesc(a.code)" placement="top" effect="light">
          <div class="badge" :class="'badge--' + badgeTier(a.code)">
            <span class="badge-icon">{{ badgeEmoji(a.code) }}</span>
            <span class="badge-name">{{ achievementLabel(a.code) }}</span>
          </div>
        </el-tooltip>
      </div>

      <!-- Upcoming (locked) -->
      <div class="upcoming-shelf" v-if="upcomingAchievements.length > 0">
        <span class="upcoming-label">Up next</span>
        <el-tooltip v-for="a in upcomingAchievements" :key="a.code"
          :content="a.hint" placement="top" effect="light">
          <div class="badge badge--locked">
            <span class="badge-icon">🔒</span>
            <span class="badge-name">{{ a.label }}</span>
          </div>
        </el-tooltip>
      </div>
    </div>

    <!-- ═══ Level Journey ═══ -->
    <div class="level-journey" v-if="levelHistory.length > 0">
      <div class="section-header">
        <span class="section-icon">📊</span>
        <h4>Level Journey</h4>
      </div>
      <div class="journey-track">
        <div v-for="lh in levelHistory" :key="lh.game_type + '_' + lh.level"
          class="journey-node" :class="{ 'journey-node--cleared': lh.cleared }">
          <div class="node-dot">
            <span v-if="lh.cleared">✓</span>
            <span v-else>{{ lh.level }}</span>
          </div>
          <div class="node-info">
            <span class="node-game">{{ gameName(lh.game_type) }} · Lvl {{ lh.level }}</span>
            <span class="node-detail">
              {{ lh.attempts }} {{ lh.attempts === 1 ? 'try' : 'tries' }} · {{ lh.accuracy }}%
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Recent Sessions ═══ -->
    <div class="session-log" v-if="sessions.length > 0">
      <div class="section-header">
        <span class="section-icon">📝</span>
        <h4>Recent Sessions</h4>
      </div>
      <div class="session-list">
        <div v-for="(s, i) in sessions" :key="i" class="session-row">
          <span class="session-game">{{ gameIcon(s.game_type) }} {{ gameName(s.game_type) }}</span>
          <span class="session-level">
            Lvl {{ s.level_before }}
            <span v-if="s.level_after > s.level_before" class="level-up-badge">
              → {{ s.level_after }} ⬆
            </span>
          </span>
          <span class="session-score" :class="scoreClass(s)">
            {{ s.correct_answers }}/{{ s.questions_asked }} <small>correct</small>
          </span>
          <span class="session-time">{{ formatDuration(s.duration_secs) }}</span>
          <span class="session-date">{{ formatRelativeDate(s.ended_at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Api from '../apis/api'

const GAME_NAMES = {
  math_quiz: 'Math Commander',
  yesno_quiz: 'Yes/No Quiz',
  oddoneout: 'Odd One Out'
}

const GAME_ICONS = {
  math_quiz: '🔢',
  yesno_quiz: '✅',
  oddoneout: '🔍'
}

const ACHIEVEMENT_MAP = {
  first_star: { label: 'First Star', desc: 'Got first correct answer', tier: 'bronze', emoji: '⭐' },
  perfect_round: { label: 'Perfect Round', desc: '5/5 correct in one round', tier: 'gold', emoji: '💯' },
  no_hints: { label: 'No Hints', desc: 'Completed round without hints', tier: 'silver', emoji: '🧠' },
  streak_3: { label: '3-Day Streak', desc: 'Played 3 days in a row', tier: 'bronze', emoji: '🔥' },
  streak_7: { label: '7-Day Streak', desc: 'Played 7 days in a row', tier: 'silver', emoji: '🔥' },
  streak_14: { label: '14-Day Streak', desc: 'Played 14 days in a row', tier: 'gold', emoji: '🔥' },
  streak_30: { label: '30-Day Streak', desc: 'Played 30 days in a row', tier: 'diamond', emoji: '🔥' },
  streak_100: { label: '100-Day Streak', desc: 'Played 100 days in a row', tier: 'diamond', emoji: '💎' },
  streak_5_game: { label: '5 Streak', desc: '5 correct in a row', tier: 'bronze', emoji: '⚡' },
  streak_10_game: { label: '10 Streak', desc: '10 correct in a row', tier: 'silver', emoji: '⚡' },
  level_5: { label: 'Level 5', desc: 'Reached level 5', tier: 'bronze', emoji: '🏔' },
  level_10: { label: 'Level 10', desc: 'Reached level 10', tier: 'silver', emoji: '🏔' },
  level_25: { label: 'Level 25', desc: 'Reached level 25', tier: 'gold', emoji: '🏔' },
  level_50: { label: 'Level 50', desc: 'Reached level 50', tier: 'diamond', emoji: '🗻' },
  level_100: { label: 'Level 100', desc: 'Reached level 100', tier: 'diamond', emoji: '🌟' },
  persistence_10: { label: '10 Sessions', desc: 'Played 10 sessions', tier: 'bronze', emoji: '🎯' },
  persistence_50: { label: '50 Sessions', desc: 'Played 50 sessions', tier: 'silver', emoji: '🎯' },
  persistence_100: { label: '100 Sessions', desc: 'Played 100 sessions', tier: 'gold', emoji: '🎯' },
  questions_100: { label: '100 Questions', desc: 'Answered 100 questions', tier: 'bronze', emoji: '❓' },
  questions_500: { label: '500 Questions', desc: 'Answered 500 questions', tier: 'silver', emoji: '❓' },
  questions_1000: { label: '1000 Questions', desc: 'Answered 1000 questions', tier: 'gold', emoji: '❓' },
}

const UPCOMING_ORDER = [
  { code: 'perfect_round', label: 'Perfect Round', hint: 'Get 5/5 correct in one round' },
  { code: 'no_hints', label: 'No Hints', hint: 'Complete a round without any hints' },
  { code: 'streak_7', label: '7-Day Streak', hint: 'Play 7 days in a row' },
  { code: 'streak_30', label: '30-Day Streak', hint: 'Play 30 days in a row' },
  { code: 'level_10', label: 'Level 10', hint: 'Reach level 10 in any game' },
  { code: 'level_25', label: 'Level 25', hint: 'Reach level 25 in any game' },
  { code: 'streak_10_game', label: '10 In-Game Streak', hint: 'Get 10 correct in a row' },
  { code: 'persistence_50', label: '50 Sessions', hint: 'Play 50 game sessions' },
  { code: 'questions_500', label: '500 Questions', hint: 'Answer 500 questions total' },
]

const RING_CIRCUMFERENCE = 2 * Math.PI * 52 // ~326.7

export default {
  name: 'KidGameProgress',
  props: {
    kidId: { type: String, required: true }
  },
  data() {
    return {
      loading: false,
      progressList: [],
      streak: null,
      achievements: [],
      sessions: []
    }
  },
  computed: {
    totalAchievements() { return Object.keys(ACHIEVEMENT_MAP).length },
    upcomingAchievements() {
      const unlocked = new Set(this.achievements.map(a => a.code))
      return UPCOMING_ORDER.filter(a => !unlocked.has(a.code)).slice(0, 4)
    },
    levelHistory() {
      const groups = {}
      this.sessions.forEach(s => {
        const key = `${s.game_type}_${s.level_before}`
        if (!groups[key]) {
          groups[key] = { game_type: s.game_type, level: s.level_before, attempts: 0, totalCorrect: 0, totalQuestions: 0, cleared: false }
        }
        groups[key].attempts += 1
        groups[key].totalCorrect += s.correct_answers || 0
        groups[key].totalQuestions += s.questions_asked || 0
        if (s.level_after > s.level_before) groups[key].cleared = true
      })
      return Object.values(groups)
        .map(g => ({ ...g, accuracy: g.totalQuestions > 0 ? Math.round((g.totalCorrect / g.totalQuestions) * 100) : 0 }))
        .sort((a, b) => a.game_type.localeCompare(b.game_type) || a.level - b.level)
    }
  },
  watch: {
    kidId: { immediate: true, handler(val) { if (val) this.fetchAll() } }
  },
  methods: {
    fetchAll() {
      this.loading = true
      let pending = 4
      const done = () => { pending--; if (pending <= 0) this.loading = false }
      Api.game.getProgress(this.kidId, (res) => { this.progressList = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []); done() })
      Api.game.getStreak(this.kidId, (res) => { this.streak = res.data || null; done() })
      Api.game.getAchievements(this.kidId, (res) => { this.achievements = Array.isArray(res.data) ? res.data : []; done() })
      Api.game.getSessions(this.kidId, (res) => { this.sessions = Array.isArray(res.data) ? res.data : []; done() })
    },
    gameName(type) { return GAME_NAMES[type] || type },
    gameIcon(type) { return GAME_ICONS[type] || '🎮' },
    accuracy(p) { return p.total_questions ? Math.round((p.total_correct / p.total_questions) * 100) : 0 },
    ringOffset(p) {
      // Fill based on progress toward next milestone (every 5 levels)
      const inTier = ((p.level - 1) % 5)
      const pct = inTier / 5
      return RING_CIRCUMFERENCE * (1 - pct)
    },
    achievementLabel(code) { return (ACHIEVEMENT_MAP[code] || {}).label || code.replace(/_/g, ' ') },
    achievementDesc(code) { return (ACHIEVEMENT_MAP[code] || {}).desc || code },
    badgeTier(code) { return (ACHIEVEMENT_MAP[code] || {}).tier || 'bronze' },
    badgeEmoji(code) { return (ACHIEVEMENT_MAP[code] || {}).emoji || '🏅' },
    scoreClass(s) {
      if (!s.questions_asked) return ''
      const pct = s.correct_answers / s.questions_asked
      if (pct >= 0.8) return 'session-score-good'
      if (pct >= 0.5) return 'session-score-ok'
      return 'session-score-low'
    },
    formatDuration(secs) {
      if (!secs) return '-'
      const m = Math.floor(secs / 60), s = secs % 60
      return m > 0 ? `${m}m ${s}s` : `${s}s`
    },
    formatDate(dt) {
      if (!dt) return '-'
      return new Date(dt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    },
    formatRelativeDate(dt) {
      if (!dt) return '-'
      const d = new Date(dt)
      const now = new Date()
      const today = now.toDateString()
      const yesterday = new Date(now - 86400000).toDateString()
      const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      if (d.toDateString() === today) return `Today, ${time}`
      if (d.toDateString() === yesterday) return `Yesterday, ${time}`
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + `, ${time}`
    }
  }
}
</script>

<style scoped lang="scss">
/* ═══ Trophy Room Theme ═══ */
$dark: #1A1624;
$surface: #241F31;
$surface-light: #2E2840;
$gold: #FFD54F;
$gold-glow: rgba(255, 213, 79, 0.3);
$warm: #FF9100;
$text: #E8E0F0;
$text-muted: #8A7FA8;
$bronze: #CD7F32;
$silver: #C0C0C0;
$diamond: #B9F2FF;
$green: #66BB6A;
$ring-bg: rgba(255, 255, 255, 0.08);

.trophy-room {
  background: $dark;
  border-radius: 12px;
  padding: 24px;
  color: $text;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

/* ═══ Entry Animations ═══ */
.game-card { animation: fadeSlideUp 0.5s ease-out both; }
.game-card:nth-child(1) { animation-delay: 0.05s; }
.game-card:nth-child(2) { animation-delay: 0.15s; }
.game-card:nth-child(3) { animation-delay: 0.25s; }

.badge { animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.badge:nth-child(1) { animation-delay: 0.1s; }
.badge:nth-child(2) { animation-delay: 0.2s; }
.badge:nth-child(3) { animation-delay: 0.3s; }
.badge:nth-child(4) { animation-delay: 0.4s; }
.badge:nth-child(5) { animation-delay: 0.5s; }

.journey-node { animation: fadeSlideRight 0.4s ease-out both; }
.journey-node:nth-child(1) { animation-delay: 0.1s; }
.journey-node:nth-child(2) { animation-delay: 0.2s; }
.journey-node:nth-child(3) { animation-delay: 0.3s; }
.journey-node:nth-child(4) { animation-delay: 0.4s; }

.session-row { animation: fadeSlideUp 0.3s ease-out both; }
.session-row:nth-child(1) { animation-delay: 0.05s; }
.session-row:nth-child(2) { animation-delay: 0.1s; }
.session-row:nth-child(3) { animation-delay: 0.15s; }

@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeSlideRight {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes popIn {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: scale(1); }
}

/* ═══ Streak Banner ═══ */
.streak-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, rgba(255, 145, 0, 0.15), rgba(255, 213, 79, 0.08));
  border: 1px solid rgba(255, 145, 0, 0.25);
  border-radius: 10px;
  padding: 12px 18px;
  margin-bottom: 20px;
  animation: streakPulse 3s ease-in-out infinite;
  .streak-fire {
    font-size: 22px;
    animation: fireGlow 1.5s ease-in-out infinite alternate;
  }
  .streak-count { font-size: 24px; font-weight: 800; color: $warm; }
  .streak-label { font-size: 14px; color: $text-muted; }
  .streak-best { font-size: 12px; color: $text-muted; }
}

@keyframes fireGlow {
  0% { filter: brightness(1); transform: scale(1); }
  100% { filter: brightness(1.4); transform: scale(1.15); }
}
@keyframes streakPulse {
  0%, 100% { border-color: rgba(255, 145, 0, 0.25); }
  50% { border-color: rgba(255, 145, 0, 0.5); }
}

/* ═══ Game Cards + Progress Rings ═══ */
.game-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.game-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: $surface;
  border-radius: 14px;
  padding: 18px 20px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
}

.ring-container {
  position: relative;
  width: 90px;
  height: 90px;
  flex-shrink: 0;
}

.progress-ring {
  width: 90px;
  height: 90px;
  transform: rotate(-90deg);
  circle { fill: none; stroke-width: 8; stroke-linecap: round; }
  .ring-bg { stroke: $ring-bg; stroke-width: 8; }
  .ring-fill {
    stroke: $warm;
    stroke-dasharray: 326.73;
    transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1);
    filter: drop-shadow(0 0 4px currentColor);
  }
}

.game-card--math_quiz .ring-fill { stroke: #4FC3F7; }
.game-card--yesno_quiz .ring-fill { stroke: #81C784; }
.game-card--oddoneout .ring-fill { stroke: #FFB74D; }

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  .ring-level { font-size: 26px; font-weight: 900; line-height: 1; color: #fff; }
  .ring-label { font-size: 9px; font-weight: 700; letter-spacing: 2px; color: $text-muted; text-transform: uppercase; }
}

.game-info { flex: 1; min-width: 0; }

.game-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
  .game-icon { margin-right: 4px; }
}

.game-stats {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.mini-stat {
  min-width: 45px;
  .mini-val { display: block; font-size: 15px; font-weight: 700; color: $gold; white-space: nowrap; }
  .mini-lbl { font-size: 9px; color: $text-muted; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
}

/* ═══ Achievement Showcase ═══ */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  .section-icon { font-size: 18px; }
  h4 { margin: 0; font-size: 14px; font-weight: 700; color: $text; }
  .achievement-counter { font-size: 12px; color: $text-muted; margin-left: auto; }
}

.achievement-showcase { margin-bottom: 22px; }

.badge-shelf {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: $surface-light;
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: box-shadow 0.3s, transform 0.2s;
  cursor: default;
  .badge-icon { font-size: 14px; }
  .badge-name { color: $text; }
  &:hover { transform: scale(1.05); }
}

.badge--bronze {
  border-color: rgba($bronze, 0.5);
  box-shadow: 0 0 6px rgba($bronze, 0.15);
  .badge-icon { filter: drop-shadow(0 0 2px rgba($bronze, 0.5)); }
  &:hover { box-shadow: 0 0 14px rgba($bronze, 0.4); }
}
.badge--silver {
  border-color: rgba($silver, 0.5);
  box-shadow: 0 0 6px rgba($silver, 0.15);
  .badge-icon { filter: drop-shadow(0 0 2px rgba($silver, 0.5)); }
  &:hover { box-shadow: 0 0 14px rgba($silver, 0.4); }
}
.badge--gold {
  border-color: rgba($gold, 0.5);
  background: linear-gradient(135deg, rgba($gold, 0.1), transparent);
  animation: goldShimmer 3s ease-in-out infinite;
  &:hover { box-shadow: 0 0 16px $gold-glow; }
}
.badge--diamond {
  border-color: rgba($diamond, 0.5);
  background: linear-gradient(135deg, rgba($diamond, 0.1), transparent);
  animation: diamondShimmer 2.5s ease-in-out infinite;
  &:hover { box-shadow: 0 0 20px rgba($diamond, 0.4); }
}
.badge--locked {
  opacity: 0.35;
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.1);
  .badge-name { color: $text-muted; }
}

@keyframes goldShimmer {
  0%, 100% { box-shadow: 0 0 4px rgba($gold, 0.1); }
  50% { box-shadow: 0 0 10px $gold-glow; }
}
@keyframes diamondShimmer {
  0%, 100% { box-shadow: 0 0 4px rgba($diamond, 0.1); }
  50% { box-shadow: 0 0 12px rgba($diamond, 0.3); }
}

.upcoming-shelf {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  .upcoming-label {
    font-size: 11px;
    color: $text-muted;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-right: 4px;
  }
}

/* ═══ Level Journey ═══ */
.level-journey { margin-bottom: 22px; }

.journey-track {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  position: relative;
}

.journey-node {
  display: flex;
  align-items: center;
  gap: 10px;
  background: $surface;
  border-radius: 12px;
  padding: 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  min-width: 200px;
  position: relative;
  transition: transform 0.2s, border-color 0.3s;
  &:hover { transform: translateY(-1px); }
}

.node-dot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: $surface-light;
  border: 2.5px solid $text-muted;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  color: $text-muted;
  flex-shrink: 0;
  transition: all 0.3s;
}

.journey-node--cleared {
  border-color: rgba($green, 0.2);
  .node-dot {
    background: rgba($green, 0.15);
    border-color: $green;
    color: $green;
    box-shadow: 0 0 8px rgba($green, 0.25);
    font-size: 15px;
  }
}

.node-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  .node-game { font-size: 12px; font-weight: 700; color: $text; }
  .node-detail { font-size: 11px; color: $text-muted; }
}

/* ═══ Session Log ═══ */
.session-log { margin-bottom: 8px; }

.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: $surface;
  &:nth-child(even) { background: $surface-light; }
  .session-game { width: 140px; font-weight: 600; }
  .session-level { width: 100px; color: $text-muted; }
  .session-score {
    width: 100px; font-weight: 700; color: $gold;
    small { font-weight: 400; color: $text-muted; font-size: 10px; margin-left: 2px; }
  }
  .session-score-good { color: $green; }
  .session-score-ok { color: $gold; }
  .session-score-low { color: #FF7043; }
  .session-time { width: 70px; color: $text-muted; font-size: 12px; }
  .session-date { color: $text-muted; font-size: 12px; min-width: 120px; }
}

.level-up-badge {
  color: $green;
  font-weight: 700;
  font-size: 12px;
}

/* ═══ Empty State ═══ */
.empty-trophy-case {
  text-align: center;
  padding: 48px 24px;
  .empty-icon { font-size: 56px; opacity: 0.3; }
  p { color: $text-muted; margin-top: 12px; font-size: 14px; }
}
</style>
