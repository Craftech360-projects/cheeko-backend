import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import './App.css'

/* ================================================================== *
 * Types — mirror the /admin/founder/* response shapes exactly.
 * ================================================================== */

type RangeOption = 'today' | '7d' | '30d' | '90d' | 'month'

type NavPage =
  | 'overview'
  | 'live'
  | 'brief'
  | 'engagement'
  | 'content'
  | 'conversations'
  | 'families'
  | 'costs'
  | 'operate'
  | 'rfidStudio'
  | 'contentLibrary'
  | 'settings'

type Theme = 'light' | 'dark'

type CardLeaderboardItem = {
  name: string
  taps: number
  uniqueDevices: number
  uniqueCards: number
}

type GameSummaryItem = {
  name: string
  plays: number
  avgScore: number | null
  avgDurationMinutes: number
}

type SearchResult = {
  type: 'kid' | 'parent' | 'device'
  id: string
  label: string
  subtitle?: string | null
  parentName?: string | null
  kidName?: string | null
  toyCount?: number
  macAddress?: string
}

type SearchResponse = {
  kids: SearchResult[]
  parents: SearchResult[]
  devices: SearchResult[]
}

type FamilyListEntry = {
  kidId: string
  kidName: string
  nickname: string | null
  grade: string | null
  birthDate: string | null
  parentName: string | null
  deviceCount: number
}

type FamilyListResponse = {
  total: number
  page: number
  limit: number
  items: FamilyListEntry[]
}

type OverviewResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    activeToys: { total: number; fleetTotal: number; onlineNow: number; sparkline: number[] }
    playTimeHours: { total: number; sparkline: number[] }
    sessions: { total: number; sparkline: number[] }
    newFamilies: { total: number; sparkline: number[] }
    aiCostInr: { total: number; sparkline: number[] }
  }
  deltas: {
    activeToys: number | null
    playTimeHours: number | null
    sessions: number | null
    newFamilies: number | null
    aiCostInr: number | null
  }
  comparedTo: { startKey: string; endKey: string }
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
      hasData: boolean
      totalMinutes: number
      items: Array<{ key: string; label: string; minutes: number }>
    }
    cardsKidsLove: { items: CardLeaderboardItem[]; unresolvedTapCount: number }
    gamesPlayedVsFinished: { items: GameSummaryItem[] }
    talkingAbout: {
      items: Array<{ topic: string; mentions: number }>
      samples: Array<{ summary: string; macAddress: string; updatedAt: string }>
    }
  }
}

type EngagementResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    activeToday: number | null
    activeYesterday: number | null
    weeklyActives: number
    monthlyActives: number
    fleetTotal: number
    dauMauRatio: number | null
    avgSessionMinutes: number
  }
  deltas: {
    weeklyActives: number | null
    monthlyActives: number | null
    avgSessionMinutes: number | null
  }
  sections: {
    dailyActives: Array<{ date: string; activeDevices: number; average: number | null }>
    returningSplit: {
      currentWeekActives: number
      previousWeekActives: number
      returnedCount: number
      returnedRate: number | null
      newCount: number
      windowLabel: string
    }
    sessionsByHour: Array<{ hour: number; sessions: number }>
    sessionsHeatmap: Array<{ day: string; hours: Array<{ hour: number; sessions: number }> }>
    quietDevices: Array<{
      macAddress: string
      alias: string
      kidName: string | null
      parentName: string | null
      quietDays: number
      lastActivityDate: string
      lastSeenAt: string | null
    }>
    quietDeviceTotal: number
  }
}

type ContentResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    cardTaps: number
    packsInUse: number
    catalogTotal: number
    gamePlays: number
    avgCompletionRate: number | null
    mediaPlays: number
  }
  deltas: {
    cardTaps: number | null
    packsInUse: number | null
    gamePlays: number | null
    mediaPlays: number | null
  }
  sections: {
    packLeaderboard: Array<
      CardLeaderboardItem & {
        repeatRate: number
        previousTaps: number
        changePercent: number | null
        trend: number[]
      }
    >
    games: Array<{
      name: string
      plays: number
      sessions: number
      completed: number
      completionRate: number | null
      avgScore: number | null
      status: string
    }>
    media: Array<{ title: string; type: string; plays: number }>
    radio: Array<{ station: string; minutes: number }>
    losingSteam: Array<{
      name: string
      metric: 'taps' | 'minutes' | 'completion'
      changePercent: number | null
      changePoints?: number
      consecutiveWeeks: number
    }>
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
    moderationFlags: number | null
    screenedMessages: number
  }
  deltas: {
    talkHours: number | null
    talkSessions: number | null
    avgTurnsPerSession: number | null
  }
  sections: {
    topics: Array<{ topic: string; mentions: number }>
    summaries: Array<{
      id: string
      sessionId: string
      macAddress: string
      headline: string
      summary: string
      tags: string[]
      turns: number
      updatedAt: string
    }>
  }
}

type LiveResponse = {
  generatedAt: string
  kpis: {
    onlineNow: number
    fleetSize: number
    peakSessionsHour: { hour: number; sessions: number } | null
    activeToday: number
    activeThisWeek: number
    activeThisMonth: number
    dauMauRatio: number | null
  }
  sections: {
    liveToys: Array<{
      macAddress: string
      alias: string
      kidName: string | null
      battery: number | null
      firmware: string | null
      mode: string | null
      lastSeenAt: string | null
    }>
    spend: {
      monthToDate: number
      monthlyBudget: number | null
      budgetUsedPercent: number | null
      projectedMonth: number
      dayOfMonth: number
      daysInMonth: number
    }
    hourlySessions: Array<{ hour: number; sessions: number }>
    ttftTrend: Array<{ date: string; seconds: number | null }>
    feed: Array<{
      kind: 'talk' | 'card' | 'game' | 'alert'
      macAddress: string
      label: string
      detail: string
      at: string
    }>
    sessionQuality: {
      answerAccuracy: number | null
      avgSessionMinutes: number | null
      avgTtftSeconds: number | null
      completedSessionsPercent: number | null
      sessionsCounted: number
      attemptsCounted: number
    }
  }
}

type BriefResponse = {
  generatedAt: string
  coverDate: string
  headline: { activeToys: number; playHours: number; sessions: number; costInr: number }
  deltas: { activeToys: number | null; playHours: number | null; sessions: number | null }
  threeThings: Array<{ title: string; detail: string }>
  playHoursSeries: Array<{ date: string; hours: number }>
  quotes: Array<{ summary: string; macAddress: string; updatedAt: string }>
  movers: Array<{ label: string; changePercent: number }>
}

type TranscriptResponse = {
  sessionId: string
  macAddress: string | null
  headline: string | null
  summary: string | null
  turns: number
  updatedAt: string | null
  lines: Array<{ speaker: string; text: string; createdAt: string | null }>
}

/* One of the two token ledgers, reported all-time. */
type LifetimeLedger = {
  totalInr: number | null
  rows: number | null
  firstDay: string | null
  lastDay: string | null
}

type CostsResponse = {
  range: RangeOption
  generatedAt: string
  kpis: {
    totalCost: number
    projectedMonth: number
    daysInMonth: number
    daysObserved: number
    monthlyBudget: number | null
    budgetUsedPercent: number | null
    perActiveToyPerDay: number | null
    perSession: number | null
    avgResponseTimeSeconds: number | null
  }
  deltas: { totalCost: number | null }
  sections: {
    lifetime?: {
      sessionLedger: LifetimeLedger
      deviceLedger: LifetimeLedger
    }
    dailySpend: Array<{ date: string; total: number; inputCost: number; outputCost: number }>
    tokenMix: { outputAudio: number; inputAudio: number; text: number }
    topDevices: Array<{
      macAddress: string
      alias: string
      sessions: number
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
    reportingDevices: number
    latestFirmwarePercent: number | null
    latestFirmwareVersion: string | null
    avgBattery: number | null
    batteryReportingDevices: number
    deviceErrors7d: number
  }
  sections: {
    firmwareCoverage: Array<{ version: string; count: number; percent: number; isLatest: boolean }>
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
      kidName: string | null
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
      createdAt: string | null
    }>
  }
}

type FamilyProfile = {
  kid: {
    id: string
    name: string
    nickname?: string | null
    grade?: string | null
    school?: string | null
    language?: string | null
    interests: string[]
    birthDate?: string | null
    memberSince?: string | null
  }
  parent: {
    displayName?: string | null
    countryRegion?: string | null
    timezone?: string | null
    memberSince?: string | null
  }
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
    monthKey: string | null
    questionsUsed: number
    extraPurchased: number
    allowance: number | null
    remaining: number | null
  }
  thisWeek: {
    playSeconds: number
    sessions: number
    sparkline: number[]
    split: Array<{ key: string; label: string; minutes: number }>
  }
  progress: Array<{
    macAddress: string
    totalSessions: number
    totalDurationSeconds: number
    totalGamesPlayed: number
    currentStreak: number
    longestStreak: number
    lastActivityAt: string | null
  }>
  recentSummaries: Array<{ summary: string; macAddress: string; updatedAt: string }>
  contentLove: { cards: CardLeaderboardItem[]; games: GameSummaryItem[] }
}

type RfidCardMapping = {
  id: number | string
  rfidUid: string
  cardType?: string | null
  actionType?: string | null
  questionPackId?: number | string | null
  contentPackId?: number | string | null
  packCode?: string | null
  active?: boolean | null
}

type RfidContentPack = {
  id: number | string
  packCode: string
  name: string
  description?: string | null
  contentType?: string | null
  language?: string | null
  status?: string | null
  version?: string | number | null
  thumbnailUrl?: string | null
  active?: boolean | null
  totalItems?: number | null
  items?: Array<{
    title?: string | null
    audioUrl?: string | null
    imageUrl?: string | null
    text?: string | null
  }>
}

/* ================================================================== *
 * API layer
 * ================================================================== */

const API_BASE_URL = import.meta.env.VITE_MANAGER_API_BASE_URL || '/toy'
const AUTH_STORAGE_KEY = 'founder_dashboard_token'
const THEME_STORAGE_KEY = 'founder_dashboard_theme'

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
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

/* ================================================================== *
 * Formatting — every helper renders an em dash for absent data so a
 * missing measurement never reads as a real zero.
 * ================================================================== */

const DASH = '—'

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined
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
    timeZone: 'Asia/Kolkata',
  })
}

function formatDateTime(value?: string | null) {
  if (!value) return DASH
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

function formatNumber(value: number | null | undefined) {
  if (isNil(value) || !Number.isFinite(value)) return DASH
  return value.toLocaleString('en-IN')
}

function formatMoney(value: number | null | undefined) {
  if (isNil(value) || !Number.isFinite(value)) return DASH
  // Per-unit costs are routinely sub-paisa; widen precision rather than
  // collapsing a real cost to ₹0.00.
  const decimals = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function formatMoneyCompact(value: number | null | undefined) {
  if (isNil(value) || !Number.isFinite(value)) return DASH
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

/* Lifetime spans can cross a year boundary, so day+month alone is ambiguous. */
function formatDayWithYear(value: string | null | undefined) {
  if (!value) return DASH
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPercent(value: number | null | undefined) {
  if (isNil(value) || !Number.isFinite(value)) return DASH
  return `${value}%`
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours && minutes) return `${hours}h ${minutes}m`
  if (hours) return `${hours}h`
  return `${minutes}m`
}

function getAge(birthDate?: string | null) {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDelta = now.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

function rangeLabel(range: RangeOption) {
  switch (range) {
    case 'today':
      return 'today'
    case '7d':
      return 'last 7 days'
    case '30d':
      return 'last 30 days'
    case '90d':
      return 'last 90 days'
    case 'month':
      return 'this month'
  }
}

/** Wraps the typed substring in <mark> so the matched letters stand out. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return <>{text}</>
  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  if (index === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}

function initialsOf(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}

/* ================================================================== *
 * Theme
 * ================================================================== */

function readInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }, [])

  return { theme, toggle }
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.4M12 19.6V22M4.22 4.22l1.7 1.7M18.08 18.08l1.7 1.7M2 12h2.4M19.6 12H22M4.22 19.78l1.7-1.7M18.08 5.92l1.7-1.7" />
        </svg>
      )}
    </button>
  )
}

