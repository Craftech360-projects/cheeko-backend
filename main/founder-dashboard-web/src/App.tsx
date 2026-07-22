import { useDeferredValue, useEffect, useState, type ReactNode } from 'react'
import './App.css'

type RangeOption = 'today' | '7d' | '30d' | '90d' | 'month'
type NavPage =
  | 'overview'
  | 'engagement'
  | 'content'
  | 'conversations'
  | 'families'
  | 'costs'
  | 'operate'
  | 'rfidStudio'
  | 'contentLibrary'
  | 'settings'

type SearchResult = {
  type: 'kid' | 'parent' | 'device'
  id: string
  label: string
  subtitle?: string | null
  parentName?: string | null
  toyCount?: number
  macAddress?: string
}

type OverviewResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    activeToysToday: { total: number; fleetTotal: number; sparkline: number[] }
    playTimeHours: { total: number; sparkline: number[] }
    sessions: { total: number; sparkline: number[] }
    newFamilies: { total: number; sparkline: number[] }
    aiCostInr: { total: number; sparkline: number[] }
  }
  sections: {
    timeByFeature: {
      series: Array<{
        date: string
        aiTalkMinutes: number
        cardMinutes: number
        gameMinutes: number
        radioMinutes: number
      }>
    }
    todaysSplit: {
      totalMinutes: number
      items: Array<{ key: string; label: string; minutes: number }>
    }
    cardsKidsLove: {
      items: Array<{ name: string; taps: number; uniqueDevices: number; uniqueCards: number }>
    }
    gamesPlayedVsFinished: {
      items: Array<{
        name: string
        plays: number
        avgScore: number | null
        avgDurationMinutes: number
        completionRate: number | null
      }>
    }
    talkingAbout: {
      items: Array<{ topic: string; mentions: number }>
      samples: Array<{ summary: string; macAddress: string; updatedAt: string }>
    }
  }
}

type FamilyProfile = {
  kid: {
    id: string
    name: string
    nickname?: string | null
    grade?: string | null
    language?: string | null
    interests: string[]
    birthDate?: string | null
  }
  parent: { displayName?: string | null }
  devices: Array<{
    id: string
    macAddress: string
    alias: string
    appVersion?: string | null
    lastConnectedAt?: string | null
    online: boolean
    battery: number | null
    firmware?: string | null
    lastSeenAt?: string | null
  }>
  quota: {
    monthKey?: string | null
    questionsUsed: number
    extraPurchased: number
  }
  progress: Array<{
    modeType: string
    totalSessions: number
    totalTimeSeconds: number
    longestStreak: number
  }>
  recentSummaries: Array<{
    summary: string
    macAddress: string
    updatedAt: string
  }>
  contentLove: {
    cards: Array<{ name: string; taps: number; uniqueDevices: number; uniqueCards: number }>
    games: Array<{
      name: string
      plays: number
      avgScore: number | null
      avgDurationMinutes: number
      completionRate: number | null
    }>
  }
}

type EngagementResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    activeYesterday: number
    weeklyActives: number
    monthlyActives: number
    fleetTotal: number
    dauMauRatio: number
    avgSessionMinutes: number
  }
  sections: {
    dailyActives: Array<{ date: string; activeDevices: number; average: number }>
    returningSplit: {
      currentWeekActives: number
      previousWeekActives: number
      returnedCount: number
      returnedRate: number
      newCount: number
    }
    sessionsByHour: Array<{ hour: number; sessions: number }>
    sessionsHeatmap: Array<{
      day: string
      hours: Array<{ hour: number; sessions: number }>
    }>
    quietDevices: Array<{
      macAddress: string
      alias: string
      kidName: string | null
      parentName: string | null
      quietDays: number | null
      lastSeenAt: string | null
    }>
  }
}

type ContentResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    cardTaps: number
    cardsInUse: number
    catalogTotal: number
    gamePlays: number
    avgCompletionRate: number
    mediaPlays: number
  }
  sections: {
    packLeaderboard: Array<{
      name: string
      taps: number
      uniqueDevices: number
      uniqueCards: number
      repeatRate: number
    }>
    games: Array<{
      name: string
      plays: number
      completionRate: number | null
      avgScore: number | null
      status: string
    }>
    media: Array<{ title: string; type: string; plays: number }>
    radio: Array<{ station: string; minutes: number }>
    unresolvedTapCount: number
  }
}

type ConversationsResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    talkHours: number
    talkSessions: number
    avgTurnsPerSession: number
    topicsDetected: number
    moderationFlags: number
    screenedMessages: number
  }
  sections: {
    topics: Array<{ topic: string; mentions: number }>
    summaries: Array<{
      id: string
      macAddress: string
      headline: string
      summary: string
      tags: string[]
      turns: number
      updatedAt: string
    }>
    transcriptPreview: {
      macAddress: string
      title: string
      lines: Array<{ speaker: string; text: string }>
    } | null
  }
}

type CostsResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    totalCost: number
    projectedMonth: number
    monthlyBudget: number
    budgetUsedPercent: number
    perActiveToyPerDay: number
    perSession: number
    avgResponseTimeSeconds: number
  }
  sections: {
    dailySpend: Array<{ date: string; total: number; inputCost: number; outputCost: number }>
    tokenMix: {
      outputAudio: number
      inputAudio: number
      text: number
    }
    topDevices: Array<{
      macAddress: string
      sessions: number
      talkTimeSeconds: number
      totalTokens: number
      cost: number
      kidName: string | null
      parentName: string | null
      talkHours: number
      fleetSharePercent: number
    }>
  }
}

type OperateResponse = {
  generatedAt: string
  kpis: {
    fleetSize: number
    onlineNow: number
    latestFirmwarePercent: number
    avgBattery: number
    deviceErrors7d: number
  }
  sections: {
    firmwareCoverage: Array<{
      version: string
      count: number
      percent: number
      isLatest: boolean
    }>
    otaRollout: {
      version: string
      forceUpdate: boolean
      updatedCount: number
      fleetSize: number
      percent: number
    } | null
    watchlist: Array<{
      macAddress: string
      alias: string
      issue: string
      severity: string
      since: string | null
    }>
    recentEvents: Array<{
      source: string
      macAddress: string
      title: string
      detail: string
      severity: string
      createdAt: string
    }>
  }
}

type RfidCardMapping = {
  id: number
  rfidUid: string
  actionType?: string | null
  cardType?: string | null
  questionPackId?: number | null
  questionPackName?: string | null
  contentPackId?: number | null
  packCode?: string | null
  active?: boolean
}

type RfidContentPack = {
  id: number
  packCode: string
  name: string
  description?: string | null
  thumbnailUrl?: string | null
  contentType?: string | null
  language?: string | null
  status?: string | null
  version?: number | null
  items?: Array<{
    title?: string | null
    audioUrl?: string | null
    imageUrl?: string | null
    text?: string | null
  }>
  totalItems?: number | null
  active?: boolean
}

const API_BASE_URL = import.meta.env.VITE_MANAGER_API_BASE_URL || '/toy'
const AUTH_STORAGE_KEY = 'founder_dashboard_token'

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function extractTokenCandidate(rawValue: string | null) {
  if (!rawValue) return ''
  try {
    const parsed = JSON.parse(rawValue) as { token?: string }
    return parsed?.token || rawValue
  } catch {
    return rawValue
  }
}

function loadStoredToken() {
  const preferred = extractTokenCandidate(localStorage.getItem(AUTH_STORAGE_KEY))
  if (preferred) return preferred
  return extractTokenCandidate(localStorage.getItem('token'))
}

async function apiFetch<T>(path: string, token: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  const payload = (await response.json()) as { code?: number; msg?: string; data?: T }
  if (!response.ok || (payload.code !== 0 && payload.code !== undefined)) {
    throw new ApiError(payload.msg || 'Request failed', response.status)
  }
  return payload.data as T
}

async function apiFetchPublic<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  const payload = (await response.json()) as { code?: number; msg?: string; data?: T }
  if (!response.ok || (payload.code !== 0 && payload.code !== undefined)) {
    throw new ApiError(payload.msg || 'Request failed', response.status)
  }
  return payload.data as T
}

function formatCompactDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatHours(total: number) {
  return `${total.toFixed(1)} hrs`
}

function formatMinutes(total: number) {
  return `${total.toFixed(1)} min`
}

function formatMoney(total: number) {
  return `₹${total.toFixed(2)}`
}

