<template>
  <div class="kid-game-progress" v-loading="loading">
    <!-- Stats Overview -->
    <div class="stats-grid" v-if="progressList.length > 0">
      <el-card v-for="p in progressList" :key="p.game_type" class="stat-card" shadow="hover">
        <div class="stat-header">
          <span class="game-icon">{{ gameIcon(p.game_type) }}</span>
          <span class="game-name">{{ gameName(p.game_type) }}</span>
        </div>
        <div class="stat-body">
          <div class="stat-item">
            <span class="stat-value">{{ p.level }}</span>
            <span class="stat-label">Level</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ p.total_played }}</span>
            <span class="stat-label">Sessions</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ p.total_correct }}/{{ p.total_questions }}</span>
            <span class="stat-label">Correct</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ accuracy(p) }}%</span>
            <span class="stat-label">Accuracy</span>
          </div>
        </div>
      </el-card>
    </div>

    <div v-else class="empty-state">
      <i class="el-icon-trophy" style="font-size: 48px; color: #ccc;"></i>
      <p>No games played yet</p>
    </div>

    <!-- Streak -->
    <div class="streak-section" v-if="streak && streak.current_streak > 0">
      <el-tag type="warning" size="medium">
        {{ streak.current_streak }}-day streak (longest: {{ streak.longest_streak }})
      </el-tag>
    </div>

    <!-- Achievements: Unlocked -->
    <div class="achievements-section" v-if="achievements.length > 0 || upcomingAchievements.length > 0">
      <h4>Achievements ({{ achievements.length }}/{{ totalAchievements }})</h4>
      <div class="achievement-grid">
        <el-tooltip v-for="a in achievements" :key="a.code"
          :content="achievementDesc(a.code)" placement="top">
          <el-tag :type="achievementType(a.code)" size="small" class="achievement-tag">
            {{ achievementLabel(a.code) }}
          </el-tag>
        </el-tooltip>
      </div>

      <!-- Upcoming Achievements -->
      <h4 v-if="upcomingAchievements.length > 0" style="margin-top: 12px;">
        Up Next
      </h4>
      <div class="achievement-grid" v-if="upcomingAchievements.length > 0">
        <el-tooltip v-for="a in upcomingAchievements" :key="a.code"
          :content="a.hint" placement="top">
          <el-tag type="info" size="small" class="achievement-tag achievement-locked">
            {{ a.label }}
          </el-tag>
        </el-tooltip>
      </div>
    </div>

    <!-- Level History: attempts per level -->
    <div class="level-history-section" v-if="levelHistory.length > 0">
      <h4>Level History</h4>
      <el-table :data="levelHistory" size="small" stripe>
        <el-table-column prop="game_type" label="Game" width="130">
          <template slot-scope="{ row }">{{ gameName(row.game_type) }}</template>
        </el-table-column>
        <el-table-column prop="level" label="Level" width="80" />
        <el-table-column prop="attempts" label="Attempts" width="90" />
        <el-table-column label="Accuracy" width="90">
          <template slot-scope="{ row }">{{ row.accuracy }}%</template>
        </el-table-column>
        <el-table-column label="Status" width="100">
          <template slot-scope="{ row }">
            <el-tag v-if="row.cleared" type="success" size="mini">Cleared</el-tag>
            <el-tag v-else type="warning" size="mini">In Progress</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Recent Sessions -->
    <div class="sessions-section" v-if="sessions.length > 0">
      <h4>Recent Sessions</h4>
      <el-table :data="sessions" size="small" stripe>
        <el-table-column prop="game_type" label="Game" width="130">
          <template slot-scope="{ row }">{{ gameName(row.game_type) }}</template>
        </el-table-column>
        <el-table-column label="Level" width="100">
          <template slot-scope="{ row }">
            {{ row.level_before }}
            <span v-if="row.level_after > row.level_before" style="color: #67C23A;">
              &rarr; {{ row.level_after }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="Score" width="100">
          <template slot-scope="{ row }">
            {{ row.correct_answers }}/{{ row.questions_asked }}
          </template>
        </el-table-column>
        <el-table-column label="Duration" width="100">
          <template slot-scope="{ row }">{{ formatDuration(row.duration_secs) }}</template>
        </el-table-column>
        <el-table-column label="Date" width="160">
          <template slot-scope="{ row }">{{ formatDate(row.ended_at) }}</template>
        </el-table-column>
      </el-table>
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
  first_star: { label: 'First Star', desc: 'Got first correct answer', type: '' },
  perfect_round: { label: 'Perfect Round', desc: '5/5 correct in one round', type: 'success' },
  no_hints: { label: 'No Hints', desc: 'Completed round without hints', type: 'success' },
  streak_3: { label: '3-Day Streak', desc: 'Played 3 days in a row', type: 'warning' },
  streak_7: { label: '7-Day Streak', desc: 'Played 7 days in a row', type: 'warning' },
  streak_14: { label: '14-Day Streak', desc: 'Played 14 days in a row', type: 'warning' },
  streak_30: { label: '30-Day Streak', desc: 'Played 30 days in a row', type: 'danger' },
  streak_100: { label: '100-Day Streak', desc: 'Played 100 days in a row', type: 'danger' },
  streak_5_game: { label: '5 Streak', desc: '5 correct in a row', type: '' },
  streak_10_game: { label: '10 Streak', desc: '10 correct in a row', type: 'success' },
  level_5: { label: 'Level 5', desc: 'Reached level 5', type: '' },
  level_10: { label: 'Level 10', desc: 'Reached level 10', type: 'success' },
  level_25: { label: 'Level 25', desc: 'Reached level 25', type: 'warning' },
  level_50: { label: 'Level 50', desc: 'Reached level 50', type: 'danger' },
  level_100: { label: 'Level 100', desc: 'Reached level 100', type: 'danger' },
  persistence_10: { label: '10 Sessions', desc: 'Played 10 sessions', type: '' },
  persistence_50: { label: '50 Sessions', desc: 'Played 50 sessions', type: 'success' },
  persistence_100: { label: '100 Sessions', desc: 'Played 100 sessions', type: 'warning' },
  questions_100: { label: '100 Questions', desc: 'Answered 100 questions', type: '' },
  questions_500: { label: '500 Questions', desc: 'Answered 500 questions', type: 'success' },
  questions_1000: { label: '1000 Questions', desc: 'Answered 1000 questions', type: 'warning' },
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
          groups[key] = {
            game_type: s.game_type,
            level: s.level_before,
            attempts: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            cleared: false,
          }
        }
        groups[key].attempts += 1
        groups[key].totalCorrect += s.correct_answers || 0
        groups[key].totalQuestions += s.questions_asked || 0
        if (s.level_after > s.level_before) groups[key].cleared = true
      })
      return Object.values(groups)
        .map(g => ({
          ...g,
          accuracy: g.totalQuestions > 0
            ? Math.round((g.totalCorrect / g.totalQuestions) * 100) : 0
        }))
        .sort((a, b) => a.game_type.localeCompare(b.game_type) || a.level - b.level)
    }
  },
  watch: {
    kidId: {
      immediate: true,
      handler(val) {
        if (val) this.fetchAll()
      }
    }
  },
  methods: {
    fetchAll() {
      this.loading = true
      let pending = 4
      const done = () => { pending--; if (pending <= 0) this.loading = false }

      Api.game.getProgress(this.kidId, (res) => {
        this.progressList = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : [])
        done()
      })
      Api.game.getStreak(this.kidId, (res) => {
        this.streak = res.data || null
        done()
      })
      Api.game.getAchievements(this.kidId, (res) => {
        this.achievements = Array.isArray(res.data) ? res.data : []
        done()
      })
      Api.game.getSessions(this.kidId, (res) => {
        this.sessions = Array.isArray(res.data) ? res.data : []
        done()
      })
    },
    gameName(type) { return GAME_NAMES[type] || type },
    gameIcon(type) { return GAME_ICONS[type] || '🎮' },
    accuracy(p) {
      if (!p.total_questions) return 0
      return Math.round((p.total_correct / p.total_questions) * 100)
    },
    achievementLabel(code) {
      return (ACHIEVEMENT_MAP[code] || {}).label || code.replace(/_/g, ' ')
    },
    achievementDesc(code) {
      return (ACHIEVEMENT_MAP[code] || {}).desc || code
    },
    achievementType(code) {
      return (ACHIEVEMENT_MAP[code] || {}).type || ''
    },
    formatDuration(secs) {
      if (!secs) return '-'
      const m = Math.floor(secs / 60)
      const s = secs % 60
      return m > 0 ? `${m}m ${s}s` : `${s}s`
    },
    formatDate(dt) {
      if (!dt) return '-'
      return new Date(dt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
    }
  }
}
</script>

<style scoped lang="scss">
.kid-game-progress {
  padding: 16px 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  .stat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-weight: 600;
    .game-icon { font-size: 20px; }
    .game-name { font-size: 14px; color: #1E1E1E; }
  }
  .stat-body {
    display: flex;
    justify-content: space-between;
  }
  .stat-item {
    text-align: center;
    .stat-value { font-size: 20px; font-weight: 700; color: #FF9100; display: block; }
    .stat-label { font-size: 11px; color: #6F6F6F; }
  }
}

.streak-section {
  margin-bottom: 16px;
}

.achievements-section {
  margin-bottom: 16px;
  h4 { margin: 0 0 8px; font-size: 13px; color: #6F6F6F; }
}

.achievement-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.achievement-tag {
  cursor: default;
}

.achievement-locked {
  opacity: 0.5;
  border-style: dashed;
}

.level-history-section {
  margin-bottom: 16px;
  h4 { margin: 0 0 8px; font-size: 13px; color: #6F6F6F; }
}

.sessions-section {
  h4 { margin: 0 0 8px; font-size: 13px; color: #6F6F6F; }
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: #ccc;
  p { margin-top: 8px; }
}
</style>