/* ================================================================== *
 * Charts
 * ================================================================== */

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length < 2) return <div className="sparkline" />

  const width = 120
  const height = 30
  const pad = 2
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const span = max - min || 1

  const points = clean.map((value, index) => {
    const x = pad + ((width - 2 * pad) * index) / (clean.length - 1)
    const y = height - pad - ((height - 2 * pad) * (value - min)) / span
    return { x, y }
  })

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height - 1} L ${points[0].x.toFixed(1)} ${height - 1} Z`
  const last = points[points.length - 1]

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="sparkline-area" d={area} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r="2.6" fill="currentColor" />
    </svg>
  )
}

const FEATURE_SERIES = [
  { key: 'aiTalkMinutes', color: 'var(--c-ai)' },
  { key: 'cardMinutes', color: 'var(--c-cards)' },
  { key: 'gameMinutes', color: 'var(--c-games)' },
  { key: 'radioMinutes', color: 'var(--c-radio)' },
] as const

function StackedUsageChart({ series }: { series: OverviewResponse['sections']['timeByFeature']['series'] }) {
  if (!series.length) return <div className="empty-state">No activity recorded for this range.</div>

  const width = 640
  const height = 190
  const pad = 6
  const totals = series.map((row) => row.aiTalkMinutes + row.cardMinutes + row.gameMinutes + row.radioMinutes)
  const max = Math.max(...totals, 1) * 1.06

  if (series.length === 1) {
    const row = series[0]
    return (
      <div className="split" style={{ marginTop: 14 }}>
        {FEATURE_SERIES.map((feature) => {
          const value = row[feature.key]
          const pct = totals[0] ? (value / totals[0]) * 100 : 0
          return pct > 0 ? <b key={feature.key} style={{ width: `${pct}%`, background: feature.color }} /> : null
        })}
      </div>
    )
  }

  const xs = series.map((_, index) => pad + ((width - 2 * pad) * index) / (series.length - 1))
  const yOf = (value: number) => height - pad - ((height - 2 * pad) * value) / max

  let base = series.map(() => 0)
  const bands = FEATURE_SERIES.map((feature) => {
    const top = series.map((row, index) => base[index] + row[feature.key])
    const upper = top.map((value, index) => `${xs[index].toFixed(1)},${yOf(value).toFixed(1)}`)
    const lower = base.map((value, index) => `${xs[index].toFixed(1)},${yOf(value).toFixed(1)}`).reverse()
    base = top
    return { key: feature.key, color: feature.color, points: [...upper, ...lower].join(' ') }
  })

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height: 190 }} role="img" aria-label="Daily minutes by feature">
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line key={ratio} className="usage-grid-line" x1={pad} y1={pad + (height - 2 * pad) * ratio} x2={width - pad} y2={pad + (height - 2 * pad) * ratio} />
      ))}
      {bands.map((band) => (
        <polygon key={band.key} className="stack-band" points={band.points} fill={band.color} opacity="0.9" />
      ))}
    </svg>
  )
}

function TrendChart({ items }: { items: EngagementResponse['sections']['dailyActives'] }) {
  if (items.length < 2) return <div className="empty-state">Not enough days in this range to plot a trend.</div>

  const width = 640
  const height = 190
  const pad = 8
  const values = items.map((item) => item.activeDevices)
  const averages = items.map((item) => item.average)
  const max = Math.max(...values, ...averages.filter((v): v is number => v !== null), 1) * 1.1

  const xOf = (index: number) => pad + ((width - 2 * pad) * index) / (items.length - 1)
  const yOf = (value: number) => height - pad - ((height - 2 * pad) * value) / max

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(1)} ${yOf(value).toFixed(1)}`).join(' ')
  const area = `${line} L ${xOf(items.length - 1).toFixed(1)} ${height - pad} L ${xOf(0).toFixed(1)} ${height - pad} Z`

  let avgPath = ''
  averages.forEach((value, index) => {
    if (value === null) return
    avgPath += `${avgPath ? 'L' : 'M'} ${xOf(index).toFixed(1)} ${yOf(value).toFixed(1)} `
  })

  const lastIndex = items.length - 1

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ height: 190 }} role="img" aria-label="Daily active toys">
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line key={ratio} className="usage-grid-line" x1={pad} y1={pad + (height - 2 * pad) * ratio} x2={width - pad} y2={pad + (height - 2 * pad) * ratio} />
      ))}
      <path className="trend-area" d={area} />
      {avgPath ? <path className="trend-average-line" d={avgPath.trim()} /> : null}
      <path className="trend-line" d={line} />
      <circle cx={xOf(lastIndex)} cy={yOf(values[lastIndex])} r="3.2" fill="var(--c-ai)" />
    </svg>
  )
}

function CostBarsChart({ items }: { items: CostsResponse['sections']['dailySpend'] }) {
  if (!items.length) return <div className="empty-state">No spend recorded for this range.</div>

  const width = 640
  const height = 190
  const pad = 8
  const max = Math.max(...items.map((item) => item.total), 1) * 1.1
  const barWidth = (width - 2 * pad) / items.length

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height: 190 }} role="img" aria-label="Daily AI spend">
      {[0.33, 0.66].map((ratio) => (
        <line key={ratio} className="usage-grid-line" x1={pad} y1={pad + (height - 2 * pad) * ratio} x2={width - pad} y2={pad + (height - 2 * pad) * ratio} />
      ))}
      {items.map((item, index) => {
        const x = pad + index * barWidth + barWidth * 0.18
        const w = barWidth * 0.64
        const inputHeight = ((height - 2 * pad) * item.inputCost) / max
        const outputHeight = ((height - 2 * pad) * item.outputCost) / max
        const inputY = height - pad - inputHeight
        const outputY = inputY - outputHeight - (inputHeight && outputHeight ? 1.5 : 0)
        return (
          <g key={item.date}>
            {inputHeight > 0 ? <rect x={x} y={inputY} width={w} height={inputHeight} fill="var(--c-cards)" /> : null}
            {outputHeight > 0 ? <rect x={x} y={outputY} width={w} height={outputHeight} rx="2" fill="var(--c-ai)" /> : null}
          </g>
        )
      })}
    </svg>
  )
}