function getAge(birthDate?: string | null) {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <div className="sparkline sparkline-empty" />
  const width = 220
  const height = 42
  const max = Math.max(...values, 1)
  const pointPairs = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width
      const y = height - (value / max) * (height - 8) - 3
      return { x, y }
    })
  const smoothPath = pointPairs.reduce((path, point, index, array) => {
    if (index === 0) return `M ${point.x} ${point.y}`
    const previous = array[index - 1]
    const controlX = (previous.x + point.x) / 2
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`
  }, '')
  const smoothAreaPath = `${smoothPath} L ${width} ${height} L 0 ${height} Z`
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path className="sparkline-area" d={smoothAreaPath} />
      <path
        d={smoothPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StackedUsageChart({
  series,
}: {
  series: OverviewResponse['sections']['timeByFeature']['series']
}) {
  if (!series.length) return <div className="empty-state">No activity yet for this range.</div>
  const maxTotal = Math.max(
    ...series.map((item) => item.aiTalkMinutes + item.cardMinutes + item.gameMinutes + item.radioMinutes),
    1,
  )
  return (
    <div className="stacked-usage-chart">
      {series.map((item) => {
        const total = item.aiTalkMinutes + item.cardMinutes + item.gameMinutes + item.radioMinutes
        return (
          <div key={item.date} className="stacked-day">
            <div className="stacked-column">
              <span className="segment ai" style={{ height: `${(item.aiTalkMinutes / maxTotal) * 180}px` }} />
              <span className="segment cards" style={{ height: `${(item.cardMinutes / maxTotal) * 180}px` }} />
              <span className="segment games" style={{ height: `${(item.gameMinutes / maxTotal) * 180}px` }} />
              <span className="segment radio" style={{ height: `${(item.radioMinutes / maxTotal) * 180}px` }} />
            </div>
            <div className="stacked-day-total">{Math.round(total)}</div>
            <div className="stacked-day-label">{formatCompactDate(item.date)}</div>
          </div>
        )
      })}
    </div>
  )
}

function CostsSpendChart({
  items,
}: {
  items: CostsResponse['sections']['dailySpend']
}) {
  if (!items.length) return <div className="empty-state">No spend yet for this range.</div>

  const max = Math.max(...items.map((item) => item.total), 1)
  const tickIndexes = Array.from(new Set([0, Math.floor((items.length - 1) / 2), items.length - 1]))

  return (
    <div className="cost-spend-chart">
      <div className="cost-spend-legend">
        <span><i className="legend-dot ai" /> output (audio + text)</span>
        <span><i className="legend-dot cards" /> input (audio + text)</span>
      </div>
      <div className="cost-spend-shell">
        <div className="cost-spend-grid-line top" />
        <div className="cost-spend-grid-line middle" />
        <div className="cost-spend-columns">
          {items.map((item, index) => (
            <div key={item.date} className="cost-spend-day">
              <div className="cost-spend-bar">
                <span className="cost-spend-segment input" style={{ height: `${(item.inputCost / max) * 138}px` }} />
                <span className="cost-spend-segment output" style={{ height: `${(item.outputCost / max) * 138}px` }} />
              </div>
              {tickIndexes.includes(index) ? <div className="cost-spend-label">{formatCompactDate(item.date)}</div> : <div className="cost-spend-label ghost" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EngagementTrendChart({
  items,
}: {
  items: EngagementResponse['sections']['dailyActives']
}) {
  if (!items.length) return <div className="empty-state">No activity yet for this range.</div>
  const width = 640
  const height = 210
  const left = 8
  const right = 12
  const top = 18
  const bottom = 168
  const chartHeight = bottom - top
  const chartWidth = width - left - right
  const max = Math.max(...items.map((item) => Math.max(item.activeDevices, item.average)), 1)
  const x = (index: number) => left + (index / Math.max(items.length - 1, 1)) * chartWidth
  const y = (value: number) => bottom - (value / max) * chartHeight
  const buildSmoothPath = (values: number[]) =>
    values.reduce((path, value, index) => {
      const px = x(index)
      const py = y(value)
      if (index === 0) return `M ${px} ${py}`
      const prevX = x(index - 1)
      const prevY = y(values[index - 1])
      const controlX = (prevX + px) / 2
      return `${path} C ${controlX} ${prevY}, ${controlX} ${py}, ${px} ${py}`
    }, '')
  const activeValues = items.map((item) => item.activeDevices)
  const averageValues = items.map((item) => item.average)
  const activePath = buildSmoothPath(activeValues)
  const avgPath = buildSmoothPath(averageValues)
  const activeArea = `${activePath} L ${x(items.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`
  const ticks = Array.from(new Set([0, Math.floor((items.length - 1) / 2), items.length - 1]))

  return (
    <div className="engagement-trend">
      <div className="engagement-chart-legend">
        <span><i className="legend-dot ai" /> daily actives</span>
        <span><i className="legend-dot neutral" /> 7-day avg</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="engagement-chart-svg" aria-hidden="true">
        <line x1={left} y1={top + chartHeight * 0.25} x2={width - right} y2={top + chartHeight * 0.25} className="usage-grid-line" />
        <line x1={left} y1={top + chartHeight * 0.55} x2={width - right} y2={top + chartHeight * 0.55} className="usage-grid-line" />
        <path d={activeArea} className="engagement-area" />
        <path d={avgPath} className="engagement-average-line" />
        <path d={activePath} className="engagement-active-line" />
        <text x={width - right} y={y(activeValues[activeValues.length - 1]) - 10} textAnchor="end" className="engagement-end-label">
          {items[items.length - 1]?.activeDevices} yesterday
        </text>
        {ticks.map((index) => (
          <text key={items[index].date} x={x(index)} y="196" textAnchor={index === 0 ? 'start' : index === items.length - 1 ? 'end' : 'middle'} className="usage-axis-label">
            {formatCompactDate(items[index].date)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function SessionsHeatmap({
  rows,
}: {
  rows: EngagementResponse['sections']['sessionsHeatmap']
}) {
  const max = Math.max(...rows.flatMap((row) => row.hours.map((hour) => hour.sessions)), 1)

  return (
    <div className="heatmap-shell">
      <div className="heatmap-grid">
        {rows.map((row) => (
          <div key={row.day} className="heatmap-row">
            <div className="heatmap-day">{row.day}</div>
            <div className="heatmap-cells">
              {row.hours.map((cell) => {
                const intensity = cell.sessions / max
                return (
                  <span
                    key={`${row.day}-${cell.hour}`}
                    className="heatmap-cell"
                    style={{
                      background: intensity > 0
                        ? `rgba(255, 152, 41, ${0.14 + intensity * 0.68})`
                        : 'rgba(255, 226, 194, 0.38)',
                    }}
                    title={`${row.day} ${String(cell.hour).padStart(2, '0')}:00 · ${cell.sessions} sessions`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="heatmap-axis">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  )
}

function Sidebar({
  activePage,
  onChange,
}: {
  activePage: NavPage
  onChange: (next: NavPage) => void
}) {
  const nav = [
    {
      title: '',
      items: [
        { key: 'overview', label: 'Overview', static: false },
        { key: 'engagement', label: 'Engagement', static: false },
        { key: 'content', label: 'Content & Games', static: false },
        { key: 'conversations', label: 'Conversations', static: false },
        { key: 'families', label: 'Families', static: false },
        { key: 'costs', label: 'Costs', static: false },
      ],
    },
    {
      title: 'Operate',
      items: [
        { key: 'operate', label: 'Fleet & OTA', static: false },
        { key: 'rfidStudio', label: 'RFID Studio', static: false },
        { key: 'contentLibrary', label: 'Content Library', static: false },
        { key: 'settings', label: 'Settings', static: false },
      ],
    },
  ] as const

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <strong>Cheeko</strong>
        </div>
      </div>

      {nav.map((group) => (
        <div key={group.title} className="sidebar-group">
          {group.title ? <div className="sidebar-group-title">{group.title}</div> : null}
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === activePage ? 'nav-link active' : 'nav-link'}
              onClick={() => onChange(item.key as NavPage)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}

      <div className="sidebar-footer">
        <div className="avatar">FD</div>
        <div>
          <strong>Ravi · Founder</strong>
        </div>
      </div>
    </aside>
  )
}

function LoginPanel({
  username,
  password,
  loading,
  error,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string
  password: string
  loading: boolean
  error: string
  onUsernameChange: (next: string) => void
  onPasswordChange: (next: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="login-screen">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark">C</div>
          <strong>Cheeko</strong>
        </div>
        <h2>Sign in</h2>
        <p>Use your manager admin credentials to open the founder dashboard.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="login-grid">
          <input type="text" placeholder="Username" value={username} onChange={(event) => onUsernameChange(event.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
        </div>
        <div className="token-row">
          <button type="button" onClick={onSubmit} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  caption,
  sparkline,
}: {
  label: string
  value: string
  caption: string
  sparkline: number[]
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-caption">{caption}</div>
      <Sparkline values={sparkline} />
    </article>
  )
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  children?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {children}
    </header>
  )
}

function RangeToggle({
  value,
  options,
  onChange,
}: {
  value: RangeOption
  options: RangeOption[]
  onChange: (next: RangeOption) => void
}) {
  return (
    <div className="range-toggle">
      {options.map((item) => (
        <button
          key={item}
          type="button"
          className={item === value ? 'range-pill active' : 'range-pill'}
          onClick={() => onChange(item)}
        >
          {item === 'today'
            ? 'Today'
            : item === '7d'
              ? '7 days'
              : item === '30d'
                ? '30 days'
                : item === '90d'
                  ? '90 days'
                  : 'This month'}
        </button>
      ))}
    </div>
  )
}

function OverviewPage({
  range,
  overview,
  engagement,
  costs,
  operate,
  loading,
  onRangeChange,
}: {
  range: RangeOption
  overview: OverviewResponse | null
  engagement: EngagementResponse | null
  costs: CostsResponse | null
  operate: OperateResponse | null
  loading: boolean
  onRangeChange: (next: RangeOption) => void
}) {
  const generatedAt = overview?.generatedAt ? formatLongDate(overview.generatedAt) : formatLongDate(new Date().toISOString())
  const quietCount = engagement?.sections.quietDevices.length || 0
  const responseTime = costs?.kpis.avgResponseTimeSeconds || 0
  const outdatedFirmwareCount = operate?.sections.firmwareCoverage
    .filter((item) => !item.isLatest)
    .reduce((sum, item) => sum + item.count, 0) || 0

  return (
    <div className="page">
      <PageHeader eyebrow="" title="Overview" subtitle={generatedAt}>
        <RangeToggle value={range} options={['today', '7d', '30d']} onChange={onRangeChange} />
      </PageHeader>

      {loading && !overview ? <div className="loading-card">Loading founder overview…</div> : null}

      {overview ? (
        <>
          <section className="stat-grid">
            <StatCard
              label="Active toys"
              value={`${overview.kpis.activeToysToday.total}/${overview.kpis.activeToysToday.fleetTotal}`}
              caption="Online or recently active"
              sparkline={overview.kpis.activeToysToday.sparkline}
            />
            <StatCard
              label="Play time"
              value={formatHours(overview.kpis.playTimeHours.total)}
              caption="Fleet usage in selected range"
              sparkline={overview.kpis.playTimeHours.sparkline}
            />
            <StatCard
              label="Sessions"
              value={String(overview.kpis.sessions.total)}
              caption="Tracked fleet sessions"
              sparkline={overview.kpis.sessions.sparkline}
            />
            <StatCard
              label="New families"
              value={String(overview.kpis.newFamilies.total)}
              caption="Recent registrations"
              sparkline={overview.kpis.newFamilies.sparkline}
            />
            <StatCard
              label="AI cost"
              value={formatMoney(overview.kpis.aiCostInr.total)}
              caption="Estimated spend"
              sparkline={overview.kpis.aiCostInr.sparkline}
            />
          </section>

          <section className="panel-grid panel-grid-wide">
            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>Where kids spend time</h2>
                  <p>AI talk, cards, games, and radio across the selected period.</p>
                </div>
                <div className="legend">
                  <span className="legend-pill ai">AI Talk</span>
                  <span className="legend-pill cards">Cards</span>
                  <span className="legend-pill games">Games</span>
                  <span className="legend-pill radio">Radio</span>
                </div>
              </div>
              <StackedUsageChart series={overview.sections.timeByFeature.series} />
            </article>

            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>Today&apos;s split</h2>
                  <p>{formatMinutes(overview.sections.todaysSplit.totalMinutes)} total</p>
                </div>
              </div>
              <div className="split-bar">
                {overview.sections.todaysSplit.items.map((item) => (
                  <span
                    key={item.key}
                    className={`split-segment ${item.key === 'aiTalk' ? 'ai' : item.key}`}
                    style={{
                      width: `${overview.sections.todaysSplit.totalMinutes > 0
                        ? (item.minutes / overview.sections.todaysSplit.totalMinutes) * 100
                        : 0}%`,
                    }}
                  />
                ))}
              </div>
              <div className="split-list">
                {overview.sections.todaysSplit.items.map((item) => (
                  <div key={item.key} className="split-list-item">
                    <span className={`split-dot ${item.key === 'aiTalk' ? 'ai' : item.key}`} />
                    <span>{item.label}</span>
                    <strong>{formatMinutes(item.minutes)}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="panel-grid panel-grid-three">
            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>Cards kids love</h2>
                  <p>Top packs by taps and unique toys.</p>
                </div>
              </div>
              <div className="leaderboard">
                {overview.sections.cardsKidsLove.items.map((item, index) => (
                  <div key={item.name} className="leaderboard-item">
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.uniqueDevices} toys • {item.uniqueCards} cards</span>
                    </div>
                    <strong>{item.taps} taps</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>Games: played vs finished</h2>
                  <p>Current fleet signal from real play rows.</p>
                </div>
              </div>
              <div className="leaderboard">
                {overview.sections.gamesPlayedVsFinished.items.map((item, index) => (
                  <div key={item.name} className="leaderboard-item compact">
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.avgScore !== null ? `Avg score ${item.avgScore}` : 'No score yet'} • {item.avgDurationMinutes} min</span>
                    </div>
                    <strong>{item.plays} plays</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>What kids are talking about</h2>
                  <p>Topic hints from recent session summaries.</p>
                </div>
              </div>
              <div className="topic-wrap">
                {overview.sections.talkingAbout.items.map((item) => (
                  <span key={item.topic} className="topic-chip">
                    {item.topic} <strong>{item.mentions}</strong>
                  </span>
                ))}
              </div>
              <div className="quote-stack">
                {overview.sections.talkingAbout.samples.map((sample) => (
                  <blockquote key={`${sample.macAddress}-${sample.updatedAt}`} className="quote-card">
                    <p>{sample.summary}</p>
                    <footer>{sample.macAddress}</footer>
                  </blockquote>
                ))}
              </div>
            </article>
          </section>

          <section className="alert-grid">
            <article className="alert-card amber">
              <strong>{quietCount} toys have gone quiet (7+ days)</strong>
              <p>
                {quietCount
                  ? 'Worth a parent nudge. The full watchlist is one click away in Engagement.'
                  : 'No quiet-toy alert right now.'}
              </p>
            </article>
            <article className="alert-card rose">
              <strong>Average response time is {responseTime.toFixed(2)}s</strong>
              <p>
                This mirrors the costs view so latency shifts are visible directly from the overview.
              </p>
            </article>
            <article className="alert-card blue">
              <strong>{outdatedFirmwareCount} toys are behind latest firmware</strong>
              <p>
                Fleet coverage comes from Operate, surfaced here so firmware drag shows up in the daily pulse.
              </p>
            </article>
          </section>
        </>
      ) : null}
    </div>
  )
}

function EngagementPage({
  range,
  data,
  loading,
  onRangeChange,
}: {
  range: RangeOption
  data: EngagementResponse | null
  loading: boolean
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Engagement"
        subtitle={data?.generatedAt ? formatLongDate(data.generatedAt) : 'Retention and returning usage patterns'}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </PageHeader>
      {loading && !data ? <div className="loading-card">Loading engagement view…</div> : null}
      {data ? (
        <>
          <section className="stat-grid">
            <StatCard label="Active Yesterday" value={String(data.kpis.activeYesterday)} caption="▲ founder live usage signal" sparkline={data.sections.dailyActives.map((item) => item.activeDevices)} />
            <StatCard label="Weekly Actives" value={String(data.kpis.weeklyActives)} caption={`▲ ${data.sections.returningSplit.newCount} toys vs prior week`} sparkline={data.sections.dailyActives.map((item) => item.activeDevices)} />
            <StatCard label="Monthly Actives" value={`${data.kpis.monthlyActives}/${data.kpis.fleetTotal}`} caption={`${Math.round((data.kpis.monthlyActives / Math.max(data.kpis.fleetTotal, 1)) * 100)}% of fleet alive`} sparkline={data.sections.dailyActives.map((item) => item.average)} />
            <StatCard label="Stickiness · DAU/MAU" value={`${data.kpis.dauMauRatio}%`} caption="Retention snapshot" sparkline={data.sections.dailyActives.map((item) => item.average)} />
            <StatCard label="Avg Session" value={formatMinutes(data.kpis.avgSessionMinutes)} caption="Average tracked session" sparkline={data.sections.sessionsByHour.map((item) => item.sessions)} />
          </section>

          <section className="panel-grid panel-grid-wide">
            <article className="panel-card engagement-main-card">
              <div className="panel-header">
                <div>
                  <h2>Daily active toys · last {range === '90d' ? '90' : range === '7d' ? '7' : '30'} days</h2>
                  <p>bold line = 7-day average</p>
                </div>
              </div>
              <EngagementTrendChart items={data.sections.dailyActives} />
            </article>

            <article className="panel-card engagement-return-card">
              <div className="panel-header">
                <div>
                  <h2>Coming back?</h2>
                  <p>this week vs last week&apos;s {data.sections.returningSplit.previousWeekActives} actives</p>
                </div>
              </div>
              <div className="engagement-return-track">
                <span className="engagement-return-fill" style={{ width: `${data.sections.returningSplit.returnedRate}%` }} />
                <span className="engagement-return-gap" style={{ width: `${Math.max(0, 100 - data.sections.returningSplit.returnedRate)}%` }} />
              </div>
              <div className="engagement-return-list">
                <div className="engagement-return-item">
                  <span><i className="legend-dot games" /> Returned this week</span>
                  <strong>{data.sections.returningSplit.returnedCount} toys · {data.sections.returningSplit.returnedRate}%</strong>
                </div>
                <div className="engagement-return-item">
                  <span><i className="legend-dot neutral" /> Didn&apos;t return</span>
                  <strong>{Math.max(0, data.sections.returningSplit.previousWeekActives - data.sections.returningSplit.returnedCount)} toys</strong>
                </div>
                <div className="engagement-return-item">
                  <span><i className="legend-dot cards" /> New this week</span>
                  <strong>{data.sections.returningSplit.newCount} toys</strong>
                </div>
              </div>
              <p className="split-note">Returning rate and new-toy mix together give the founder read on retention vs growth.</p>
            </article>
          </section>

          <section className="panel-grid panel-grid-two">
            <article className="panel-card engagement-heatmap-card">
              <div className="panel-header">
                <div>
                  <h2>When kids play · sessions by hour</h2>
                  <p>last 7 days · IST · darker = more sessions</p>
                </div>
              </div>
              <SessionsHeatmap rows={data.sections.sessionsHeatmap} />
              <p className="split-note">This shows when engagement clusters through the day so content timing decisions are obvious.</p>
            </article>

            <article className="panel-card engagement-watchlist-card">
              <div className="panel-header">
                <div>
                  <h2>Quiet toys watchlist</h2>
                  <p>active earlier, silent 7+ days</p>
                </div>
              </div>
              {data.sections.quietDevices.length ? (
                <div className="watchlist-table">
                  <div className="watchlist-head">
                    <span>Toy / kid</span>
                    <span>Parent</span>
                    <span>Quiet for</span>
                  </div>
                  {data.sections.quietDevices.slice(0, 8).map((item) => (
                    <div key={item.macAddress} className="watchlist-row">
                      <span>{item.kidName || item.alias}</span>
                      <span>{item.parentName || item.macAddress}</span>
                      <strong>{item.quietDays} days</strong>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state">No quiet toys in the current watchlist.</div>}
              <p className="split-note">This list is the most actionable retention cut: devices that used to engage but have gone quiet.</p>
            </article>
          </section>
        </>
      ) : null}
    </div>
  )
}

function ContentPage({
  range,
  data,
  loading,
  onRangeChange,
}: {
  range: RangeOption
  data: ContentResponse | null
  loading: boolean
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Content & Games"
        subtitle={data?.generatedAt ? formatLongDate(data.generatedAt) : 'Card packs, games, stories, and stations ranked by behavior'}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </PageHeader>
      {loading && !data ? <div className="loading-card">Loading content view…</div> : null}
      {data ? (
        <>
          <section className="stat-grid">
            <StatCard label="Card taps" value={String(data.kpis.cardTaps)} caption="▲ live content usage" sparkline={data.sections.packLeaderboard.map((item) => item.taps)} />
            <StatCard label="Cards in use" value={`${data.kpis.cardsInUse}/${data.kpis.catalogTotal}`} caption={`${data.kpis.catalogTotal ? Math.round((data.kpis.cardsInUse / data.kpis.catalogTotal) * 100) : 0}% of catalog got played`} sparkline={data.sections.packLeaderboard.map((item) => item.uniqueDevices)} />
            <StatCard label="Game plays" value={String(data.kpis.gamePlays)} caption="▲ tracked play activity" sparkline={data.sections.games.map((item) => item.plays)} />
            <StatCard label="Avg completion" value={`${data.kpis.avgCompletionRate}%`} caption="kids finish signal" sparkline={data.sections.games.map((item) => item.completionRate || 0)} />
            <StatCard label="Story & music plays" value={String(data.kpis.mediaPlays)} caption="media slot activity" sparkline={data.sections.radio.map((item) => item.minutes)} />
          </section>

          <section className="panel-card content-wide-card">
            <div className="panel-header">
              <div>
                <h2>Card packs — ranked by love</h2>
                <p>taps · unique toys · repeat rate (taps per toy)</p>
              </div>
            </div>
            <div className="content-pack-table">
              <div className="content-pack-head">
                <span>Pack</span>
                <span>Taps · 7d</span>
                <span>Toys</span>
                <span>Repeat rate</span>
              </div>
              {data.sections.packLeaderboard.map((item) => (
                <div key={item.name} className="content-pack-row">
                  <span>{item.name}</span>
                  <span>{item.taps}</span>
                  <span>{item.uniqueDevices}</span>
                  <span>{item.repeatRate}×</span>
                </div>
              ))}
              <div className="content-pack-row subtle">
                <span>Unresolved cards</span>
                <span>{data.sections.unresolvedTapCount}</span>
                <span>--</span>
                <span>fix mappings</span>
              </div>
            </div>
          </section>

          <section className="content-bottom-grid">
            <article className="panel-card content-games-card">
              <div className="panel-header">
                <div>
                  <h2>Games — played vs finished</h2>
                  <p>completion is the strongest dislike signal we have</p>
                </div>
              </div>
              <div className="content-games-table">
                <div className="content-games-head">
                  <span>Game</span>
                  <span>Plays</span>
                  <span>Completion</span>
                  <span>Status</span>
                </div>
                {data.sections.games.map((item) => (
                  <div key={item.name} className="content-games-row">
                    <span>{item.name}</span>
                    <span>{item.plays}</span>
                    <span>
                      <span className="content-meter"><i style={{ width: `${item.completionRate ?? 0}%` }} /></span>
                    </span>
                    <strong>{item.completionRate ?? 0}% · {item.status}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel-card content-side-card">
              <div className="panel-header">
                <div>
                  <h2>Stories, music & radio</h2>
                  <p>most played in the current window</p>
                </div>
              </div>
              <div className="content-media-list">
                {data.sections.media.map((item) => (
                  <div key={item.title} className="content-media-item">
                    <span>{item.title} <small>· {item.type}</small></span>
                    <strong>{item.plays} plays</strong>
                  </div>
                ))}
                {data.sections.radio.map((item) => (
                  <div key={item.station} className="content-media-item radio">
                    <span>{item.station} <small>· radio</small></span>
                    <strong>{Math.round(item.minutes)} min</strong>
                  </div>
                ))}
              </div>
              <div className="content-losing-steam">
                <h3>Losing steam</h3>
                <div className="content-media-item muted">
                  <span>Unresolved cards</span>
                  <strong>{data.sections.unresolvedTapCount}</strong>
                </div>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  )
}

function ConversationsPage({
  range,
  data,
  loading,
  onRangeChange,
}: {
  range: RangeOption
  data: ConversationsResponse | null
  loading: boolean
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Conversations"
        subtitle={data?.generatedAt ? formatLongDate(data.generatedAt) : 'Topics, summaries, and transcript preview'}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </PageHeader>
      {loading && !data ? <div className="loading-card">Loading conversations view…</div> : null}
      {data ? (
        <>
          <section className="stat-grid">
            <StatCard label="AI talk time" value={formatHours(data.kpis.talkHours)} caption="Across the selected range" sparkline={data.sections.topics.map((item) => item.mentions)} />
            <StatCard label="Talk sessions" value={String(data.kpis.talkSessions)} caption="Voice-session summaries found" sparkline={data.sections.summaries.map((item) => item.turns)} />
            <StatCard label="Avg turns" value={String(data.kpis.avgTurnsPerSession)} caption="Turns per session" sparkline={data.sections.summaries.map((item) => item.turns)} />
            <StatCard label="Topics detected" value={String(data.kpis.topicsDetected)} caption="Keyword mined from summaries" sparkline={data.sections.topics.map((item) => item.mentions)} />
            <StatCard label="Moderation flags" value={String(data.kpis.moderationFlags)} caption={`${data.kpis.screenedMessages} messages screened`} sparkline={[data.kpis.moderationFlags, data.kpis.screenedMessages]} />
          </section>

          <section className="panel-grid panel-grid-wide">
            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>What the fleet is talking about</h2>
                  <p>Topic size reflects mention count across session summaries.</p>
                </div>
              </div>
              <div className="topic-wrap">
                {data.sections.topics.map((item) => (
                  <span key={item.topic} className="topic-chip topic-chip-large">
                    {item.topic} <strong>{item.mentions}</strong>
                  </span>
                ))}
              </div>
            </article>

            <article className="panel-card">
              <div className="panel-header">
                <div>
                  <h2>Transcript preview</h2>
                  <p>Deep transcript stays in the existing admin chat drawer.</p>
                </div>
              </div>
              {data.sections.transcriptPreview ? (
                <div className="chat-stack">
                  <strong>{data.sections.transcriptPreview.title}</strong>
                  <span>{data.sections.transcriptPreview.macAddress}</span>
                  {data.sections.transcriptPreview.lines.map((line, index) => (
                    <div key={`${line.speaker}-${index}`} className="chat-bubble">
                      <strong>{line.speaker}</strong>
                      <p>{line.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No conversation preview available yet.</div>
              )}
            </article>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <div>
                <h2>Session summaries</h2>
                <p>Skim the fleet&apos;s day in a minute.</p>
              </div>
            </div>
            <div className="quote-stack">
              {data.sections.summaries.map((item) => (
                <blockquote key={item.id} className="quote-card">
                  <p>{item.summary}</p>
                  <footer>
                    {item.headline} • {item.turns} turns • {formatDateTime(item.updatedAt)}
                  </footer>
                </blockquote>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function FamiliesPage({
  searchTerm,
  onSearchTermChange,
  results,
  loadingSearch,
  selectedResult,
  onSelectResult,
  profile,
  loadingProfile,
}: {
  searchTerm: string
  onSearchTermChange: (next: string) => void
  results: { kids: SearchResult[]; parents: SearchResult[]; devices: SearchResult[] }
  loadingSearch: boolean
  selectedResult: SearchResult | null
  onSelectResult: (result: SearchResult) => void
  profile: FamilyProfile | null
  loadingProfile: boolean
}) {
  const age = getAge(profile?.kid.birthDate)
  const groupedResults = [
    { title: 'Kids', items: results.kids },
    { title: 'Parents', items: results.parents },
    { title: 'Devices', items: results.devices },
  ]

  return (
    <div className="page">
      <PageHeader eyebrow="" title="Families" subtitle="Use one search box for parents, kids, MAC addresses, and aliases." />

      <section className="search-shell">
        <input type="search" value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search Maya, Anita, AA:BB:CC or Maya Toy" />
        <span>{loadingSearch ? 'Searching…' : 'Live search'}</span>
      </section>

      <section className="families-layout">
        <aside className="results-panel">
          {groupedResults.map((group) => (
            <div key={group.title} className="results-group">
              <div className="results-title">{group.title}</div>
              {group.items.length ? (
                group.items.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    className={selectedResult?.id === item.id && selectedResult.type === item.type ? 'result-item active' : 'result-item'}
                    onClick={() => onSelectResult(item)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.parentName || item.subtitle || item.macAddress || 'Select to open profile'}</span>
                  </button>
                ))
              ) : (
                <div className="results-empty">No {group.title.toLowerCase()} yet.</div>
              )}
            </div>
          ))}
        </aside>

        <section className="profile-panel">
          {loadingProfile && !profile ? <div className="loading-card">Loading family profile…</div> : null}
          {!profile && !loadingProfile ? <div className="empty-state large">Choose a search result to open the Family 360 profile.</div> : null}

          {profile ? (
            <>
              <article className="profile-hero">
                <div>
                  <div className="eyebrow">Kid profile</div>
                  <h2>{profile.kid.name}</h2>
                  <p>
                    {age !== null ? `${age} years old` : 'Age unavailable'}
                    {profile.kid.grade ? ` • Grade ${profile.kid.grade}` : ''}
                    {profile.parent.displayName ? ` • Parent ${profile.parent.displayName}` : ''}
                  </p>
                </div>
                <div className="chip-row">
                  {(profile.kid.interests || []).map((interest) => (
                    <span key={interest} className="topic-chip">{interest}</span>
                  ))}
                </div>
              </article>

              <section className="panel-grid panel-grid-two">
                <article className="panel-card">
                  <div className="panel-header">
                    <div>
                      <h2>Toys and runtime status</h2>
                      <p>Latest runtime state from manager-api-node.</p>
                    </div>
                  </div>
                  <div className="device-stack">
                    {profile.devices.map((device) => (
                      <div key={device.id} className="device-card">
                        <div>
                          <strong>{device.alias}</strong>
                          <span>{device.macAddress}</span>
                        </div>
                        <div className="device-meta">
                          <span className={device.online ? 'status-pill online' : 'status-pill offline'}>{device.online ? 'Online' : 'Offline'}</span>
                          <span>Battery {device.battery ?? '--'}%</span>
                          <span>FW {device.firmware || device.appVersion || '--'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel-card">
                  <div className="panel-header">
                    <div>
                      <h2>Quota and progress</h2>
                      <p>Useful at-a-glance signals for this family.</p>
                    </div>
                  </div>
                  <div className="mini-stats">
                    <div className="mini-stat">
                      <span>Questions used</span>
                      <strong>{profile.quota.questionsUsed}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Extra purchased</span>
                      <strong>{profile.quota.extraPurchased}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Tracked modes</span>
                      <strong>{profile.progress.length}</strong>
                    </div>
                  </div>
                  <div className="leaderboard">
                    {profile.progress.map((item) => (
                      <div key={item.modeType} className="leaderboard-item compact">
                        <div>
                          <strong>{item.modeType}</strong>
                          <span>{Math.round(item.totalTimeSeconds / 60)} min total</span>
                        </div>
                        <strong>{item.totalSessions} sessions</strong>
                      </div>
                    ))}
                  </div>
                </article>
              </section>

              <section className="panel-grid panel-grid-two">
                <article className="panel-card">
                  <div className="panel-header">
                    <div>
                      <h2>What this kid loves</h2>
                      <p>Top cards and games tied to the family&apos;s devices.</p>
                    </div>
                  </div>
                  <div className="leaderboard dual">
                    {profile.contentLove.cards.map((item) => (
                      <div key={item.name} className="leaderboard-item compact">
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.uniqueDevices} toys</span>
                        </div>
                        <strong>{item.taps} taps</strong>
                      </div>
                    ))}
                    {profile.contentLove.games.map((item) => (
                      <div key={item.name} className="leaderboard-item compact">
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.avgDurationMinutes} min avg</span>
                        </div>
                        <strong>{item.plays} plays</strong>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel-card">
                  <div className="panel-header">
                    <div>
                      <h2>Recent conversation summaries</h2>
                      <p>Latest voice-session summaries across the family&apos;s toys.</p>
                    </div>
                  </div>
                  <div className="quote-stack">
                    {profile.recentSummaries.map((summary) => (
                      <blockquote key={`${summary.macAddress}-${summary.updatedAt}`} className="quote-card">
                        <p>{summary.summary}</p>
                        <footer>{summary.macAddress} • {formatCompactDate(summary.updatedAt)}</footer>
                      </blockquote>
                    ))}
                  </div>
                </article>
              </section>
            </>
          ) : null}
        </section>
      </section>
    </div>
  )
}

function CostsPage({
  range,
  data,
  loading,
  onRangeChange,
}: {
  range: RangeOption
  data: CostsResponse | null
  loading: boolean
  onRangeChange: (next: RangeOption) => void
}) {
  const tokenTotal = data
    ? data.sections.tokenMix.outputAudio + data.sections.tokenMix.inputAudio + data.sections.tokenMix.text
    : 0

  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Costs"
        subtitle={data?.generatedAt ? formatLongDate(data.generatedAt) : 'Budget pace, token mix, and top devices by spend'}
      >
        <RangeToggle value={range} options={['month', '30d', '90d']} onChange={onRangeChange} />
      </PageHeader>
      {loading && !data ? <div className="loading-card">Loading costs view…</div> : null}
      {data ? (
        <>
          <section className="stat-grid">
            <StatCard label="July so far" value={formatMoney(data.kpis.totalCost)} caption="Current spend" sparkline={data.sections.dailySpend.map((item) => item.total)} />
            <StatCard label="Projected month" value={formatMoney(data.kpis.projectedMonth)} caption={`Budget ${formatMoney(data.kpis.monthlyBudget)}`} sparkline={data.sections.dailySpend.map((item) => item.total)} />
            <StatCard label="Per active toy" value={formatMoney(data.kpis.perActiveToyPerDay)} caption="Per toy / day" sparkline={data.sections.dailySpend.map((item) => item.total)} />
            <StatCard label="Per session" value={formatMoney(data.kpis.perSession)} caption="Average session cost" sparkline={data.sections.topDevices.map((item) => item.cost)} />
            <StatCard label="Avg response time" value={`${data.kpis.avgResponseTimeSeconds}s`} caption="Average TTFT" sparkline={data.sections.topDevices.map((item) => item.sessions)} />
          </section>

          <section className="costs-grid">
            <article className="panel-card costs-chart-card">
              <div className="panel-header">
                <div>
                  <h2>Daily AI spend · last 30 days</h2>
                  <p>₹ per day · input vs output tokens</p>
                </div>
              </div>
              <CostsSpendChart items={data.sections.dailySpend} />
            </article>

            <article className="panel-card costs-budget-card">
              <div className="panel-header">
                <div>
                  <h2>July budget</h2>
                  <p>{formatMoney(data.kpis.monthlyBudget)} · alert at 90%</p>
                </div>
              </div>
              <div className="budget-meter">
                <div className="split-bar">
                  <span className="split-segment ai" style={{ width: `${Math.min(data.kpis.budgetUsedPercent, 100)}%` }} />
                </div>
                <div className="costs-budget-row">
                  <span>{formatMoney(data.kpis.totalCost)} used · {data.kpis.budgetUsedPercent}%</span>
                  <span>{formatMoney(data.kpis.projectedMonth)} projected</span>
                </div>
                <p className="split-note">Spend is tracking usage, not waste: the key question is cost per session, not absolute spikes alone.</p>
                <h3 className="costs-subhead">Token mix</h3>
                <div className="split-list">
                  <div className="split-list-item"><span className="split-dot ai" /><span>Output audio</span><strong>{tokenTotal ? Math.round((data.sections.tokenMix.outputAudio / tokenTotal) * 100) : 0}%</strong></div>
                  <div className="split-list-item"><span className="split-dot card" /><span>Input audio</span><strong>{tokenTotal ? Math.round((data.sections.tokenMix.inputAudio / tokenTotal) * 100) : 0}%</strong></div>
                  <div className="split-list-item"><span className="split-dot radio" /><span>Text + tools</span><strong>{tokenTotal ? Math.round((data.sections.tokenMix.text / tokenTotal) * 100) : 0}%</strong></div>
                </div>
              </div>
            </article>
          </section>

          <section className="panel-card costs-table-card">
            <div className="panel-header">
              <div>
                <h2>Where the money goes · top toys by spend</h2>
                <p>Heavy users, not leaks.</p>
              </div>
            </div>
            <div className="costs-table">
              <div className="costs-table-head">
                <span>Toy / kid</span>
                <span>Parent</span>
                <span>Sessions</span>
                <span>Talk time</span>
                <span>Cost</span>
              </div>
              {data.sections.topDevices.map((item) => (
                <div key={item.macAddress} className="costs-table-row">
                  <span>{item.kidName || item.macAddress}</span>
                  <span>{item.parentName || item.macAddress}</span>
                  <span>{item.sessions}</span>
                  <span>{item.talkHours} h</span>
                  <strong>{formatMoney(item.cost)}</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function OperatePage({
  data,
  loading,
}: {
  data: OperateResponse | null
  loading: boolean
}) {
  const firmwareTotal = data?.sections.firmwareCoverage.reduce((sum, item) => sum + item.count, 0) ?? 0
  const getFirmwareTone = (item: OperateResponse['sections']['firmwareCoverage'][number]) => {
    if (item.isLatest) return 'games'
    if (item.version === 'unknown') return 'rose'
    return 'amber'
  }
  const getFirmwareLabel = (item: OperateResponse['sections']['firmwareCoverage'][number]) => {
    if (item.isLatest) return `${item.version} · latest`
    if (item.version === 'unknown') return 'Unknown firmware'
    return item.version
  }

  return (
    <div className="page">
      <PageHeader eyebrow="" title="Fleet & OTA" subtitle={data?.generatedAt ? formatLongDate(data.generatedAt) : 'Firmware coverage, batteries, OTA rollout, and recent device events'} />
      {loading && !data ? <div className="loading-card">Loading fleet view…</div> : null}
      {data ? (
        <>
          <section className="stat-grid">
            <StatCard label="Fleet size" value={String(data.kpis.fleetSize)} caption="Registered toys" sparkline={data.sections.firmwareCoverage.map((item) => item.count)} />
            <StatCard label="Online now" value={String(data.kpis.onlineNow)} caption="Runtime presence" sparkline={data.sections.firmwareCoverage.map((item) => item.percent)} />
            <StatCard label="Latest firmware" value={`${data.kpis.latestFirmwarePercent}%`} caption="Coverage on latest" sparkline={data.sections.firmwareCoverage.map((item) => item.percent)} />
            <StatCard label="Battery health" value={`${data.kpis.avgBattery}%`} caption="Average fleet battery" sparkline={data.sections.watchlist.map(() => data.kpis.avgBattery)} />
            <StatCard label="Errors · 7d" value={String(data.kpis.deviceErrors7d)} caption="Runtime event signal" sparkline={data.sections.recentEvents.map((_, index) => index + 1)} />
          </section>

          <section className="operate-grid">
            <article className="panel-card operate-firmware-card">
              <div className="panel-header">
                <div>
                  <h2>Firmware coverage</h2>
                  <p>fleet by version</p>
                </div>
              </div>

              <div className="operate-firmware-legend">
                <span><i className="legend-dot games" /> latest</span>
                <span><i className="legend-dot ai" /> older</span>
                <span><i className="legend-dot rose" /> unknown</span>
              </div>

              <div className="operate-firmware-meter">
                <div className="split-bar">
                  {data.sections.firmwareCoverage.map((item) => (
                    <span
                      key={item.version}
                      className={`split-segment ${getFirmwareTone(item)}`}
                      style={{ width: `${firmwareTotal ? (item.count / firmwareTotal) * 100 : 0}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="operate-firmware-list">
                {data.sections.firmwareCoverage.map((item) => (
                  <div key={item.version} className="operate-firmware-item">
                    <span>
                      <i className={`legend-dot ${getFirmwareTone(item)}`} />
                      {getFirmwareLabel(item)}
                    </span>
                    <strong>{item.count} toys · {item.percent}%</strong>
                  </div>
                ))}
              </div>

              {data.sections.otaRollout ? (
                <div className="operate-ota-block">
                  <h3>OTA rollout · {data.sections.otaRollout.version} staged</h3>
                  <div className="split-bar compact">
                    <span className="split-segment amber" style={{ width: `${data.sections.otaRollout.percent}%` }} />
                  </div>
                  <div className="operate-ota-meta">
                    <span>{data.sections.otaRollout.updatedCount} of {data.sections.otaRollout.fleetSize} updated</span>
                    <span>force update: {data.sections.otaRollout.forceUpdate ? 'on' : 'off'}</span>
                  </div>
                </div>
              ) : null}
            </article>

            <article className="panel-card operate-watchlist-card">
              <div className="panel-header">
                <div>
                  <h2>Needs a human</h2>
                  <p>watchlist from runtime state + device events</p>
                </div>
              </div>
              {data.sections.watchlist.length ? (
                <div className="operate-watchlist-table">
                  <div className="operate-watchlist-head">
                    <span>Toy</span>
                    <span>Issue</span>
                    <span>Since</span>
                  </div>
                  {data.sections.watchlist.slice(0, 4).map((item) => (
                    <div key={`${item.macAddress}-${item.issue}`} className="operate-watchlist-row">
                      <span>{item.alias}</span>
                      <span className={`operate-issue-chip ${item.severity}`}>{item.issue}</span>
                      <strong>{item.since ? formatCompactDate(item.since) : 'today'}</strong>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state">No devices currently need manual attention.</div>}

              <div className="operate-events-block">
                <h3>Recent device events</h3>
                <div className="operate-events-list">
                  {data.sections.recentEvents.slice(0, 3).map((item) => (
                    <div key={`${item.source}-${item.macAddress}-${item.createdAt}`} className="operate-event-row">
                      <span>{formatDateTime(item.createdAt)} · {item.macAddress}</span>
                      <strong className={item.severity}>{item.detail}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  )
}

function RfidStudioPage({
  cards,
  loading,
}: {
  cards: RfidCardMapping[]
  loading: boolean
}) {
  const mappedCount = cards.filter((item) => item.active !== false).length
  const contentCount = cards.filter((item) => item.contentPackId).length
  const qnaCount = cards.filter((item) => item.questionPackId).length
  const aiCount = cards.filter((item) => (item.cardType || item.actionType) === 'ai').length

  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="RFID Studio"
        subtitle=""
      />

      <section className="stat-grid">
        <StatCard label="Mapped cards" value={String(mappedCount)} caption="Card mappings loaded from RFID Management" sparkline={cards.slice(0, 8).map((_, index) => index + 1)} />
        <StatCard label="Content cards" value={String(contentCount)} caption="Linked to content packs" sparkline={cards.slice(0, 8).map((item) => item.contentPackId ? 1 : 0)} />
        <StatCard label="Q&A cards" value={String(qnaCount)} caption="Linked to question packs" sparkline={cards.slice(0, 8).map((item) => item.questionPackId ? 1 : 0)} />
        <StatCard label="AI cards" value={String(aiCount)} caption="Direct AI mappings" sparkline={cards.slice(0, 8).map((item) => (item.cardType || item.actionType) === 'ai' ? 1 : 0)} />
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Card mappings</h2>
              <p>Live rows from RFID Management.</p>
            </div>
          </div>
          {loading ? <div className="loading-card">Loading card mappings…</div> : (
            <div className="costs-table">
              <div className="costs-table-head">
                <span>RFID UID</span>
                <span>Type</span>
                <span>Q&A pack</span>
                <span>Content pack</span>
                <span>Active</span>
              </div>
              {cards.slice(0, 8).map((item) => (
                <div key={item.id} className="costs-table-row">
                  <span>{item.rfidUid}</span>
                  <span>{item.cardType || item.actionType || '-'}</span>
                  <span>{item.questionPackName || '-'}</span>
                  <span>{item.packCode || '-'}</span>
                  <strong>{item.active === false ? 'No' : 'Yes'}</strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Mapping notes</h2>
              <p>Quick breakdown of mapping coverage.</p>
            </div>
          </div>
          <div className="leaderboard">
            {[
              ['Content-linked', `${contentCount} cards`],
              ['Q&A-linked', `${qnaCount} cards`],
              ['AI-linked', `${aiCount} cards`],
              ['Inactive mappings', `${cards.filter((item) => item.active === false).length} cards`],
            ].map(([title, meta]) => (
              <div key={title} className="leaderboard-item compact">
                <div>
                  <strong>{title}</strong>
                  <span>{meta}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}

function ContentLibraryPage({
  packs,
  loading,
  editorPack,
  editorLoading,
  onEdit,
  onCloseEditor,
  onDelete,
}: {
  packs: RfidContentPack[]
  loading: boolean
  editorPack: RfidContentPack | null
  editorLoading: boolean
  onEdit: (packCode: string) => void
  onCloseEditor: () => void
  onDelete: (packCode: string) => void
}) {
  const visiblePacks = packs.filter((item) => {
    const name = item.name?.trim().toLowerCase() || ''
    const packCode = item.packCode?.trim().toLowerCase() || ''
    return name !== 'custom voice card' && !packCode.startsWith('custom_voice_')
  })

  const activeCount = visiblePacks.filter((item) => item.active !== false).length
  const promptCount = visiblePacks.filter((item) => item.contentType === 'prompt').length
  const ttsCount = visiblePacks.filter((item) => item.contentType && item.contentType !== 'prompt').length

  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Content Library"
        subtitle=""
      />

      <section className="stat-grid">
        <StatCard label="Content packs" value={String(visiblePacks.length)} caption="Loaded from Content Packs" sparkline={visiblePacks.slice(0, 8).map((_, index) => index + 1)} />
        <StatCard label="Active packs" value={String(activeCount)} caption="Currently marked active" sparkline={visiblePacks.slice(0, 8).map((item) => item.active === false ? 0 : 1)} />
        <StatCard label="AI packs" value={String(promptCount)} caption="Prompt-based packs" sparkline={visiblePacks.slice(0, 8).map((item) => item.contentType === 'prompt' ? 1 : 0)} />
        <StatCard label="Read-aloud packs" value={String(ttsCount)} caption="Non-prompt content packs" sparkline={visiblePacks.slice(0, 8).map((item) => item.contentType && item.contentType !== 'prompt' ? 1 : 0)} />
      </section>

      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2>Content packs</h2>
            <p>Live cards from RFID Management.</p>
          </div>
        </div>
        {loading ? <div className="loading-card">Loading content packs…</div> : (
          <div className="content-pack-grid">
            {visiblePacks.map((item) => (
              <article key={item.id} className="content-pack-card">
                <div className="content-pack-card-header">
                  <div>
                    <strong className="content-pack-title">{item.name}</strong>
                    <div className="content-pack-code">{item.packCode}</div>
                  </div>
                  <span className={item.active === false ? 'status-pill offline' : 'status-pill online'}>
                    {item.active === false ? 'Draft' : 'Active'}
                  </span>
                </div>

                <p className="content-pack-description">{item.description || 'No description provided.'}</p>

                <div className="topic-wrap">
                  <span className="topic-chip">{item.contentType === 'prompt' ? 'AI' : 'TTS'}</span>
                  <span className="topic-chip">{item.totalItems ?? item.items?.length ?? 0} items</span>
                  <span className="topic-chip">{item.language || '-'}</span>
                  {item.version ? <span className="topic-chip">v{item.version}</span> : null}
                </div>

                <div className="content-pack-card-footer">
                  <span>{item.contentType === 'prompt' ? 'AI Generated' : 'Read-Aloud'}</span>
                  <div className="content-pack-actions">
                    <button type="button" className="secondary-button compact" onClick={() => onEdit(item.packCode)}>Edit</button>
                    <button type="button" className="secondary-button compact danger" onClick={() => onDelete(item.packCode)}>Delete</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Pack breakdown</h2>
              <p>Quick summary of the content pack mix.</p>
            </div>
          </div>
          <div className="leaderboard">
            {[
              ['Prompt / AI packs', `${promptCount} packs`],
              ['Read-aloud packs', `${ttsCount} packs`],
              ['Active packs', `${activeCount} packs`],
              ['Draft packs', `${visiblePacks.filter((item) => item.active === false).length} packs`],
            ].map(([title, meta]) => (
              <div key={title} className="leaderboard-item compact">
                <div>
                  <strong>{title}</strong>
                  <span>{meta}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Edit preview</h2>
              <p>The same founder-dashboard-only detail view that opens from Edit.</p>
            </div>
          </div>
          {editorLoading ? <div className="loading-card">Loading pack details…</div> : editorPack ? (
            <div className="content-pack-editor-preview">
              <div className="mini-stats">
                <div className="mini-stat"><span>Pack code</span><strong>{editorPack.packCode}</strong></div>
                <div className="mini-stat"><span>Status</span><strong>{editorPack.status || (editorPack.active === false ? 'draft' : 'published')}</strong></div>
                <div className="mini-stat"><span>Version</span><strong>v{editorPack.version ?? 1}</strong></div>
              </div>
              <div className="quote-stack">
                <blockquote className="quote-card">
                  <p><strong>Name:</strong> {editorPack.name}</p>
                  <footer>Description: {editorPack.description || 'None'}</footer>
                </blockquote>
                <blockquote className="quote-card">
                  <p><strong>Content type:</strong> {editorPack.contentType || '-'}</p>
                  <footer>Language: {editorPack.language || '-'}</footer>
                </blockquote>
              </div>
              <button type="button" className="secondary-button" onClick={onCloseEditor}>Close</button>
            </div>
          ) : (
            <div className="empty-state">Tap Edit on any content pack card to open its details here.</div>
          )}
        </article>
      </section>

      {editorPack ? (
        <div className="modal-backdrop" onClick={onCloseEditor}>
          <div className="modal-card content-pack-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <h2>Edit Content Pack</h2>
                <p>{editorPack.packCode}</p>
              </div>
              <button type="button" className="secondary-button compact" onClick={onCloseEditor}>Close</button>
            </div>

            <div className="editor-form-grid">
              <label>
                <span>Pack Code</span>
                <input value={editorPack.packCode} readOnly />
              </label>
              <label>
                <span>Name</span>
                <input value={editorPack.name} readOnly />
              </label>
              <label className="full">
                <span>Description</span>
                <textarea value={editorPack.description || ''} readOnly rows={3} />
              </label>
              <label>
                <span>Thumbnail URL</span>
                <input value={editorPack.thumbnailUrl || ''} readOnly />
              </label>
              <label>
                <span>Content Type</span>
                <input value={editorPack.contentType || ''} readOnly />
              </label>
              <label>
                <span>Language</span>
                <input value={editorPack.language || ''} readOnly />
              </label>
              <label>
                <span>Status</span>
                <input value={editorPack.status || (editorPack.active === false ? 'draft' : 'published')} readOnly />
              </label>
              <label>
                <span>Version</span>
                <input value={String(editorPack.version ?? 1)} readOnly />
              </label>
            </div>

            <div className="panel-header">
              <div>
                <h2>Pack Items</h2>
                <p>{editorPack.items?.length ?? editorPack.totalItems ?? 0} items</p>
              </div>
            </div>
            <div className="content-pack-items">
              {(editorPack.items || []).length ? (editorPack.items || []).map((item, index) => (
                <div key={`${editorPack.id}-${index}`} className="content-pack-item-card">
                  <strong>{index + 1}. {item.title || 'Untitled item'}</strong>
                  <span>{item.audioUrl || 'No audio URL'}</span>
                  <span>{item.imageUrl || 'No image URL'}</span>
                  <p>{item.text || 'No text content'}</p>
                </div>
              )) : <div className="empty-state">No item details available for this pack.</div>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SettingsPage({
  username,
  onSignOut,
}: {
  username: string
  onSignOut: () => void
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow=""
        title="Settings"
        subtitle=""
      />

      <section className="panel-grid panel-grid-three">
        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Alerts</h2>
              <p>Thresholds that should page the team.</p>
            </div>
          </div>
          <div className="mini-stats">
            <div className="mini-stat"><span>Battery alert</span><strong>15%</strong></div>
            <div className="mini-stat"><span>Quiet toy</span><strong>7 days</strong></div>
            <div className="mini-stat"><span>Budget alert</span><strong>90%</strong></div>
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>Rollout defaults</h2>
              <p>Safe starting points for product pushes.</p>
            </div>
          </div>
          <div className="mini-stats">
            <div className="mini-stat"><span>Canary cohort</span><strong>10%</strong></div>
            <div className="mini-stat"><span>Force update</span><strong>Off</strong></div>
            <div className="mini-stat"><span>Rollback rule</span><strong>2 fails</strong></div>
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-header">
            <div>
              <h2>People</h2>
              <p>Who should see founder-level alerts.</p>
            </div>
          </div>
          <div className="leaderboard">
            {['Ravi · Founder', 'Ops lead', 'Content lead'].map((name) => (
              <div key={name} className="leaderboard-item compact">
                <div>
                  <strong>{name}</strong>
                  <span>Alert subscriber</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="session-bar">
        <span>Signed in{username ? ` as ${username}` : ''}</span>
        <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState<NavPage>('overview')
  const [overviewRange, setOverviewRange] = useState<RangeOption>('7d')
  const [engagementRange, setEngagementRange] = useState<RangeOption>('30d')
  const [contentRange, setContentRange] = useState<RangeOption>('7d')
  const [conversationRange, setConversationRange] = useState<RangeOption>('7d')
  const [costRange, setCostRange] = useState<RangeOption>('month')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [engagement, setEngagement] = useState<EngagementResponse | null>(null)
  const [content, setContent] = useState<ContentResponse | null>(null)
  const [conversations, setConversations] = useState<ConversationsResponse | null>(null)
  const [costs, setCosts] = useState<CostsResponse | null>(null)
  const [operate, setOperate] = useState<OperateResponse | null>(null)
  const [rfidCards, setRfidCards] = useState<RfidCardMapping[]>([])
  const [contentPacks, setContentPacks] = useState<RfidContentPack[]>([])
  const [contentPackEditor, setContentPackEditor] = useState<RfidContentPack | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [engagementLoading, setEngagementLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [costsLoading, setCostsLoading] = useState(false)
  const [operateLoading, setOperateLoading] = useState(false)
  const [rfidCardsLoading, setRfidCardsLoading] = useState(false)
  const [contentPacksLoading, setContentPacksLoading] = useState(false)
  const [contentPackEditorLoading, setContentPackEditorLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<{ kids: SearchResult[]; parents: SearchResult[]; devices: SearchResult[] }>({
    kids: [],
    parents: [],
    devices: [],
  })
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [profile, setProfile] = useState<FamilyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [error, setError] = useState('')
  const deferredSearchTerm = useDeferredValue(searchTerm)

  useEffect(() => {
    setToken(loadStoredToken())
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setOverviewLoading(true)
    apiFetch<OverviewResponse>(`/admin/founder/overview?range=${overviewRange}`, token)
      .then((payload) => { if (!cancelled) setOverview(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load overview') })
      .finally(() => { if (!cancelled) setOverviewLoading(false) })
    return () => { cancelled = true }
  }, [overviewRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setEngagementLoading(true)
    apiFetch<EngagementResponse>(`/admin/founder/engagement?range=${engagementRange}`, token)
      .then((payload) => { if (!cancelled) setEngagement(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load engagement') })
      .finally(() => { if (!cancelled) setEngagementLoading(false) })
    return () => { cancelled = true }
  }, [engagementRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setContentLoading(true)
    apiFetch<ContentResponse>(`/admin/founder/content?range=${contentRange}`, token)
      .then((payload) => { if (!cancelled) setContent(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load content') })
      .finally(() => { if (!cancelled) setContentLoading(false) })
    return () => { cancelled = true }
  }, [contentRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setConversationsLoading(true)
    apiFetch<ConversationsResponse>(`/admin/founder/conversations?range=${conversationRange}`, token)
      .then((payload) => { if (!cancelled) setConversations(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load conversations') })
      .finally(() => { if (!cancelled) setConversationsLoading(false) })
    return () => { cancelled = true }
  }, [conversationRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setCostsLoading(true)
    apiFetch<CostsResponse>(`/admin/founder/costs?range=${costRange}`, token)
      .then((payload) => { if (!cancelled) setCosts(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load costs') })
      .finally(() => { if (!cancelled) setCostsLoading(false) })
    return () => { cancelled = true }
  }, [costRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setOperateLoading(true)
    apiFetch<OperateResponse>('/admin/founder/operate', token)
      .then((payload) => { if (!cancelled) setOperate(payload) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load fleet view') })
      .finally(() => { if (!cancelled) setOperateLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setRfidCardsLoading(true)
    apiFetch<{ list: RfidCardMapping[]; total: number }>('/admin/rfid/card/page?page=1&limit=100', token)
      .then((payload) => { if (!cancelled) setRfidCards(payload.list || []) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load card mappings') })
      .finally(() => { if (!cancelled) setRfidCardsLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setContentPacksLoading(true)
    apiFetch<{ list: RfidContentPack[]; total: number }>('/admin/rfid/content-pack/page?page=1&limit=100', token)
      .then((payload) => { if (!cancelled) setContentPacks(payload.list || []) })
      .catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load content packs') })
      .finally(() => { if (!cancelled) setContentPacksLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token || deferredSearchTerm.trim().length < 2) {
      setSearchResults({ kids: [], parents: [], devices: [] })
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      apiFetch<{ kids: SearchResult[]; parents: SearchResult[]; devices: SearchResult[] }>(
        `/admin/founder/families/search?q=${encodeURIComponent(deferredSearchTerm.trim())}`,
        token,
      )
        .then((payload) => {
          if (cancelled) return
          setSearchResults(payload)
          if (!selectedResult) {
            const first = payload.kids[0] || payload.devices[0] || payload.parents[0] || null
            if (first) setSelectedResult(first)
          }
        })
        .catch((requestError: unknown) => {
          if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to search families')
        })
        .finally(() => { if (!cancelled) setSearchLoading(false) })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [deferredSearchTerm, selectedResult, token])

  useEffect(() => {
    if (!token || !selectedResult) return
    let cancelled = false
    setProfileLoading(true)
    const identifier = selectedResult.macAddress || selectedResult.id
    apiFetch<FamilyProfile>(`/admin/founder/families/${encodeURIComponent(identifier)}/profile`, token)
      .then((payload) => { if (!cancelled) setProfile(payload) })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load family profile')
      })
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [selectedResult, token])

  const signIn = async () => {
    setAuthLoading(true)
    setError('')
    try {
      const captchaId = crypto.randomUUID()
      const payload = await apiFetchPublic<{ token: string }>('/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          captcha: 'MOBILE_APP_BYPASS',
          captchaId,
        }),
      })
      localStorage.setItem(AUTH_STORAGE_KEY, payload.token)
      setActivePage('overview')
      setToken(payload.token)
      setPassword('')
    } catch (requestError: unknown) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to sign in')
    } finally {
      setAuthLoading(false)
    }
  }

  const signOut = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setToken('')
    setActivePage('overview')
    setOverview(null)
    setEngagement(null)
    setContent(null)
    setConversations(null)
    setCosts(null)
    setOperate(null)
    setRfidCards([])
    setContentPacks([])
    setContentPackEditor(null)
    setProfile(null)
    setSelectedResult(null)
    setSearchResults({ kids: [], parents: [], devices: [] })
  }

  const openContentPackEditor = async (packCode: string) => {
    if (!token) return
    setContentPackEditorLoading(true)
    try {
      const payload = await apiFetch<RfidContentPack>(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`, token)
      setContentPackEditor(payload)
    } catch (requestError: unknown) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to load content pack details')
    } finally {
      setContentPackEditorLoading(false)
    }
  }

  const closeContentPackEditor = () => {
    setContentPackEditor(null)
    setContentPackEditorLoading(false)
  }

  const showDeleteDisabled = (packCode: string) => {
    setError(`Delete for ${packCode} is intentionally disabled in the founder dashboard.`)
  }

  if (!token) {
    return (
      <LoginPanel
        username={username}
        password={password}
        loading={authLoading}
        error={error}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={signIn}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onChange={setActivePage} />
      <main className="main-shell">
        {error ? <div className="error-banner">{error}</div> : null}

        {activePage === 'overview' ? <OverviewPage range={overviewRange} overview={overview} engagement={engagement} costs={costs} operate={operate} loading={overviewLoading} onRangeChange={setOverviewRange} /> : null}
        {activePage === 'engagement' ? <EngagementPage range={engagementRange} data={engagement} loading={engagementLoading} onRangeChange={setEngagementRange} /> : null}
        {activePage === 'content' ? <ContentPage range={contentRange} data={content} loading={contentLoading} onRangeChange={setContentRange} /> : null}
        {activePage === 'conversations' ? <ConversationsPage range={conversationRange} data={conversations} loading={conversationsLoading} onRangeChange={setConversationRange} /> : null}
        {activePage === 'families' ? (
          <FamiliesPage
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            results={searchResults}
            loadingSearch={searchLoading}
            selectedResult={selectedResult}
            onSelectResult={setSelectedResult}
            profile={profile}
            loadingProfile={profileLoading}
          />
        ) : null}
        {activePage === 'costs' ? <CostsPage range={costRange} data={costs} loading={costsLoading} onRangeChange={setCostRange} /> : null}
        {activePage === 'operate' ? <OperatePage data={operate} loading={operateLoading} /> : null}
        {activePage === 'rfidStudio' ? <RfidStudioPage cards={rfidCards} loading={rfidCardsLoading} /> : null}
        {activePage === 'contentLibrary' ? (
          <ContentLibraryPage
            packs={contentPacks}
            loading={contentPacksLoading}
            editorPack={contentPackEditor}
            editorLoading={contentPackEditorLoading}
            onEdit={openContentPackEditor}
            onCloseEditor={closeContentPackEditor}
            onDelete={showDeleteDisabled}
          />
        ) : null}
        {activePage === 'settings' ? <SettingsPage username={username} onSignOut={signOut} /> : null}
      </main>

      <nav className="mobile-nav">
        <button type="button" className={activePage === 'overview' ? 'active' : ''} onClick={() => setActivePage('overview')}>Overview</button>
        <button type="button" className={activePage === 'engagement' ? 'active' : ''} onClick={() => setActivePage('engagement')}>Engage</button>
        <button type="button" className={activePage === 'families' ? 'active' : ''} onClick={() => setActivePage('families')}>Families</button>
        <button type="button" className={activePage === 'costs' ? 'active' : ''} onClick={() => setActivePage('costs')}>Costs</button>
        <button type="button" className={activePage === 'operate' ? 'active' : ''} onClick={() => setActivePage('operate')}>Operate</button>
      </nav>
    </div>
  )
}

export default App