const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function SessionsHeatmap({ rows }: { rows: EngagementResponse['sections']['sessionsHeatmap'] }) {
  const max = Math.max(...rows.flatMap((row) => row.hours.map((hour) => hour.sessions)), 1)
  const ordered = HEATMAP_DAYS.map((day) => rows.find((row) => row.day === day) || { day, hours: [] })

  return (
    <div className="heat7">
      <div className="dl-col">
        {ordered.map((row) => (
          <div key={row.day} className="dl">{row.day}</div>
        ))}
      </div>
      <div className="cells">
        {ordered.map((row) => (
          <div key={row.day} className="r">
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = row.hours.find((item) => item.hour === hour)
              const sessions = cell?.sessions || 0
              const opacity = sessions === 0 ? 0.07 : 0.14 + 0.86 * (sessions / max)
              return (
                <b
                  key={hour}
                  style={{ opacity }}
                  title={`${row.day} ${String(hour).padStart(2, '0')}:00 · ${sessions} session${sessions === 1 ? '' : 's'}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== *
 * Shared UI
 * ================================================================== */

/**
 * Green ▲ / red ▼ for a measured percentage change.
 * `null` means there was no baseline, so nothing is claimed.
 */
function DeltaArrow({
  value,
  suffix = '%',
  qualifier,
}: {
  value: number | null | undefined
  suffix?: string
  qualifier?: string
}) {
  if (isNil(value) || !Number.isFinite(value)) {
    return <span className="dlt-flat">{qualifier ? <small>{qualifier}</small> : <small>no prior period</small>}</span>
  }
  if (value === 0) {
    return (
      <span className="dlt-flat">
        ■ flat {qualifier ? <small>{qualifier}</small> : null}
      </span>
    )
  }
  const up = value > 0
  return (
    <span className={up ? 'dlt-up' : 'dlt-dn'}>
      {up ? '▲' : '▼'} {Math.abs(value)}
      {suffix}
      {qualifier ? <small> {qualifier}</small> : null}
    </span>
  )
}

/** 90x22 trend line, coloured by direction — the mockup's pack-trend column. */
function MiniSparkline({ values }: { values: number[] }) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2 || clean.every((v) => v === 0)) return <span className="mut">—</span>

  const width = 90
  const height = 22
  const pad = 2
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const span = max - min || 1
  const rising = clean[clean.length - 1] >= clean[0]

  const points = clean.map((value, index) => {
    const x = pad + ((width - 2 * pad) * index) / (clean.length - 1)
    const y = height - pad - ((height - 2 * pad) * (value - min)) / span
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = points[points.length - 1].split(',')

  return (
    <svg className="mini-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={rising ? 'rising trend' : 'falling trend'}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={rising ? 'var(--good)' : 'var(--bad)'}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={rising ? 'var(--good)' : 'var(--bad)'} />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  unit,
  caption,
  delta,
  deltaQualifier,
  sparkline,
}: {
  label: string
  value: ReactNode
  unit?: string
  caption?: ReactNode
  delta?: number | null
  deltaQualifier?: string
  sparkline?: number[]
}) {
  return (
    <article className="oa-kpi">
      <div className="lab">{label}</div>
      <div className="num">
        {value}
        {unit ? <small> {unit}</small> : null}
      </div>
      <div className="dlt">
        {delta !== undefined ? <DeltaArrow value={delta} qualifier={deltaQualifier} /> : caption}
      </div>
      {sparkline && sparkline.length > 1 ? <Sparkline values={sparkline} /> : null}
    </article>
  )
}

function Card({
  title,
  hint,
  className,
  children,
}: {
  title?: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <article className={className ? `oa-card ${className}` : 'oa-card'}>
      {title ? <h5>{title}</h5> : null}
      {hint ? <div className="hint">{hint}</div> : null}
      {children}
    </article>
  )
}

function LeaderboardRow({
  rank,
  name,
  value,
  barPercent,
  color,
}: {
  rank: number
  name: string
  value: ReactNode
  barPercent: number
  color: string
}) {
  return (
    <div className="lb-item">
      <span className="rk">{rank}</span>
      <span className="nm">{name}</span>
      <span className="vl">{value}</span>
      <span className="lb-bar">
        <i style={{ width: `${Math.max(0, Math.min(100, barPercent))}%`, background: color }} />
      </span>
    </div>
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
  const labelFor = (option: RangeOption) => {
    switch (option) {
      case 'today':
        return 'Today'
      case '7d':
        return '7 days'
      case '30d':
        return '30 days'
      case '90d':
        return '90 days'
      case 'month':
        return 'This month'
    }
  }

  return (
    <div className="range-toggle">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === value ? 'range-pill active' : 'range-pill'}
          onClick={() => onChange(option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </div>
  )
}

function TopBar({
  title,
  date,
  theme,
  onToggleTheme,
  children,
}: {
  title: string
  date?: string
  theme: Theme
  onToggleTheme: () => void
  children?: ReactNode
}) {
  return (
    <div className="oa-top">
      <h1 className="disp">{title}</h1>
      {date ? <span className="date">{date} · IST</span> : null}
      <div className="top-actions">
        {children}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </div>
  )
}

function Sidebar({
  activePage,
  onChange,
  username,
}: {
  activePage: NavPage
  onChange: (next: NavPage) => void
  username: string
}) {
  const primary: Array<{ key: NavPage; label: string; icon: string }> = [
    { key: 'overview', label: 'Overview', icon: '☀️' },
    { key: 'live', label: 'Mission Control', icon: '🛰' },
    { key: 'brief', label: 'The Daily Brief', icon: '📰' },
    { key: 'engagement', label: 'Engagement', icon: '📈' },
    { key: 'content', label: 'Content & Games', icon: '❤️' },
    { key: 'conversations', label: 'Conversations', icon: '💬' },
    { key: 'families', label: 'Families', icon: '👨‍👩‍👧' },
    { key: 'costs', label: 'Costs', icon: '₹' },
  ]
  const operate: Array<{ key: NavPage; label: string; icon: string }> = [
    { key: 'operate', label: 'Fleet & OTA', icon: '🛠' },
    { key: 'rfidStudio', label: 'RFID Studio', icon: '🏷' },
    { key: 'contentLibrary', label: 'Content Library', icon: '📚' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const renderLink = (item: { key: NavPage; label: string; icon: string }) => (
    <button
      key={item.key}
      type="button"
      className={item.key === activePage ? 'nav-link active' : 'nav-link'}
      onClick={() => onChange(item.key)}
    >
      <span className="ic" aria-hidden="true">{item.icon}</span>
      {item.label}
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">🧸</span>
        Cheeko
      </div>
      <div className="sidebar-group">{primary.map(renderLink)}</div>
      <div className="sidebar-group">
        <div className="sidebar-group-title">Operate</div>
        {operate.map(renderLink)}
      </div>
      <div className="sidebar-footer">
        <span className="avatar">{initialsOf(username || 'Admin')}</span>
        <span>{username || 'Signed in'}</span>
      </div>
    </aside>
  )
}

function LoginPanel({
  username,
  password,
  loading,
  error,
  theme,
  onToggleTheme,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string
  password: string
  loading: boolean
  error: string
  theme: Theme
  onToggleTheme: () => void
  onUsernameChange: (next: string) => void
  onPasswordChange: (next: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="login-screen">
      <section className="login-card">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">🧸</span>
          Cheeko
        </div>
        <h2 className="disp">Sign in</h2>
        <p>Use your manager admin credentials to open the founder dashboard.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <form
          className="login-grid"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <input type="text" placeholder="Username" autoComplete="username" value={username} onChange={(event) => onUsernameChange(event.target.value)} />
          <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  )
}

/* ================================================================== *
 * Overview
 * ================================================================== */

function OverviewPage({
  range,
  overview,
  engagement,
  costs,
  operate,
  loading,
  username,
  theme,
  onToggleTheme,
  onRangeChange,
  onNavigate,
}: {
  range: RangeOption
  overview: OverviewResponse | null
  engagement: EngagementResponse | null
  costs: CostsResponse | null
  operate: OperateResponse | null
  loading: boolean
  username: string
  theme: Theme
  onToggleTheme: () => void
  onRangeChange: (next: RangeOption) => void
  onNavigate: (page: NavPage) => void
}) {
  const generatedAt = overview?.generatedAt ? formatLongDate(overview.generatedAt) : formatLongDate(new Date().toISOString())
  const split = overview?.sections.todaysSplit
  const totalMinutes = split?.totalMinutes || 0

  return (
    <>
      <TopBar title={`Good day${username ? `, ${username}` : ''}`} date={generatedAt} theme={theme} onToggleTheme={onToggleTheme}>
        <RangeToggle value={range} options={['today', '7d', '30d']} onChange={onRangeChange} />
      </TopBar>

      {loading && !overview ? <div className="loading-card">Loading founder overview…</div> : null}

      {overview ? (
        <>
          <section className="oa-kpis">
            <KpiCard
              label={`Active toys · ${rangeLabel(range)}`}
              value={formatNumber(overview.kpis?.activeToys?.total)}
              unit={`of ${formatNumber(overview.kpis?.activeToys?.fleetTotal)}`}
              delta={overview.deltas?.activeToys ?? null}
              deltaQualifier="vs prior period"
              sparkline={overview.kpis?.activeToys?.sparkline}
            />
            <KpiCard
              label="Play time"
              value={overview.kpis?.playTimeHours?.total?.toFixed(1) ?? DASH}
              unit="hrs"
              delta={overview.deltas?.playTimeHours ?? null}
              deltaQualifier="vs prior period"
              sparkline={overview.kpis?.playTimeHours?.sparkline}
            />
            <KpiCard
              label="Game sessions"
              value={formatNumber(overview.kpis?.sessions?.total)}
              delta={overview.deltas?.sessions ?? null}
              deltaQualifier="vs prior period"
              sparkline={overview.kpis?.sessions?.sparkline}
            />
            <KpiCard
              label="New families"
              value={formatNumber(overview.kpis?.newFamilies?.total)}
              delta={overview.deltas?.newFamilies ?? null}
              deltaQualifier="vs prior period"
              sparkline={overview.kpis?.newFamilies?.sparkline}
            />
            <KpiCard
              label="AI cost"
              value={formatMoney(overview.kpis?.aiCostInr?.total)}
              delta={overview.deltas?.aiCostInr ?? null}
              deltaQualifier="vs prior period"
              sparkline={overview.kpis?.aiCostInr?.sparkline}
            />
          </section>

          <section className="oa-row">
            <Card title="Where kids spend time" hint={`Minutes per day by feature · ${rangeLabel(range)} · from device usage rollups`}>
              <div className="oa-leg">
                <i style={{ ['--c' as string]: 'var(--c-ai)' }}>AI conversations</i>
                <i style={{ ['--c' as string]: 'var(--c-cards)' }}>Story &amp; rhyme cards</i>
                <i style={{ ['--c' as string]: 'var(--c-games)' }}>Games</i>
                <i style={{ ['--c' as string]: 'var(--c-radio)' }}>Radio</i>
              </div>
              <StackedUsageChart series={overview.sections.timeByFeature.series} />
              {overview.sections.timeByFeature.series.length > 1 ? (
                <div className="oa-axis">
                  <span>{formatCompactDate(overview.sections.timeByFeature.series[0].date)}</span>
                  <span>
                    {formatCompactDate(
                      overview.sections.timeByFeature.series[overview.sections.timeByFeature.series.length - 1].date,
                    )}
                  </span>
                </div>
              ) : null}
            </Card>

            <Card title="Today's split" hint={split?.hasData ? `Share of ${totalMinutes.toFixed(1)} total minutes` : 'No usage recorded today yet'}>
              {split?.hasData ? (
                <>
                  <div className="split">
                    {split.items.map((item, index) => {
                      const pct = totalMinutes ? (item.minutes / totalMinutes) * 100 : 0
                      return pct > 0 ? (
                        <b key={item.key} style={{ width: `${pct}%`, background: FEATURE_SERIES[index]?.color }} />
                      ) : null
                    })}
                  </div>
                  {split.items.map((item, index) => (
                    <div key={item.key} className="li" style={{ ['--c' as string]: FEATURE_SERIES[index]?.color }}>
                      {item.label} <small>· {item.minutes.toFixed(1)} min</small>
                      <b>{totalMinutes ? Math.round((item.minutes / totalMinutes) * 100) : 0}%</b>
                    </div>
                  ))}
                </>
              ) : (
                <div className="empty-state">Nothing played today so far.</div>
              )}
            </Card>
          </section>

          <section className="oa-row3">
            <Card title="Cards kids love" hint={`Taps · ${rangeLabel(range)} · ranked by total taps`} className="oa-lb">
              {overview.sections.cardsKidsLove.items.length ? (
                <>
                  {overview.sections.cardsKidsLove.items.map((item, index) => {
                    const top = overview.sections.cardsKidsLove.items[0].taps || 1
                    return (
                      <LeaderboardRow
                        key={item.name}
                        rank={index + 1}
                        name={item.name}
                        value={`${formatNumber(item.taps)} · ${item.uniqueDevices} toys`}
                        barPercent={(item.taps / top) * 100}
                        color="var(--c-cards)"
                      />
                    )
                  })}
                  {overview.sections.cardsKidsLove.unresolvedTapCount > 0 ? (
                    <div className="hint note">
                      {formatNumber(overview.sections.cardsKidsLove.unresolvedTapCount)} taps could not be matched to a pack — fix mappings in RFID Studio.
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">No card taps recorded in this range.</div>
              )}
            </Card>

            <Card title="Games — most played" hint="Plays and average score from device game rows" className="oa-lb">
              {overview.sections.gamesPlayedVsFinished.items.length ? (
                <>
                  {overview.sections.gamesPlayedVsFinished.items.map((item, index) => {
                    const top = overview.sections.gamesPlayedVsFinished.items[0].plays || 1
                    return (
                      <LeaderboardRow
                        key={item.name}
                        rank={index + 1}
                        name={item.name}
                        value={`${formatNumber(item.plays)} plays${item.avgScore !== null ? ` · ${item.avgScore}` : ''}`}
                        barPercent={(item.plays / top) * 100}
                        color="var(--c-games)"
                      />
                    )
                  })}
                  <div className="hint note">
                    Completion rates live on{' '}
                    <button type="button" className="lnk" onClick={() => onNavigate('content')}>Content &amp; Games →</button>
                  </div>
                </>
              ) : (
                <div className="empty-state">No game plays recorded in this range.</div>
              )}
            </Card>

            <Card title="What kids are talking about" hint="Keyword frequency across session summaries">
              {overview.sections.talkingAbout.items.length ? (
                <div className="topics">
                  {overview.sections.talkingAbout.items.map((item) => (
                    <span key={item.topic}>
                      {item.topic} · {item.mentions}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No session summaries in this range.</div>
              )}
              {overview.sections.talkingAbout.samples.map((sample) => (
                <div key={`${sample.macAddress}-${sample.updatedAt}`} className="oa-quote">
                  {sample.summary}
                  <small>
                    {sample.macAddress} · {formatDateTime(sample.updatedAt)}
                  </small>
                </div>
              ))}
            </Card>
          </section>

          <section className="oa-alerts">
            <article className="oa-alert warn">
              <span className="sig" aria-hidden="true">🟡</span>
              <div>
                <b>
                  {engagement ? `${engagement.sections.quietDeviceTotal} toys have gone quiet (7+ days)` : 'Quiet toys — loading…'}
                </b>
                <span>
                  {engagement
                    ? engagement.sections.quietDeviceTotal
                      ? 'Previously active toys with no usage in the last 7 days.'
                      : 'Every previously active toy has been used in the last 7 days.'
                    : 'Waiting on engagement data.'}
                </span>
              </div>
            </article>

            <article className="oa-alert crit">
              <span className="sig" aria-hidden="true">🔴</span>
              <div>
                <b>
                  {costs
                    ? costs.kpis.avgResponseTimeSeconds !== null
                      ? `Average response time ${costs.kpis.avgResponseTimeSeconds.toFixed(2)}s`
                      : 'Response time not recorded'
                    : 'Response time — loading…'}
                </b>
                <span>
                  {costs && costs.kpis.avgResponseTimeSeconds !== null
                    ? 'Mean time-to-first-token across billed sessions.'
                    : 'No TTFT values recorded for this period.'}
                </span>
              </div>
            </article>

            <article className="oa-alert info">
              <span className="sig" aria-hidden="true">🔵</span>
              <div>
                <b>
                  {operate
                    ? `${operate.sections.firmwareCoverage.filter((item) => !item.isLatest).reduce((sum, item) => sum + item.count, 0)} toys behind latest firmware`
                    : 'Firmware coverage — loading…'}
                </b>
                <span>
                  {operate
                    ? operate.kpis.latestFirmwareVersion
                      ? `Latest is ${operate.kpis.latestFirmwareVersion}. Manage rollout in Fleet & OTA.`
                      : 'No firmware releases registered yet.'
                    : 'Waiting on fleet data.'}
                </span>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Mission Control
 * ================================================================== */

function TtftTrendChart({ items }: { items: LiveResponse['sections']['ttftTrend'] }) {
  const measured = items.filter((item) => item.seconds !== null)
  if (measured.length < 2) return <div className="ob-empty">Not enough response-time samples to plot a trend.</div>

  const width = 620
  const height = 120
  const pad = 8
  const values = items.map((item) => item.seconds)
  const known = values.filter((v): v is number => v !== null)
  const max = Math.max(...known) * 1.15
  const min = Math.min(...known) * 0.85
  const span = max - min || 1

  const xOf = (index: number) => pad + ((width - 2 * pad) * index) / (items.length - 1)
  const yOf = (value: number) => height - pad - ((height - 2 * pad) * (value - min)) / span

  let path = ''
  values.forEach((value, index) => {
    if (value === null) return
    path += `${path ? 'L' : 'M'} ${xOf(index).toFixed(1)} ${yOf(value).toFixed(1)} `
  })

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ height: 120 }} role="img" aria-label="Average time to first token">
      {[0.33, 0.66].map((ratio) => (
        <line key={ratio} className="ob-grid-line" x1={pad} y1={pad + (height - 2 * pad) * ratio} x2={width - pad} y2={pad + (height - 2 * pad) * ratio} />
      ))}
      <path className="ob-trend-line" d={path.trim()} />
    </svg>
  )
}

function MissionControlPage({
  data,
  loading,
  theme,
  onToggleTheme,
}: {
  data: LiveResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
}) {
  const quality = data?.sections.sessionQuality
  const spend = data?.sections.spend
  const peakHourSessions = Math.max(...(data?.sections.hourlySessions.map((item) => item.sessions) || [0]), 1)
  // the month the spend actually accumulated in, not a generic "month to date"
  const monthName = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' })
    : ''

  return (
    <>
      <TopBar
        title="Mission Control"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      >
        <span className="ob-chip live">LIVE</span>
      </TopBar>

      {loading && !data ? <div className="loading-card">Loading the live wall…</div> : null}

      {data ? (
        <div className="ob">
          <div className="ob-bar">
            <span className="brand">
              CHEEKO <em>MISSION CONTROL</em>
            </span>
            <span className="t">
              {data.generatedAt
                ? new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })
                : ''}{' '}
              IST
            </span>
          </div>

          <div className="ob-grid">
            {/* ---- left: live column ---- */}
            <div className="ob-col">
              <div className="ob-card">
                <h6>Online right now</h6>
                <div className="ob-big">
                  {data.kpis.onlineNow}
                  <small> / {data.kpis.fleetSize} toys</small>
                </div>
                <div className="ob-sub">
                  {data.kpis.peakSessionsHour
                    ? `Busiest hour today ${String(data.kpis.peakSessionsHour.hour).padStart(2, '0')}:00 · ${data.kpis.peakSessionsHour.sessions} sessions`
                    : 'No sessions recorded yet today'}
                </div>
              </div>

              <div className="ob-card">
                <h6>Live toys</h6>
                {data.sections.liveToys.length ? (
                  data.sections.liveToys.map((toy) => (
                    <div key={toy.macAddress} className="ob-dev">
                      <span className="st" />
                      <span className="mac">{toy.macAddress}</span>
                      {toy.battery !== null ? (
                        <span className={toy.battery < 20 ? 'ob-batt low' : 'ob-batt'}>
                          <i style={{ ['--p' as string]: `${Math.max(0, Math.min(100, toy.battery))}%` }} />
                        </span>
                      ) : null}
                      <span className="kid">
                        {toy.kidName || toy.alias}
                        {toy.mode ? ` · ${toy.mode}` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="ob-empty">No toys are online right now.</div>
                )}
              </div>

              <div className="ob-card ob-meter">
                <h6>{monthName} AI spend</h6>
                <div className="ob-big sm">
                  {formatMoneyCompact(spend?.monthToDate)}
                  {spend?.monthlyBudget ? <small> / {formatMoneyCompact(spend.monthlyBudget)} budget</small> : null}
                </div>
                {spend?.monthlyBudget && spend.budgetUsedPercent !== null ? (
                  <>
                    <div className="track">
                      <i style={{ width: `${Math.min(spend.budgetUsedPercent, 100)}%` }} />
                    </div>
                    <div className="row">
                      <span>
                        {spend.budgetUsedPercent}% used · day {spend.dayOfMonth} of {spend.daysInMonth}
                      </span>
                      <span>on pace {formatMoneyCompact(spend.projectedMonth)}</span>
                    </div>
                  </>
                ) : (
                  <div className="ob-empty">
                    No budget configured · on pace {formatMoneyCompact(spend?.projectedMonth)} for the month
                  </div>
                )}
              </div>
            </div>

            {/* ---- centre: numbers wall + heat + trend ---- */}
            <div className="ob-col">
              <div className="ob-kwall">
                <div className="ob-card">
                  <h6>Active today</h6>
                  <div className="ob-big sm">{data.kpis.activeToday}</div>
                </div>
                <div className="ob-card">
                  <h6>This week</h6>
                  <div className="ob-big sm">{data.kpis.activeThisWeek}</div>
                </div>
                <div className="ob-card">
                  <h6>This month</h6>
                  <div className="ob-big sm">{data.kpis.activeThisMonth}</div>
                  <div className="ob-sub">
                    {data.kpis.dauMauRatio !== null ? `DAU/MAU ${data.kpis.dauMauRatio}%` : 'DAU/MAU —'}
                  </div>
                </div>
              </div>

              <div className="ob-card">
                <h6>Activity by hour · today (sessions)</h6>
                <div className="ob-heat" role="img" aria-label="Sessions by hour of day">
                  {data.sections.hourlySessions.map((bucket) => (
                    <b
                      key={bucket.hour}
                      style={{ opacity: bucket.sessions === 0 ? 0.08 : 0.16 + 0.84 * (bucket.sessions / peakHourSessions) }}
                      title={`${String(bucket.hour).padStart(2, '0')}:00 · ${bucket.sessions} session${bucket.sessions === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
                <div className="ob-heat-x">
                  <span>12a</span>
                  <span>6a</span>
                  <span>12p</span>
                  <span>6p</span>
                  <span>11p</span>
                </div>
              </div>

              <div className="ob-card">
                <h6>Response speed · avg TTFT, 14 days</h6>
                <TtftTrendChart items={data.sections.ttftTrend} />
                <div className="ob-axis">
                  <span>{formatCompactDate(data.sections.ttftTrend[0].date)}</span>
                  <span>{formatCompactDate(data.sections.ttftTrend[data.sections.ttftTrend.length - 1].date)}</span>
                </div>
                <div className="ob-leg">
                  <i style={{ ['--c' as string]: 'var(--ob-accent)' }}>avg TTFT (s)</i>
                </div>
              </div>
            </div>

            {/* ---- right: live feed + quality ---- */}
            <div className="ob-col">
              <div className="ob-card ob-feed">
                <h6>Happening now</h6>
                {data.sections.feed.length ? (
                  data.sections.feed.map((item, index) => (
                    <div key={`${item.kind}-${item.macAddress}-${item.at}-${index}`} className="it">
                      <span className="tm">
                        {new Date(item.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </span>
                      <span className={`tag ${item.kind}`}>{item.kind.toUpperCase()}</span>
                      <b>{item.label}</b> {item.detail}
                    </div>
                  ))
                ) : (
                  <div className="ob-empty">Nothing has happened yet today.</div>
                )}
              </div>

              <div className="ob-card">
                <h6>Session quality today</h6>
                <div className="ob-quality">
                  <div>
                    <div className="ob-big xs">{quality?.answerAccuracy !== null && quality ? `${quality.answerAccuracy}%` : DASH}</div>
                    <div className="lab">answer accuracy</div>
                  </div>
                  <div>
                    <div className="ob-big xs">
                      {quality?.avgSessionMinutes !== null && quality ? quality.avgSessionMinutes : DASH}
                      {quality?.avgSessionMinutes !== null ? <small> min</small> : null}
                    </div>
                    <div className="lab">avg session</div>
                  </div>
                  <div>
                    <div className="ob-big xs">
                      {quality?.avgTtftSeconds !== null && quality ? quality.avgTtftSeconds : DASH}
                      {quality?.avgTtftSeconds !== null ? <small> s</small> : null}
                    </div>
                    <div className="lab">avg TTFT</div>
                  </div>
                  <div>
                    <div className="ob-big xs">
                      {quality?.completedSessionsPercent !== null && quality ? `${quality.completedSessionsPercent}%` : DASH}
                    </div>
                    <div className="lab">sessions completed</div>
                  </div>
                </div>
                <div className="ob-sub">
                  From {quality?.sessionsCounted ?? 0} sessions and {quality?.attemptsCounted ?? 0} scored answers today.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * The Daily Brief
 * ================================================================== */

function BriefTrendChart({ items }: { items: BriefResponse['playHoursSeries'] }) {
  if (items.length < 2) return <div className="oc-empty">Not enough days recorded to plot a trend.</div>

  const width = 620
  const height = 140
  const pad = 8
  const values = items.map((item) => item.hours)
  const max = Math.max(...values, 1) * 1.1

  const xOf = (index: number) => pad + ((width - 2 * pad) * index) / (items.length - 1)
  const yOf = (value: number) => height - pad - ((height - 2 * pad) * value) / max

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(1)} ${yOf(value).toFixed(1)}`).join(' ')
  const area = `${line} L ${xOf(items.length - 1).toFixed(1)} ${height - pad} L ${xOf(0).toFixed(1)} ${height - pad} Z`

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ height: 140 }} role="img" aria-label="Daily play hours over 30 days">
      {[0.33, 0.66].map((ratio) => (
        <line key={ratio} className="oc-brief-grid" x1={pad} y1={pad + (height - 2 * pad) * ratio} x2={width - pad} y2={pad + (height - 2 * pad) * ratio} />
      ))}
      <path className="oc-brief-area" d={area} />
      <path className="oc-brief-line" d={line} />
    </svg>
  )
}

function DailyBriefPage({
  data,
  loading,
  theme,
  onToggleTheme,
}: {
  data: BriefResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
}) {
  const deltaMark = (value: number | null) => {
    if (value === null) return <div className="d">no prior day</div>
    if (value === 0) return <div className="d">flat</div>
    return <div className={value > 0 ? 'd up' : 'd dn'}>{value > 0 ? `▲ ${value}%` : `▼ ${Math.abs(value)}%`}</div>
  }

  return (
    <>
      <TopBar
        title="The Daily Brief"
        date={data?.coverDate ? `covering ${formatLongDate(`${data.coverDate}T00:00:00+05:30`)}` : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      {loading && !data ? <div className="loading-card">Writing today's brief…</div> : null}

      {data ? (
        <div className="oc">
          <div className="oc-inner">
            <div className="oc-mast">
              <div className="over">Every morning · covering the previous day · IST</div>
              <h3>
                The <em>Cheeko</em> Brief
              </h3>
              <div className="dt">{formatLongDate(`${data.coverDate}T00:00:00+05:30`)}</div>
            </div>

            {data.headline.activeToys > 0 ? (
              <p className="oc-lede">
                <b>
                  {data.headline.activeToys} {data.headline.activeToys === 1 ? 'Cheeko' : 'Cheekos'} came alive
                </b>{' '}
                for {data.headline.playHours} hours of play across {data.headline.sessions}{' '}
                {data.headline.sessions === 1 ? 'session' : 'sessions'}.
              </p>
            ) : (
              <p className="oc-lede">No toys recorded any play on this day.</p>
            )}
            <div className="oc-byline">
              Compiled automatically from device telemetry, card taps and session summaries.
            </div>

            <div className="oc-strip">
              <div>
                <div className="n">{data.headline.activeToys}</div>
                <div className="l">active toys</div>
                {deltaMark(data.deltas.activeToys)}
              </div>
              <div>
                <div className="n">{data.headline.playHours}h</div>
                <div className="l">play time</div>
                {deltaMark(data.deltas.playHours)}
              </div>
              <div>
                <div className="n">{data.headline.sessions}</div>
                <div className="l">sessions</div>
                {deltaMark(data.deltas.sessions)}
              </div>
              <div>
                <div className="n">{formatMoneyCompact(data.headline.costInr)}</div>
                <div className="l">AI cost</div>
                <div className="d">
                  {data.headline.activeToys
                    ? `${formatMoney(data.headline.costInr / data.headline.activeToys)} / toy`
                    : 'no active toys'}
                </div>
              </div>
            </div>

            <h4>Three things to know</h4>
            {data.threeThings.length ? (
              data.threeThings.map((item, index) => (
                <div key={item.title} className="oc-item">
                  <div className="n">{index + 1}</div>
                  <div>
                    <h5>{item.title}</h5>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="oc-empty">
                Nothing moved enough this week to call out. Insights appear once there is week-over-week change to measure.
              </div>
            )}

            <h4>The month in one chart</h4>
            <div className="oc-chartcard">
              <div className="t">Daily play time · last 30 days</div>
              <div className="s">hours across the fleet</div>
              <BriefTrendChart items={data.playHoursSeries} />
              {data.playHoursSeries.length > 1 ? (
                <div className="oc-axis">
                  <span>{formatCompactDate(data.playHoursSeries[0].date)}</span>
                  <span>{formatCompactDate(data.playHoursSeries[data.playHoursSeries.length - 1].date)}</span>
                </div>
              ) : null}
            </div>

            <h4>Heard on Cheeko</h4>
            {data.quotes.length ? (
              <div className="oc-quotes">
                {data.quotes.map((quote) => (
                  <blockquote key={`${quote.macAddress}-${quote.updatedAt}`}>
                    {quote.summary}
                    <span>
                      — {quote.macAddress} · {formatDateTime(quote.updatedAt)}
                    </span>
                  </blockquote>
                ))}
              </div>
            ) : (
              <div className="oc-empty">No conversation summaries were recorded on this day.</div>
            )}

            <h4>Movers this week</h4>
            {data.movers.length ? (
              <table className="oc-movers">
                <tbody>
                  {data.movers.map((mover) => (
                    <tr key={mover.label} className={mover.changePercent >= 0 ? 'up' : 'dn'}>
                      <td>{mover.label}</td>
                      <td>
                        {mover.changePercent > 0 ? '+' : ''}
                        {mover.changePercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="oc-empty">No week-over-week movement to report yet.</div>
            )}

            <div className="oc-foot">
              Every figure on this page is measured from stored telemetry — nothing here is estimated or illustrative.
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Engagement
 * ================================================================== */

function EngagementPage({
  range,
  data,
  loading,
  theme,
  onToggleTheme,
  onRangeChange,
}: {
  range: RangeOption
  data: EngagementResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <>
      <TopBar
        title="Engagement"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </TopBar>

      {loading && !data ? <div className="loading-card">Loading engagement view…</div> : null}

      {data ? (
        <>
          <section className="oa-kpis">
            <KpiCard label="Active yesterday" value={formatNumber(data.kpis.activeYesterday)} caption={<small>toys with usage yesterday</small>} />
            <KpiCard label="Weekly actives" value={formatNumber(data.kpis.weeklyActives)} delta={data.deltas.weeklyActives} deltaQualifier="vs prior week" />
            <KpiCard
              label="Monthly actives"
              value={formatNumber(data.kpis.monthlyActives)}
              unit={`of ${data.kpis.fleetTotal}`}
              delta={data.deltas.monthlyActives}
              deltaQualifier="vs prior period"
            />
            <KpiCard label="Stickiness · DAU/MAU" value={formatPercent(data.kpis.dauMauRatio)} caption={<small>yesterday ÷ range actives</small>} />
            <KpiCard label="Avg session" value={data.kpis.avgSessionMinutes.toFixed(1)} unit="min" delta={data.deltas.avgSessionMinutes} deltaQualifier="vs prior period" />
          </section>

          <section className="oa-row">
            <Card title={`Daily active toys · ${rangeLabel(range)}`} hint="Bold line = 7-day average (starts once 7 days are available)">
              <div className="oa-leg">
                <i style={{ ['--c' as string]: 'var(--c-ai)' }}>daily actives</i>
                <i style={{ ['--c' as string]: 'var(--ink-4)' }}>7-day avg</i>
              </div>
              <TrendChart items={data.sections.dailyActives} />
              {data.sections.dailyActives.length > 1 ? (
                <div className="oa-axis">
                  <span>{formatCompactDate(data.sections.dailyActives[0].date)}</span>
                  <span>{formatCompactDate(data.sections.dailyActives[data.sections.dailyActives.length - 1].date)}</span>
                </div>
              ) : null}
            </Card>

            <Card title="Coming back?" hint={`Trailing 7 days vs the 7 before · ${data.sections.returningSplit.previousWeekActives} toys were active then`}>
              <div className="split">
                {data.sections.returningSplit.previousWeekActives ? (
                  <>
                    <b
                      style={{
                        width: `${((data.sections.returningSplit.returnedCount / data.sections.returningSplit.previousWeekActives) * 100).toFixed(1)}%`,
                        background: 'var(--c-games)',
                      }}
                    />
                    <b style={{ flex: 1, background: 'var(--ink-4)' }} />
                  </>
                ) : (
                  <b style={{ width: '100%', background: 'var(--track)' }} />
                )}
              </div>
              <div className="li" style={{ ['--c' as string]: 'var(--c-games)' }}>
                Returned this week
                <b>
                  {data.sections.returningSplit.returnedCount} toys
                  {data.sections.returningSplit.returnedRate !== null ? ` · ${data.sections.returningSplit.returnedRate}%` : ''}
                </b>
              </div>
              <div className="li" style={{ ['--c' as string]: 'var(--ink-4)' }}>
                Didn&apos;t return
                <b>{Math.max(0, data.sections.returningSplit.previousWeekActives - data.sections.returningSplit.returnedCount)} toys</b>
              </div>
              <div className="li" style={{ ['--c' as string]: 'var(--c-cards)' }}>
                New this week
                <b>{data.sections.returningSplit.newCount} toys</b>
              </div>
              <div className="hint note">{data.sections.returningSplit.windowLabel}</div>
            </Card>
          </section>

          <section className="oa-row">
            <Card title="When kids play · sessions by hour" hint={`${rangeLabel(range)} · IST · darker = more sessions`}>
              <SessionsHeatmap rows={data.sections.sessionsHeatmap} />
              <div className="oa-axis inset">
                <span>12a</span>
                <span>6a</span>
                <span>12p</span>
                <span>6p</span>
                <span>11p</span>
              </div>
            </Card>

            <Card
              title="Quiet toys watchlist"
              hint={`Had usage in the last 60 days, none in the last 7 · ${data.sections.quietDeviceTotal} total`}
            >
              {data.sections.quietDevices.length ? (
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Toy / kid</th>
                        <th>Parent</th>
                        <th className="num">Quiet for</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sections.quietDevices.slice(0, 8).map((item) => (
                        <tr key={item.macAddress}>
                          <td>{item.kidName || item.alias}</td>
                          <td className="mut">{item.parentName || DASH}</td>
                          <td className="num">
                            <span className={item.quietDays >= 10 ? 'badge crit' : 'badge warn'}>{item.quietDays} days</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No previously active toy has gone quiet.</div>
              )}
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Content & games
 * ================================================================== */

function ContentPage({
  range,
  data,
  loading,
  theme,
  onToggleTheme,
  onRangeChange,
}: {
  range: RangeOption
  data: ContentResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <>
      <TopBar
        title="Content & Games"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </TopBar>

      {loading && !data ? <div className="loading-card">Loading content view…</div> : null}

      {data ? (
        <>
          <section className="oa-kpis">
            <KpiCard label="Card taps" value={formatNumber(data.kpis.cardTaps)} delta={data.deltas.cardTaps} deltaQualifier="vs prior period" />
            <KpiCard
              label="Packs in use"
              value={formatNumber(data.kpis.packsInUse)}
              unit={`of ${data.kpis.catalogTotal}`}
              delta={data.deltas.packsInUse}
              deltaQualifier="vs prior period"
            />
            <KpiCard label="Game plays" value={formatNumber(data.kpis.gamePlays)} delta={data.deltas.gamePlays} deltaQualifier="vs prior period" />
            <KpiCard
              label="Avg completion"
              value={data.kpis.avgCompletionRate === null ? <span className="not-tracked">Not recorded</span> : formatPercent(data.kpis.avgCompletionRate)}
              caption={<small>{data.kpis.avgCompletionRate === null ? 'no session completion data' : 'across games with sessions'}</small>}
            />
            <KpiCard label="Story & music plays" value={formatNumber(data.kpis.mediaPlays)} delta={data.deltas.mediaPlays} deltaQualifier="vs prior period" />
          </section>

          <Card
            className="spaced"
            title="Card packs — ranked by love"
            hint="Taps · unique toys · repeat rate (taps per toy — our strongest 'like' proxy)"
          >
            {data.sections.packLeaderboard.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Pack</th>
                      <th className="num">Taps · {rangeLabel(range)}</th>
                      <th className="num">Toys</th>
                      <th className="num">Repeat rate</th>
                      <th className="num">vs last week</th>
                      <th>14-day trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sections.packLeaderboard.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td className="num">{formatNumber(item.taps)}</td>
                        <td className="num">{item.uniqueDevices}</td>
                        <td className="num">{item.repeatRate}×</td>
                        <td className="num">
                          <DeltaArrow value={item.changePercent} />
                        </td>
                        <td>
                          <MiniSparkline values={item.trend} />
                        </td>
                      </tr>
                    ))}
                    {data.sections.unresolvedTapCount > 0 ? (
                      <tr>
                        <td className="mut">Unresolved taps ⚠️</td>
                        <td className="num mut">{formatNumber(data.sections.unresolvedTapCount)}</td>
                        <td className="num mut">{DASH}</td>
                        <td className="num mut">{DASH}</td>
                        <td className="num mut">{DASH}</td>
                        <td className="mut">fix mappings in RFID Studio</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No card taps recorded in this range.</div>
            )}
          </Card>

          <section className="oa-row">
            <Card title="Games — played vs finished" hint="Completion comes from game sessions that record a completion status">
              {data.sections.games.length ? (
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Game</th>
                        <th className="num">Plays</th>
                        <th style={{ width: 130 }}>Completion</th>
                        <th className="num">Avg score</th>
                        <th className="num">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sections.games.map((item) => (
                        <tr key={item.name}>
                          <td>{item.name}</td>
                          <td className="num">{formatNumber(item.plays)}</td>
                          <td>
                            {item.completionRate === null ? (
                              <span className="mut">no session data</span>
                            ) : (
                              <div className={item.completionRate < 60 ? 'cbar warn' : 'cbar'}>
                                <i style={{ width: `${item.completionRate}%` }} />
                              </div>
                            )}
                          </td>
                          <td className="num">{item.avgScore === null ? DASH : `${item.avgScore}/10`}</td>
                          <td className="num">
                            <span
                              className={
                                item.completionRate === null
                                  ? 'badge mut'
                                  : item.completionRate >= 70
                                    ? 'badge ok'
                                    : item.completionRate >= 55
                                      ? 'badge warn'
                                      : 'badge crit'
                              }
                            >
                              {item.completionRate === null ? item.status : `${item.completionRate}% · ${item.status}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No game activity recorded in this range.</div>
              )}
            </Card>

            <Card title="Stories, music & radio" hint={`Most played · ${rangeLabel(range)}`}>
              {data.sections.media.length || data.sections.radio.length ? (
                <>
                  {data.sections.media.map((item) => (
                    <div key={item.title} className="li" style={{ ['--c' as string]: 'var(--c-cards)' }}>
                      {item.title} <small>· {item.type}</small>
                      <b>{formatNumber(item.plays)} plays</b>
                    </div>
                  ))}
                  {data.sections.radio.map((item) => (
                    <div key={item.station} className="li" style={{ ['--c' as string]: 'var(--c-radio)' }}>
                      {item.station} <small>· radio</small>
                      <b>{Math.round(item.minutes)} min</b>
                    </div>
                  ))}
                </>
              ) : (
                <div className="empty-state">No story, music, or radio playback in this range.</div>
              )}

              <h5 className="sub">Losing steam</h5>
              <div className="hint">Falling week over week — candidates for refresh or retirement</div>
              {data.sections.losingSteam.length ? (
                data.sections.losingSteam.map((item) => (
                  <div key={`${item.name}-${item.metric}`} className="li noc">
                    {item.name} <small>· {item.metric}</small>
                    <b className="dn">
                      {item.metric === 'completion' && item.changePoints !== undefined
                        ? `▼ ${Math.abs(item.changePoints)} pts`
                        : `▼ ${Math.abs(item.changePercent ?? 0)}%`}
                      {item.consecutiveWeeks >= 2 ? ' · 2nd week' : ''}
                    </b>
                  </div>
                ))
              ) : (
                <div className="empty-state">Nothing is trending down week over week.</div>
              )}
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Conversations
 * ================================================================== */

function ConversationsPage({
  range,
  data,
  loading,
  transcript,
  transcriptLoading,
  selectedSessionId,
  onSelectSession,
  theme,
  onToggleTheme,
  onRangeChange,
}: {
  range: RangeOption
  data: ConversationsResponse | null
  loading: boolean
  transcript: TranscriptResponse | null
  transcriptLoading: boolean
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  theme: Theme
  onToggleTheme: () => void
  onRangeChange: (next: RangeOption) => void
}) {
  return (
    <>
      <TopBar
        title="Conversations"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      >
        <RangeToggle value={range} options={['7d', '30d', '90d']} onChange={onRangeChange} />
      </TopBar>

      {loading && !data ? <div className="loading-card">Loading conversations view…</div> : null}

      {data ? (
        <>
          <section className="oa-kpis">
            <KpiCard label="AI talk time" value={data.kpis.talkHours.toFixed(1)} unit="hrs" delta={data.deltas.talkHours} deltaQualifier="vs prior period" />
            <KpiCard label="Talk sessions" value={formatNumber(data.kpis.talkSessions)} delta={data.deltas.talkSessions} deltaQualifier="vs prior period" />
            <KpiCard label="Avg turns / session" value={data.kpis.avgTurnsPerSession.toFixed(1)} delta={data.deltas.avgTurnsPerSession} deltaQualifier="vs prior period" />
            <KpiCard label="Topics detected" value={formatNumber(data.kpis.topicsDetected)} caption={<small>distinct keywords mined</small>} />
            <KpiCard
              label="Moderation flags"
              value={<span className="not-tracked">Not tracked</span>}
              caption={<small>{formatNumber(data.kpis.screenedMessages)} messages exchanged · no moderation log yet</small>}
            />
          </section>

          <Card
            className="spaced"
            title="What the fleet is talking about"
            hint="Keyword frequency across session summaries — a word count, not a semantic topic model"
          >
            {data.sections.topics.length ? (
              <div className="topics">
                {data.sections.topics.map((item, index) => (
                  <span key={item.topic} className={index < 3 ? 'big' : undefined}>
                    {item.topic} · {item.mentions}
                  </span>
                ))}
              </div>
            ) : (
              <div className="empty-state">No session summaries in this range.</div>
            )}
          </Card>

          <section className="oa-row half">
            <Card title="Session summaries" hint="AI-written summary per session · newest first">
              {data.sections.summaries.length ? (
                data.sections.summaries.map((item) => (
                  <div key={item.id} className="conv">
                    <b className="t">
                      {item.headline}
                      {item.tags.map((tag) => (
                        <span key={tag} className="tg">{tag}</span>
                      ))}
                    </b>
                    <small>
                      {item.macAddress} · {formatDateTime(item.updatedAt)} · {item.turns} turns
                    </small>{' '}
                    ·{' '}
                    <button type="button" className="lnk" onClick={() => onSelectSession(item.sessionId)}>
                      Transcript →
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">No conversation summaries in this range.</div>
              )}
            </Card>

            <Card title="Transcript" hint="Real messages for the selected session · admin only">
              {transcriptLoading ? <div className="loading-card">Loading transcript…</div> : null}
              {!transcriptLoading && !selectedSessionId ? (
                <div className="empty-state">Pick a session summary to read its transcript.</div>
              ) : null}
              {!transcriptLoading && selectedSessionId && transcript ? (
                transcript.lines.length ? (
                  <div className="chatpane">
                    <div className="hd">
                      🧸 {transcript.macAddress || 'Session'}
                      <small>
                        {transcript.turns} turns · {formatDateTime(transcript.updatedAt)}
                      </small>
                    </div>
                    {transcript.lines.map((line, index) => (
                      <div key={`${line.speaker}-${index}`} className={line.speaker === 'Cheeko' ? 'bub toy' : 'bub kid'}>
                        {line.text}
                        <small>
                          {line.speaker}
                          {line.createdAt ? ` · ${formatDateTime(line.createdAt)}` : ''}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No stored messages for this session.</div>
                )
              ) : null}
              {!transcriptLoading && selectedSessionId && !transcript ? (
                <div className="empty-state">Transcript unavailable for this session.</div>
              ) : null}
              <div className="hint note">
                Privacy: transcripts are restricted to super-admins and parent contact details are never shown.
              </div>
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Families
 * ================================================================== */

function FamiliesPage({
  theme,
  onToggleTheme,
  searchTerm,
  onSearchTermChange,
  searchResults,
  searching,
  onSelectResult,
  view,
  onBack,
  profile,
  loadingProfile,
  families,
  familiesLoading,
  familiesTotal,
}: {
  theme: Theme
  onToggleTheme: () => void
  searchTerm: string
  onSearchTermChange: (next: string) => void
  searchResults: SearchResponse | null
  searching: boolean
  onSelectResult: (result: SearchResult) => void
  view: 'list' | 'detail'
  onBack: () => void
  profile: FamilyProfile | null
  loadingProfile: boolean
  families: FamilyListEntry[]
  familiesLoading: boolean
  familiesTotal: number
}) {
  const hasQuery = searchTerm.trim().length >= 2
  const resultCount = searchResults
    ? searchResults.kids.length + searchResults.parents.length + searchResults.devices.length
    : 0

  if (view === 'detail') {
    const age = getAge(profile?.kid.birthDate)
    const weekSplitTotal = profile?.thisWeek.split.reduce((sum, item) => sum + item.minutes, 0) || 0
    const streak = profile?.progress.reduce((best, item) => Math.max(best, item.currentStreak), 0) ?? 0
    const longestStreak = profile?.progress.reduce((best, item) => Math.max(best, item.longestStreak), 0) ?? 0

    return (
      <>
        <TopBar title="Family 360" theme={theme} onToggleTheme={onToggleTheme}>
          <button type="button" className="secondary-button" onClick={onBack}>← Back to families</button>
        </TopBar>

        {loadingProfile && !profile ? <div className="loading-card">Loading family profile…</div> : null}
        {!loadingProfile && !profile ? <div className="empty-state large">Unable to load this family profile.</div> : null}

        {profile ? (
          <>
            <Card>
              <div className="pf-head">
                <div className="pf-ava">{initialsOf(profile.kid.name)}</div>
                <div>
                  <h4 className="disp">
                    {profile.kid.name}
                    {age !== null ? ` · ${age} yrs` : ''}
                  </h4>
                  <div className="sub3">
                    {profile.parent.displayName ? <>Parent: <b>{profile.parent.displayName}</b> · </> : null}
                    {profile.kid.grade ? `${profile.kid.grade} · ` : ''}
                    {profile.kid.memberSince ? `joined ${formatCompactDate(profile.kid.memberSince)}` : 'join date unknown'}
                  </div>
                </div>
                <div className="pf-chips">
                  {profile.kid.interests.slice(0, 4).map((interest) => (
                    <span key={interest}>{interest}</span>
                  ))}
                  {profile.kid.grade ? <span>{profile.kid.grade}</span> : null}
                  {profile.kid.language ? <span>{profile.kid.language}</span> : null}
                  <span className="blue">
                    {profile.quota.allowance !== null
                      ? `Quota ${profile.quota.questionsUsed} / ${profile.quota.allowance} questions`
                      : `${profile.quota.questionsUsed} questions used`}
                  </span>
                </div>
              </div>
            </Card>

            <section className="pf-kpis">
              <KpiCard
                label="Play this week"
                value={formatDuration(profile.thisWeek.playSeconds)}
                caption={<small>last 7 days</small>}
                sparkline={profile.thisWeek.sparkline}
              />
              <KpiCard label="Current streak" value={formatNumber(streak)} unit="days" caption={<small>longest: {longestStreak} days</small>} />
              <KpiCard label="Active days · 7d" value={formatNumber(profile.thisWeek.sessions)} caption={<small>days with recorded usage</small>} />
              <KpiCard
                label="Questions used"
                value={formatNumber(profile.quota.questionsUsed)}
                caption={<small>{profile.quota.extraPurchased ? `+${profile.quota.extraPurchased} purchased` : 'this month'}</small>}
              />
            </section>

            <div className="pf-grid">
              <div>
                <Card title={`Where ${profile.kid.name}'s time goes`} hint="Last 7 days">
                  {weekSplitTotal > 0 ? (
                    <>
                      <div className="split">
                        {profile.thisWeek.split.map((item, index) => {
                          const pct = (item.minutes / weekSplitTotal) * 100
                          return pct > 0 ? (
                            <b key={item.key} style={{ width: `${pct}%`, background: FEATURE_SERIES[index]?.color }} />
                          ) : null
                        })}
                      </div>
                      <div className="oa-leg">
                        {profile.thisWeek.split.map((item, index) => (
                          <i key={item.key} style={{ ['--c' as string]: FEATURE_SERIES[index]?.color }}>
                            {item.label} {Math.round((item.minutes / weekSplitTotal) * 100)}%
                          </i>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">No usage recorded in the last 7 days.</div>
                  )}
                </Card>

                <Card className="spaced" title="Recent conversations" hint="AI summaries from this family's toys">
                  {profile.recentSummaries.length ? (
                    profile.recentSummaries.map((item) => (
                      <div key={`${item.macAddress}-${item.updatedAt}`} className="conv">
                        <b className="t">{item.summary}</b>
                        <small>
                          {item.macAddress} · {formatDateTime(item.updatedAt)}
                        </small>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No conversation summaries recorded yet.</div>
                  )}
                </Card>
              </div>

              <div>
                <Card title={profile.devices.length === 1 ? 'Their toy' : 'Their toys'}>
                  {profile.devices.length ? (
                    profile.devices.map((device) => (
                      <div key={device.id} className="pf-dev">
                        <span className={device.online ? 'on' : 'on off'} />
                        <span className="mac">{device.macAddress}</span>
                        <small>
                          {device.online ? 'online' : 'offline'}
                          {device.battery !== null ? ` · ${device.battery}%` : ''}
                          {device.firmware ? ` · ${device.firmware}` : ''}
                        </small>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No toys linked to this family.</div>
                  )}
                </Card>

                <Card className="spaced oa-lb" title={`${profile.kid.name} loves`} hint="By taps and plays across their toys">
                  {profile.contentLove.cards.length || profile.contentLove.games.length ? (
                    <>
                      {profile.contentLove.cards.map((item, index) => {
                        const top = profile.contentLove.cards[0].taps || 1
                        return (
                          <LeaderboardRow
                            key={`card-${item.name}`}
                            rank={index + 1}
                            name={item.name}
                            value={`${item.taps} taps`}
                            barPercent={(item.taps / top) * 100}
                            color="var(--c-cards)"
                          />
                        )
                      })}
                      {profile.contentLove.games.map((item, index) => {
                        const top = profile.contentLove.games[0].plays || 1
                        return (
                          <LeaderboardRow
                            key={`game-${item.name}`}
                            rank={profile.contentLove.cards.length + index + 1}
                            name={item.name}
                            value={`${item.plays} plays`}
                            barPercent={(item.plays / top) * 100}
                            color="var(--c-games)"
                          />
                        )
                      })}
                    </>
                  ) : (
                    <div className="empty-state">No card taps or game plays recorded yet.</div>
                  )}
                </Card>
              </div>
            </div>

            <div className="pf-note">
              Profile is assembled from usage rollups, tap logs, game plays, session summaries and quota. Parent email and phone are never displayed.
            </div>
          </>
        ) : null}
      </>
    )
  }

  return (
    <>
      <TopBar title="Families" theme={theme} onToggleTheme={onToggleTheme} />

      <div className="pf-search">
        <div className="pf-input">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Search a parent, kid, device MAC or alias"
            aria-label="Search families"
          />
        </div>

        {hasQuery ? (
          <div className="pf-drop">
            {searching ? <div className="g">Searching…</div> : null}
            {!searching && resultCount === 0 ? <div className="g">No matches</div> : null}

            {searchResults?.kids.length ? (
              <>
                <div className="g">Kids</div>
                {searchResults.kids.map((result) => (
                  <button key={`kid-${result.id}`} type="button" className="r" onClick={() => onSelectResult(result)}>
                    <span className="av">{initialsOf(result.label)}</span>
                    <Highlight text={result.label} query={searchTerm} />
                    {result.subtitle ? <> · <Highlight text={result.subtitle} query={searchTerm} /></> : null}
                    <small>{result.parentName || 'no parent linked'}</small>
                  </button>
                ))}
              </>
            ) : null}

            {searchResults?.parents.length ? (
              <>
                <div className="g">Parents</div>
                {searchResults.parents.map((result) => (
                  <button key={`parent-${result.id}`} type="button" className="r" onClick={() => onSelectResult(result)}>
                    <span className="av">{initialsOf(result.label)}</span>
                    <Highlight text={result.label} query={searchTerm} />
                    <small>{result.toyCount ?? 0} toys</small>
                  </button>
                ))}
              </>
            ) : null}

            {searchResults?.devices.length ? (
              <>
                <div className="g">Devices</div>
                {searchResults.devices.map((result) => (
                  <button key={`device-${result.id}`} type="button" className="r" onClick={() => onSelectResult(result)}>
                    <span className="av" aria-hidden="true">🧸</span>
                    <Highlight text={result.label} query={searchTerm} />
                    <small>{result.kidName || result.parentName || result.macAddress}</small>
                  </button>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="pf-sel">All families · {familiesTotal}</div>

      <Card hint="Click a row to open its Family 360 profile">
        {familiesLoading ? (
          <div className="loading-card">Loading families…</div>
        ) : families.length ? (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kid</th>
                  <th>Grade</th>
                  <th>Parent</th>
                  <th className="num">Toys</th>
                </tr>
              </thead>
              <tbody>
                {families.map((entry) => (
                  <tr
                    key={entry.kidId}
                    className="clickable"
                    onClick={() =>
                      onSelectResult({ type: 'kid', id: entry.kidId, label: entry.kidName, parentName: entry.parentName })
                    }
                  >
                    <td>
                      {entry.kidName}
                      {entry.nickname ? <span className="mut"> · {entry.nickname}</span> : null}
                    </td>
                    <td className="mut">{entry.grade || DASH}</td>
                    <td className="mut">{entry.parentName || DASH}</td>
                    <td className="num">{entry.deviceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No families registered yet.</div>
        )}
      </Card>
    </>
  )
}

/* ================================================================== *
 * Costs
 * ================================================================== */

/**
 * All-time spend from both token ledgers.
 *
 * They are separate tables that agree over recent windows and drift apart on
 * older rows, so neither is billed as "the" total — both are shown labelled,
 * with the gap stated rather than hidden. Every windowed figure elsewhere on
 * this page comes from the session ledger.
 */
function LifetimeSpendCard({ lifetime }: { lifetime: NonNullable<CostsResponse['sections']['lifetime']> }) {
  const ledgers = [
    { key: 'session', label: 'Session ledger', source: 'device_token_usage_session', data: lifetime.sessionLedger },
    { key: 'device', label: 'Device ledger', source: 'device_token_usage', data: lifetime.deviceLedger },
  ]

  const session = lifetime.sessionLedger?.totalInr
  const device = lifetime.deviceLedger?.totalInr
  const gap = isNil(session) || isNil(device) ? null : Math.abs(device - session)

  return (
    <section className="oa-single">
      <Card title="Lifetime spend" hint="All-time totals · every windowed figure above is built from the session ledger">
        <div className="pf-fields">
          {ledgers.map((ledger) => (
            <div key={ledger.key} className="pf-field">
              {ledger.label}
              <small>
                {ledger.source} · {formatNumber(ledger.data?.rows)} rows ·{' '}
                {formatDayWithYear(ledger.data?.firstDay)} → {formatDayWithYear(ledger.data?.lastDay)}
              </small>
              <strong>{formatMoney(ledger.data?.totalInr)}</strong>
            </div>
          ))}
        </div>
        {gap ? (
          <div className="hint note">
            The two ledgers differ by {formatMoney(gap)}. They are separate tables recording the same spend over
            different histories, so they are not expected to reconcile.
          </div>
        ) : null}
      </Card>
    </section>
  )
}

function CostsPage({
  range,
  data,
  loading,
  theme,
  onToggleTheme,
  onRangeChange,
}: {
  range: RangeOption
  data: CostsResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
  onRangeChange: (next: RangeOption) => void
}) {
  const tokenTotal = data ? data.sections.tokenMix.outputAudio + data.sections.tokenMix.inputAudio + data.sections.tokenMix.text : 0

  return (
    <>
      <TopBar
        title="Costs"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      >
        <RangeToggle value={range} options={['7d', 'month', '90d']} onChange={onRangeChange} />
      </TopBar>

      {loading && !data ? <div className="loading-card">Loading costs view…</div> : null}

      {data ? (
        <>
          <section className="oa-kpis">
            <KpiCard
              label={`Spend · ${rangeLabel(range)}`}
              value={formatMoney(data.kpis.totalCost)}
              delta={data.deltas.totalCost}
              deltaQualifier="vs prior period"
            />
            <KpiCard
              label="Projected month"
              value={formatMoneyCompact(data.kpis.projectedMonth)}
              caption={<small>at current daily rate × {data.kpis.daysInMonth} days</small>}
            />
            <KpiCard
              label="Per active toy"
              value={formatMoney(data.kpis.perActiveToyPerDay)}
              caption={<small>per toy per day</small>}
            />
            <KpiCard label="Per session" value={formatMoney(data.kpis.perSession)} caption={<small>per billed session</small>} />
            <KpiCard
              label="Avg response time"
              value={data.kpis.avgResponseTimeSeconds === null ? <span className="not-tracked">Not recorded</span> : data.kpis.avgResponseTimeSeconds.toFixed(2)}
              unit={data.kpis.avgResponseTimeSeconds === null ? undefined : 's'}
              caption={<small>time to first token</small>}
            />
          </section>

          {data.sections.lifetime ? <LifetimeSpendCard lifetime={data.sections.lifetime} /> : null}

          <section className="oa-row">
            <Card title={`Daily AI spend · ${rangeLabel(range)}`} hint="₹ per day · input vs output tokens">
              <div className="oa-leg">
                <i style={{ ['--c' as string]: 'var(--c-ai)' }}>output (audio + text)</i>
                <i style={{ ['--c' as string]: 'var(--c-cards)' }}>input (audio + text)</i>
              </div>
              <CostBarsChart items={data.sections.dailySpend} />
              {data.sections.dailySpend.length > 1 ? (
                <div className="oa-axis">
                  <span>{formatCompactDate(data.sections.dailySpend[0].date)}</span>
                  <span>{formatCompactDate(data.sections.dailySpend[data.sections.dailySpend.length - 1].date)}</span>
                </div>
              ) : null}
            </Card>

            <Card className="meter" title="Monthly budget" hint={data.kpis.monthlyBudget === null ? 'No budget configured' : `${formatMoneyCompact(data.kpis.monthlyBudget)} · set in system parameters`}>
              {data.kpis.monthlyBudget !== null && data.kpis.budgetUsedPercent !== null ? (
                <>
                  <div className="track">
                    <i style={{ width: `${Math.min(data.kpis.budgetUsedPercent, 100)}%` }} />
                  </div>
                  <div className="row">
                    <span>{formatMoney(data.kpis.totalCost)} used · {data.kpis.budgetUsedPercent}%</span>
                    <span>projected {formatMoneyCompact(data.kpis.projectedMonth)}</span>
                  </div>
                </>
              ) : (
                <div className="budget-unset">
                  <strong>No budget set</strong>
                  <span>
                    Add a monthly budget in system parameters to track spend against a target and get a
                    90% alert.
                  </span>
                  <code>founder_monthly_budget_inr</code>
                </div>
              )}

              <h5 className="sub">Token mix</h5>
              {tokenTotal ? (
                <>
                  <div className="split slim">
                    <b style={{ width: `${(data.sections.tokenMix.outputAudio / tokenTotal) * 100}%`, background: 'var(--c-ai)' }} />
                    <b style={{ width: `${(data.sections.tokenMix.inputAudio / tokenTotal) * 100}%`, background: 'var(--c-cards)' }} />
                    <b style={{ width: `${(data.sections.tokenMix.text / tokenTotal) * 100}%`, background: 'var(--ink-4)' }} />
                  </div>
                  <div className="li" style={{ ['--c' as string]: 'var(--c-ai)' }}>
                    Output audio <small>· the toy speaking</small>
                    <b>{Math.round((data.sections.tokenMix.outputAudio / tokenTotal) * 100)}%</b>
                  </div>
                  <div className="li" style={{ ['--c' as string]: 'var(--c-cards)' }}>
                    Input audio <small>· kids speaking</small>
                    <b>{Math.round((data.sections.tokenMix.inputAudio / tokenTotal) * 100)}%</b>
                  </div>
                  <div className="li" style={{ ['--c' as string]: 'var(--ink-4)' }}>
                    Text <small>· prompts</small>
                    <b>{Math.round((data.sections.tokenMix.text / tokenTotal) * 100)}%</b>
                  </div>
                </>
              ) : (
                <div className="empty-state">No token usage in this range.</div>
              )}
            </Card>
          </section>

          <Card className="spaced" title="Where the money goes · top toys by spend" hint="Heavy users, not leaks — cost tracks minutes">
            {data.sections.topDevices.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Toy / kid</th>
                      <th>Parent</th>
                      <th className="num">Sessions</th>
                      <th className="num">Talk time</th>
                      <th className="num">Tokens</th>
                      <th className="num">Cost</th>
                      <th className="num">% of fleet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sections.topDevices.map((item) => (
                      <tr key={item.macAddress}>
                        <td>
                          <span className="mac">{item.macAddress}</span>
                          {item.kidName ? ` · ${item.kidName}` : ''}
                        </td>
                        <td className="mut">{item.parentName || DASH}</td>
                        <td className="num">{item.sessions}</td>
                        <td className="num">{item.talkHours} h</td>
                        <td className="num">{formatNumber(item.totalTokens)}</td>
                        <td className="num">{formatMoney(item.cost)}</td>
                        <td className="num">{item.fleetSharePercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No billed sessions in this range.</div>
            )}
          </Card>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Fleet & ops
 * ================================================================== */

function OperatePage({
  data,
  loading,
  theme,
  onToggleTheme,
}: {
  data: OperateResponse | null
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
}) {
  // Distinct colour per firmware version so the stacked bar reads as segments
  // rather than one flat block. Latest is always green, unknown always red.
  const FIRMWARE_PALETTE = ['var(--st-warn)', 'var(--c-cards)', 'var(--c-radio)', 'var(--st-serious)', 'var(--c-ai)']
  const olderVersions = (data?.sections.firmwareCoverage || [])
    .filter((item) => !item.isLatest && item.version !== 'unknown')
    .map((item) => item.version)

  const firmwareTone = (item: OperateResponse['sections']['firmwareCoverage'][number]) => {
    if (item.isLatest) return 'var(--st-good)'
    if (item.version === 'unknown') return 'var(--st-crit)'
    const index = olderVersions.indexOf(item.version)
    return FIRMWARE_PALETTE[index % FIRMWARE_PALETTE.length]
  }

  return (
    <>
      <TopBar
        title="Fleet & Ops"
        date={data?.generatedAt ? formatLongDate(data.generatedAt) : undefined}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      {loading && !data ? <div className="loading-card">Loading fleet view…</div> : null}

      {data ? (
        <>
          <section className="oa-kpis">
            <KpiCard label="Fleet size" value={formatNumber(data.kpis.fleetSize)} caption={<small>registered toys</small>} />
            <KpiCard label="Online now" value={formatNumber(data.kpis.onlineNow)} caption={<small>of {data.kpis.reportingDevices} reporting state</small>} />
            <KpiCard
              label="On latest firmware"
              value={formatPercent(data.kpis.latestFirmwarePercent)}
              caption={<small>{data.kpis.latestFirmwareVersion ? `latest ${data.kpis.latestFirmwareVersion}` : 'no release registered'}</small>}
            />
            <KpiCard
              label="Battery health"
              value={data.kpis.avgBattery === null ? <span className="not-tracked">Not reported</span> : formatPercent(data.kpis.avgBattery)}
              caption={<small>avg across {data.kpis.batteryReportingDevices} reporting toys</small>}
            />
            <KpiCard label="Device errors · 7d" value={formatNumber(data.kpis.deviceErrors7d)} caption={<small>error/fail/shutdown events</small>} />
          </section>

          <section className="oa-row half">
            <Card title="Firmware coverage" hint="Share of toys reporting each firmware version">
              {data.sections.firmwareCoverage.length ? (
                <>
                  <div className="split">
                    {data.sections.firmwareCoverage.map((item) => (
                      <b key={item.version} style={{ width: `${item.percent}%`, background: firmwareTone(item) }} />
                    ))}
                  </div>
                  {data.sections.firmwareCoverage.map((item) => (
                    <div key={item.version} className="li" style={{ ['--c' as string]: firmwareTone(item) }}>
                      {item.version === 'unknown' ? 'Unknown firmware' : item.version}
                      {item.isLatest ? <small> · latest</small> : null}
                      <b>{item.count} toys · {item.percent}%</b>
                    </div>
                  ))}
                </>
              ) : (
                <div className="empty-state">No devices are reporting firmware yet.</div>
              )}

              {data.sections.otaRollout ? (
                <div className="meter">
                  <h5 className="sub">OTA rollout · {data.sections.otaRollout.version}</h5>
                  <div className="track">
                    <i style={{ width: `${data.sections.otaRollout.percent}%` }} />
                  </div>
                  <div className="row">
                    <span>{data.sections.otaRollout.updatedCount} of {data.sections.otaRollout.fleetSize} updated</span>
                    <span>force update: {data.sections.otaRollout.forceUpdate ? 'on' : 'off'}</span>
                  </div>
                </div>
              ) : null}
            </Card>

            <Card title="Needs a human" hint="Watchlist from runtime state and device events">
              {data.sections.watchlist.length ? (
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Toy</th>
                        <th>Issue</th>
                        <th className="num">Since</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sections.watchlist.map((item) => (
                        <tr key={`${item.macAddress}-${item.issue}`}>
                          <td>
                            <span className="mac">{item.macAddress}</span>
                            <span className="watch-kid"> · {item.kidName || item.alias}</span>
                          </td>
                          <td>
                            <span className={item.severity === 'critical' ? 'badge crit' : 'badge warn'}>{item.issue}</span>
                          </td>
                          <td className="num mut">{item.since ? formatCompactDate(item.since) : DASH}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No toys currently need manual attention.</div>
              )}

              <h5 className="sub">Recent device events</h5>
              {data.sections.recentEvents.length ? (
                data.sections.recentEvents.map((item) => (
                  <div key={`${item.source}-${item.macAddress}-${item.createdAt}`} className="li noc">
                    <small>{formatDateTime(item.createdAt)}</small> · <span className="mac">{item.macAddress}</span> {item.title}
                    <b style={{ color: item.severity === 'critical' ? 'var(--bad)' : undefined }}>{item.detail}</b>
                  </div>
                ))
              ) : (
                <div className="empty-state">No device events in the last 7 days.</div>
              )}
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * RFID studio
 * ================================================================== */

function LookupTestPanel() {
  const [uid, setUid] = useState('')
  const [sequence, setSequence] = useState(1)
  const [loadingKind, setLoadingKind] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; type: string; data: unknown } | null>(null)

  const runLookup = async (kind: string, label: string, path: string) => {
    if (!uid.trim()) return
    setLoadingKind(kind)
    try {
      const data = await apiFetchPublic(path)
      setResult({ success: true, type: label, data })
    } catch (err) {
      setResult({
        success: false,
        type: label,
        data: { error: err instanceof ApiError ? err.message : 'Request failed', uid: uid.trim() },
      })
    } finally {
      setLoadingKind(null)
    }
  }

  const encodedUid = encodeURIComponent(uid.trim())

  return (
    <Card className="spaced" title="Lookup & test" hint="Resolve an RFID UID through the same endpoints the devices use">
      <div className="lookup-grid">
        <input placeholder="RFID UID (e.g. 5C42C905)" value={uid} onChange={(event) => setUid(event.target.value)} />
        <input
          type="number"
          min={1}
          value={sequence}
          onChange={(event) => setSequence(Number(event.target.value) || 1)}
          title="Sequence"
          style={{ width: 90 }}
        />
        <button type="button" className="secondary-button" disabled={!uid.trim() || loadingKind !== null} onClick={() => runLookup('card', 'card mapping', `/admin/rfid/card/lookup/${encodedUid}`)}>
          {loadingKind === 'card' ? 'Looking up…' : 'Card mapping'}
        </button>
        <button type="button" className="secondary-button" disabled={!uid.trim() || loadingKind !== null} onClick={() => runLookup('series', 'series', `/admin/rfid/series/lookup/${encodedUid}`)}>
          {loadingKind === 'series' ? 'Looking up…' : 'Series'}
        </button>
        <button type="button" className="secondary-button" disabled={!uid.trim() || loadingKind !== null} onClick={() => runLookup('content', 'content', `/admin/rfid/card/lookup/${encodedUid}?sequence=${sequence}`)}>
          {loadingKind === 'content' ? 'Looking up…' : 'Content (seq)'}
        </button>
        <button type="button" className="secondary-button" disabled={!uid.trim() || loadingKind !== null} onClick={() => runLookup('download', 'download', `/admin/rfid/card/content/download/${encodedUid}`)}>
          {loadingKind === 'download' ? 'Looking up…' : 'Download'}
        </button>
      </div>

      {result ? (
        <>
          <div className={result.success ? 'hint note' : 'error-banner'} style={{ marginTop: 12 }}>
            {result.success ? `Resolved — ${result.type}` : `Not resolved — ${result.type}`}
          </div>
          <pre className="lookup-result">{JSON.stringify(result.data, null, 2)}</pre>
        </>
      ) : null}
    </Card>
  )
}

function RfidStudioPage({
  cards,
  total,
  loading,
  theme,
  onToggleTheme,
}: {
  cards: RfidCardMapping[]
  total: number
  loading: boolean
  theme: Theme
  onToggleTheme: () => void
}) {
  const contentCount = cards.filter((item) => item.contentPackId).length
  const qnaCount = cards.filter((item) => item.questionPackId).length
  const aiCount = cards.filter((item) => (item.cardType || item.actionType) === 'ai').length
  const inactiveCount = cards.filter((item) => item.active === false).length
  const truncated = total > cards.length

  return (
    <>
      <TopBar title="RFID Studio" theme={theme} onToggleTheme={onToggleTheme} />

      <section className="oa-kpis four">
        <KpiCard label="Card mappings" value={formatNumber(total)} caption={<small>total in RFID management</small>} />
        <KpiCard label="Content-linked" value={formatNumber(contentCount)} caption={<small>{truncated ? `of ${cards.length} loaded` : 'linked to content packs'}</small>} />
        <KpiCard label="Q&A-linked" value={formatNumber(qnaCount)} caption={<small>{truncated ? `of ${cards.length} loaded` : 'linked to question packs'}</small>} />
        <KpiCard label="AI cards" value={formatNumber(aiCount)} caption={<small>{truncated ? `of ${cards.length} loaded` : 'direct AI mappings'}</small>} />
      </section>

      <Card
        className="spaced"
        title="Card mappings"
        hint={truncated ? `Showing the first ${cards.length} of ${total} mappings` : `${cards.length} mappings`}
      >
        {loading ? (
          <div className="loading-card">Loading card mappings…</div>
        ) : cards.length ? (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>RFID UID</th>
                  <th>Type</th>
                  <th>Content pack</th>
                  <th className="num">Active</th>
                </tr>
              </thead>
              <tbody>
                {cards.slice(0, 25).map((item) => (
                  <tr key={String(item.id)}>
                    <td className="mac">{item.rfidUid}</td>
                    <td className="mut">{item.cardType || item.actionType || DASH}</td>
                    <td className="mut">{item.packCode || DASH}</td>
                    <td className="num">
                      <span className={item.active === false ? 'badge crit' : 'badge ok'}>{item.active === false ? 'No' : 'Yes'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">No card mappings found.</div>
        )}
        {inactiveCount ? <div className="hint note">{inactiveCount} inactive mapping{inactiveCount === 1 ? '' : 's'} in the loaded set.</div> : null}
      </Card>

      <LookupTestPanel />
    </>
  )
}

/* ================================================================== *
 * Content library
 * ================================================================== */

function ContentLibraryPage({
  packs,
  total,
  loading,
  editorPack,
  editorLoading,
  onEdit,
  onCloseEditor,
  theme,
  onToggleTheme,
}: {
  packs: RfidContentPack[]
  total: number
  loading: boolean
  editorPack: RfidContentPack | null
  editorLoading: boolean
  onEdit: (packCode: string) => void
  onCloseEditor: () => void
  theme: Theme
  onToggleTheme: () => void
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
    <>
      <TopBar title="Content Library" theme={theme} onToggleTheme={onToggleTheme} />

      <section className="oa-kpis four">
        <KpiCard label="Content packs" value={formatNumber(total)} caption={<small>{visiblePacks.length} shown after filtering</small>} />
        <KpiCard label="Active packs" value={formatNumber(activeCount)} caption={<small>of {visiblePacks.length} shown</small>} />
        <KpiCard label="AI packs" value={formatNumber(promptCount)} caption={<small>prompt-based</small>} />
        <KpiCard label="Read-aloud packs" value={formatNumber(ttsCount)} caption={<small>non-prompt content</small>} />
      </section>

      <Card className="spaced" title="Content packs" hint="Live rows from RFID management">
        {loading ? (
          <div className="loading-card">Loading content packs…</div>
        ) : visiblePacks.length ? (
          <div className="pack-grid">
            {visiblePacks.map((item) => (
              <article key={String(item.id)} className="pack-card">
                <div className="code">{item.packCode}</div>
                <h6>{item.name}</h6>
                <p>{item.description || 'No description provided.'}</p>
                <div className="topics" style={{ marginTop: 0 }}>
                  <span>{item.contentType === 'prompt' ? 'AI' : item.contentType || 'unknown type'}</span>
                  <span>{item.totalItems ?? item.items?.length ?? 0} items</span>
                  {item.language ? <span>{item.language}</span> : null}
                  {item.version ? <span>v{item.version}</span> : null}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="secondary-button" onClick={() => onEdit(item.packCode)}>Details</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No content packs found.</div>
        )}
      </Card>

      {editorPack || editorLoading ? (
        <div className="modal-backdrop" onClick={onCloseEditor}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            {editorLoading ? (
              <div className="loading-card">Loading pack details…</div>
            ) : editorPack ? (
              <>
                <div className="modal-head">
                  <div>
                    <h5>{editorPack.name}</h5>
                    <div className="hint">{editorPack.packCode}</div>
                  </div>
                  <button type="button" className="secondary-button" onClick={onCloseEditor}>Close</button>
                </div>

                <div className="pf-fields">
                  <div className="pf-field">Content type <strong>{editorPack.contentType || DASH}</strong></div>
                  <div className="pf-field">Language <strong>{editorPack.language || DASH}</strong></div>
                  <div className="pf-field">Status <strong>{editorPack.status || (editorPack.active === false ? 'inactive' : 'active')}</strong></div>
                  <div className="pf-field">Version <strong>{editorPack.version ? `v${editorPack.version}` : DASH}</strong></div>
                  <div className="pf-field">Items <strong>{editorPack.items?.length ?? editorPack.totalItems ?? 0}</strong></div>
                </div>

                {editorPack.description ? <div className="oa-quote">{editorPack.description}</div> : null}

                <h5 className="sub">Pack items</h5>
                {editorPack.items?.length ? (
                  <div className="pack-item-grid">
                    {editorPack.items.map((item, index) => (
                      <div key={`${editorPack.id}-${index}`} className="pack-item">
                        <strong>{index + 1}. {item.title || 'Untitled item'}</strong>
                        {item.audioUrl ? <audio controls src={item.audioUrl} style={{ width: '100%', marginBottom: 6 }} /> : null}
                        {item.text ? <span>{item.text}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No item details available for this pack.</div>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ================================================================== *
 * Settings
 * ================================================================== */

function SettingsPage({
  username,
  costs,
  theme,
  onToggleTheme,
  onSignOut,
}: {
  username: string
  costs: CostsResponse | null
  theme: Theme
  onToggleTheme: () => void
  onSignOut: () => void
}) {
  return (
    <>
      <TopBar title="Settings" theme={theme} onToggleTheme={onToggleTheme} />

      <section className="oa-row half">
        <Card title="Appearance" hint="Applies to every page and is remembered on this device">
          <div className="pf-fields">
            <div className="pf-field">
              Theme
              <strong>{theme === 'dark' ? 'Dark' : 'Light'}</strong>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="secondary-button" onClick={onToggleTheme}>
              Switch to {theme === 'dark' ? 'light' : 'dark'} mode
            </button>
          </div>
        </Card>

        <Card title="Monthly AI budget" hint="Read from the founder_monthly_budget_inr system parameter">
          {costs?.kpis.monthlyBudget !== null && costs?.kpis.monthlyBudget !== undefined ? (
            <div className="pf-fields">
              <div className="pf-field">Budget <strong>{formatMoneyCompact(costs.kpis.monthlyBudget)}</strong></div>
              <div className="pf-field">Used <strong>{formatPercent(costs.kpis.budgetUsedPercent)}</strong></div>
            </div>
          ) : (
            <div className="budget-unset">
              <strong>No budget set</strong>
              <span>Add a monthly budget in system parameters to enable budget tracking on the Costs page.</span>
              <code>founder_monthly_budget_inr</code>
            </div>
          )}
        </Card>
      </section>

      <Card className="spaced" title="Current thresholds" hint="These are fixed in the analytics service — not yet editable from this screen">
        <div className="pf-fields">
          <div className="pf-field">Low-battery watchlist <strong>below 20%</strong></div>
          <div className="pf-field">Quiet toy <strong>no usage for 7+ days</strong></div>
          <div className="pf-field">Quiet-toy history window <strong>last 60 days</strong></div>
          <div className="pf-field">All date bucketing <strong>Asia/Kolkata (IST)</strong></div>
        </div>
      </Card>

      <div className="session-bar">
        <span>Signed in{username ? ` as ${username}` : ''}</span>
        <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
      </div>
    </>
  )
}

/* ================================================================== *
 * App
 * ================================================================== */

/* A page that reads a field the API stopped sending used to blank the whole
 * dashboard with only a minified stack in the console. Keep the shell and
 * name the failure instead. */
/* Keyed on the active page by its caller, so navigating away remounts it and
 * clears the caught error. */
class PageErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.message) {
      return (
        <div className="error-banner">
          This view could not be rendered: {this.state.message}. The API response is most likely
          missing a field this build expects — check that the deployed manager-api matches this dashboard.
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  const { theme, toggle: toggleTheme } = useTheme()

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
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)

  const [rfidCards, setRfidCards] = useState<RfidCardMapping[]>([])
  const [rfidCardTotal, setRfidCardTotal] = useState(0)
  const [contentPacks, setContentPacks] = useState<RfidContentPack[]>([])
  const [contentPackTotal, setContentPackTotal] = useState(0)
  const [contentPackEditor, setContentPackEditor] = useState<RfidContentPack | null>(null)
  const [contentPackEditorLoading, setContentPackEditorLoading] = useState(false)

  const [overviewLoading, setOverviewLoading] = useState(false)
  const [engagementLoading, setEngagementLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [costsLoading, setCostsLoading] = useState(false)
  const [operateLoading, setOperateLoading] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)
  const [rfidCardsLoading, setRfidCardsLoading] = useState(false)
  const [contentPacksLoading, setContentPacksLoading] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [familiesView, setFamiliesView] = useState<'list' | 'detail'>('list')
  const [families, setFamilies] = useState<FamilyListEntry[]>([])
  const [familiesTotal, setFamiliesTotal] = useState(0)
  const [familiesLoading, setFamiliesLoading] = useState(false)
  const [profile, setProfile] = useState<FamilyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  const [error, setError] = useState('')

  useEffect(() => {
    setToken(loadStoredToken())
  }, [])

  const describeError = (requestError: unknown, fallback: string) =>
    requestError instanceof ApiError ? `${fallback}: ${requestError.message}` : fallback

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setOverviewLoading(true)
    apiFetch<OverviewResponse>(`/admin/founder/overview?range=${overviewRange}`, token)
      .then((payload) => { if (!cancelled) setOverview(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load overview')) })
      .finally(() => { if (!cancelled) setOverviewLoading(false) })
    return () => { cancelled = true }
  }, [overviewRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setEngagementLoading(true)
    apiFetch<EngagementResponse>(`/admin/founder/engagement?range=${engagementRange}`, token)
      .then((payload) => { if (!cancelled) setEngagement(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load engagement')) })
      .finally(() => { if (!cancelled) setEngagementLoading(false) })
    return () => { cancelled = true }
  }, [engagementRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setContentLoading(true)
    apiFetch<ContentResponse>(`/admin/founder/content?range=${contentRange}`, token)
      .then((payload) => { if (!cancelled) setContent(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load content')) })
      .finally(() => { if (!cancelled) setContentLoading(false) })
    return () => { cancelled = true }
  }, [contentRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setConversationsLoading(true)
    apiFetch<ConversationsResponse>(`/admin/founder/conversations?range=${conversationRange}`, token)
      .then((payload) => { if (!cancelled) setConversations(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load conversations')) })
      .finally(() => { if (!cancelled) setConversationsLoading(false) })
    return () => { cancelled = true }
  }, [conversationRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setCostsLoading(true)
    apiFetch<CostsResponse>(`/admin/founder/costs?range=${costRange}`, token)
      .then((payload) => { if (!cancelled) setCosts(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load costs')) })
      .finally(() => { if (!cancelled) setCostsLoading(false) })
    return () => { cancelled = true }
  }, [costRange, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setOperateLoading(true)
    apiFetch<OperateResponse>('/admin/founder/operate', token)
      .then((payload) => { if (!cancelled) setOperate(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load fleet view')) })
      .finally(() => { if (!cancelled) setOperateLoading(false) })
    return () => { cancelled = true }
  }, [token])

  // Mission Control is a live wall: fetch on open, then refresh every 30s
  // while it is the active page.
  useEffect(() => {
    if (!token || activePage !== 'live') return
    let cancelled = false

    const load = () => {
      apiFetch<LiveResponse>('/admin/founder/live', token)
        .then((payload) => { if (!cancelled) setLive(payload) })
        .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load mission control')) })
        .finally(() => { if (!cancelled) setLiveLoading(false) })
    }

    setLiveLoading(true)
    load()
    const timer = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activePage, token])

  useEffect(() => {
    if (!token || activePage !== 'brief') return
    let cancelled = false
    setBriefLoading(true)
    apiFetch<BriefResponse>('/admin/founder/brief', token)
      .then((payload) => { if (!cancelled) setBrief(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load the daily brief')) })
      .finally(() => { if (!cancelled) setBriefLoading(false) })
    return () => { cancelled = true }
  }, [activePage, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setRfidCardsLoading(true)
    apiFetch<{ list: RfidCardMapping[]; total: number }>('/admin/rfid/card/page?page=1&limit=100', token)
      .then((payload) => {
        if (cancelled) return
        setRfidCards(payload.list || [])
        setRfidCardTotal(payload.total ?? (payload.list || []).length)
      })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load card mappings')) })
      .finally(() => { if (!cancelled) setRfidCardsLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setContentPacksLoading(true)
    apiFetch<{ list: RfidContentPack[]; total: number }>('/admin/rfid/content-pack/page?page=1&limit=100', token)
      .then((payload) => {
        if (cancelled) return
        setContentPacks(payload.list || [])
        setContentPackTotal(payload.total ?? (payload.list || []).length)
      })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load content packs')) })
      .finally(() => { if (!cancelled) setContentPacksLoading(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setFamiliesLoading(true)
    apiFetch<FamilyListResponse>('/admin/founder/families/list?page=1&limit=200', token)
      .then((payload) => {
        if (cancelled) return
        setFamilies(payload.items || [])
        setFamiliesTotal(payload.total ?? (payload.items || []).length)
      })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load families')) })
      .finally(() => { if (!cancelled) setFamiliesLoading(false) })
    return () => { cancelled = true }
  }, [token])

  // Server-side family search (matches kids, parents, MAC addresses and aliases).
  useEffect(() => {
    if (!token) return
    const query = searchTerm.trim()
    if (query.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      apiFetch<SearchResponse>(`/admin/founder/families/search?q=${encodeURIComponent(query)}`, token)
        .then((payload) => { if (!cancelled) setSearchResults(payload) })
        .catch(() => { if (!cancelled) setSearchResults(null) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchTerm, token])

  useEffect(() => {
    if (!token || !selectedResult) return
    let cancelled = false
    setProfileLoading(true)
    const identifier = selectedResult.macAddress || selectedResult.id
    apiFetch<FamilyProfile>(`/admin/founder/families/${encodeURIComponent(identifier)}/profile`, token)
      .then((payload) => { if (!cancelled) setProfile(payload) })
      .catch((err: unknown) => { if (!cancelled) setError(describeError(err, 'Unable to load family profile')) })
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [selectedResult, token])

  useEffect(() => {
    if (!token || !selectedSessionId) return
    let cancelled = false
    setTranscriptLoading(true)
    setTranscript(null)
    apiFetch<TranscriptResponse>(`/admin/founder/conversations/${encodeURIComponent(selectedSessionId)}/transcript`, token)
      .then((payload) => { if (!cancelled) setTranscript(payload) })
      .catch(() => { if (!cancelled) setTranscript(null) })
      .finally(() => { if (!cancelled) setTranscriptLoading(false) })
    return () => { cancelled = true }
  }, [selectedSessionId, token])

  const signIn = async () => {
    setAuthLoading(true)
    setError('')
    try {
      const payload = await apiFetchPublic<{ token: string }>('/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: crypto.randomUUID(),
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
    setLive(null)
    setBrief(null)
    setRfidCards([])
    setContentPacks([])
    setContentPackEditor(null)
    setProfile(null)
    setSelectedResult(null)
    setSearchResults(null)
    setSearchTerm('')
    setSelectedSessionId(null)
    setTranscript(null)
    setFamiliesView('list')
  }

  const openContentPackEditor = async (packCode: string) => {
    if (!token) return
    setContentPackEditorLoading(true)
    try {
      const payload = await apiFetch<RfidContentPack>(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`, token)
      setContentPackEditor(payload)
    } catch (requestError: unknown) {
      setError(describeError(requestError, 'Unable to load content pack details'))
    } finally {
      setContentPackEditorLoading(false)
    }
  }

  if (!token) {
    return (
      <LoginPanel
        username={username}
        password={password}
        loading={authLoading}
        error={error}
        theme={theme}
        onToggleTheme={toggleTheme}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={signIn}
      />
    )
  }

  const mobileTabs: Array<{ key: NavPage; label: string; icon: string }> = [
    { key: 'overview', label: 'Home', icon: '☀️' },
    { key: 'live', label: 'Live', icon: '🛰' },
    { key: 'brief', label: 'Brief', icon: '📰' },
    { key: 'families', label: 'Families', icon: '👨‍👩‍👧' },
    { key: 'costs', label: 'Costs', icon: '₹' },
    { key: 'operate', label: 'Fleet', icon: '🛠' },
  ]

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onChange={setActivePage} username={username} />

      <main className="main-shell">
        {error ? <div className="error-banner">{error}</div> : null}

        <PageErrorBoundary key={activePage}>
        {activePage === 'overview' ? (
          <OverviewPage
            range={overviewRange}
            overview={overview}
            engagement={engagement}
            costs={costs}
            operate={operate}
            loading={overviewLoading}
            username={username}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRangeChange={setOverviewRange}
            onNavigate={setActivePage}
          />
        ) : null}

        {activePage === 'live' ? (
          <MissionControlPage data={live} loading={liveLoading} theme={theme} onToggleTheme={toggleTheme} />
        ) : null}

        {activePage === 'brief' ? (
          <DailyBriefPage data={brief} loading={briefLoading} theme={theme} onToggleTheme={toggleTheme} />
        ) : null}

        {activePage === 'engagement' ? (
          <EngagementPage
            range={engagementRange}
            data={engagement}
            loading={engagementLoading}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRangeChange={setEngagementRange}
          />
        ) : null}

        {activePage === 'content' ? (
          <ContentPage
            range={contentRange}
            data={content}
            loading={contentLoading}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRangeChange={setContentRange}
          />
        ) : null}

        {activePage === 'conversations' ? (
          <ConversationsPage
            range={conversationRange}
            data={conversations}
            loading={conversationsLoading}
            transcript={transcript}
            transcriptLoading={transcriptLoading}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRangeChange={setConversationRange}
          />
        ) : null}

        {activePage === 'families' ? (
          <FamiliesPage
            theme={theme}
            onToggleTheme={toggleTheme}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchResults={searchResults}
            searching={searching}
            onSelectResult={(result) => {
              setSelectedResult(result)
              setFamiliesView('detail')
            }}
            view={familiesView}
            onBack={() => setFamiliesView('list')}
            profile={profile}
            loadingProfile={profileLoading}
            families={families}
            familiesLoading={familiesLoading}
            familiesTotal={familiesTotal}
          />
        ) : null}

        {activePage === 'costs' ? (
          <CostsPage
            range={costRange}
            data={costs}
            loading={costsLoading}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRangeChange={setCostRange}
          />
        ) : null}

        {activePage === 'operate' ? (
          <OperatePage data={operate} loading={operateLoading} theme={theme} onToggleTheme={toggleTheme} />
        ) : null}

        {activePage === 'rfidStudio' ? (
          <RfidStudioPage cards={rfidCards} total={rfidCardTotal} loading={rfidCardsLoading} theme={theme} onToggleTheme={toggleTheme} />
        ) : null}

        {activePage === 'contentLibrary' ? (
          <ContentLibraryPage
            packs={contentPacks}
            total={contentPackTotal}
            loading={contentPacksLoading}
            editorPack={contentPackEditor}
            editorLoading={contentPackEditorLoading}
            onEdit={openContentPackEditor}
            onCloseEditor={() => {
              setContentPackEditor(null)
              setContentPackEditorLoading(false)
            }}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        ) : null}

        {activePage === 'settings' ? (
          <SettingsPage username={username} costs={costs} theme={theme} onToggleTheme={toggleTheme} onSignOut={signOut} />
        ) : null}
        </PageErrorBoundary>
      </main>

      <nav className="mobile-nav">
        {mobileTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activePage === tab.key ? 'active' : ''}
            onClick={() => setActivePage(tab.key)}
          >
            <span className="ic" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
