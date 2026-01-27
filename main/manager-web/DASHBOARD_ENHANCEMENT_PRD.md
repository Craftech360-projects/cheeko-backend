# Cheeko Admin Dashboard Enhancement PRD

## Document Info
- **Version:** 1.0
- **Date:** January 2026
- **Status:** Draft for Review

---

## Executive Summary

The Cheeko Admin Dashboard (manager-web) currently exposes 10 features but the backend (manager-api-node) has 12+ additional capabilities ready for UI implementation. This PRD outlines the feature backlog, specifications, and implementation activities.

---

## Feature Implementation Backlog

### Feature Matrix

| ID | Feature | Priority | Backend | Effort | Dependencies |
|----|---------|----------|---------|--------|--------------|
| F01 | Content Library Management | P1 | Ready | 3d | None |
| F02 | Analytics Dashboard | P1 | Ready | 4d | None |
| F03 | Device Monitoring Dashboard | P1 | Ready | 2d | None |
| F04 | Playlist Management | P2 | Ready | 2d | F01 |
| F05 | Kid Learning Progress | P2 | Ready | 3d | None |
| F06 | Media Playback History | P2 | Ready | 2d | None |
| F07 | System Stats Overview | P3 | Ready | 1d | None |
| F08 | RFID Testing Console | P3 | Ready | 1d | None |
| F09 | MCP Tools Manager | P3 | Ready | 2d | None |
| F10 | Reports & Export | P4 | Partial | 4d | F02, F03 |
| F11 | Real-time Monitor | P4 | Needs WS | 5d | F03 |
| F12 | Parent Portal | P4 | Partial | 5d | F05 |
| **F13** | **Daily Email Reports (Cron)** | **P2** | **New** | **3d** | **None** |

**Legend:** P1=Critical, P2=Important, P3=Nice-to-have, P4=Future

---

## Feature Specifications

### F01: Content Library Management

**Route:** `/content-library`

**User Stories:**
- As an admin, I want to browse all content (music, stories, textbooks) in one place
- As an admin, I want to search content by title, category, or language
- As an admin, I want to add/edit/delete content items
- As an admin, I want to see content statistics (count by type, category)

**Acceptance Criteria:**
- [ ] Table displays all content with columns: Type, Title, Category, Language, Duration, Status
- [ ] Filter sidebar with type, category, language, status dropdowns
- [ ] Search input with debounced full-text search
- [ ] Add dialog with type-specific fields (music: artist, album; story: author, age group)
- [ ] Edit dialog pre-fills existing data
- [ ] Delete with confirmation
- [ ] Batch delete selected items
- [ ] Pagination (10, 20, 50, 100 per page)
- [ ] Statistics cards (total content, by type breakdown)

**API Endpoints:**
```
GET    /content/library?page=1&limit=20&type=music&category=&search=
GET    /content/library/{id}
POST   /content/library
PUT    /content/library/{id}
DELETE /content/library/{id}
GET    /content/library/categories
GET    /content/items/statistics
```

**UI Mockup:**
```
+---------------------------------------------------------------------+
| Content Library                                    [+ Add Content]   |
+---------------------------------------------------------------------+
| Stats: Total: 1,234 | Music: 567 | Stories: 456 | Textbooks: 211    |
+----------+----------------------------------------------------------+
| Filters  |  Search...                                               |
|          +----------------------------------------------------------+
| Type:    |  [] | Type | Title        | Category | Lang | Dur | Ops  |
| [All v]  |  [x]| Music| Song A       | Kids     | en   | 3:20| Edit |
|          |  [] | Story| Story B      | Fairy    | en   | 5:10| Edit |
| Category:|  [] | Book | Math Grade 5 | Textbook | en   | -   | Edit |
| [All v]  +----------------------------------------------------------+
|          |  Page: [1] [2] [3] ... [50]    Showing 1-20 of 1,234     |
+----------+----------------------------------------------------------+
```

**Files to Create:**
- `views/ContentLibrary.vue`
- `components/ContentDialog.vue`
- Router entry: `{ path: '/content-library', component: ContentLibrary }`

---

### F02: Analytics Dashboard

**Route:** `/analytics-dashboard`

**User Stories:**
- As an admin, I want to see overall usage statistics at a glance
- As an admin, I want to view game performance by type (math, riddle, word ladder)
- As an admin, I want to track daily/weekly/monthly activity trends
- As an admin, I want to see top-performing devices and kids

**Acceptance Criteria:**
- [ ] Summary cards: Total Sessions, Total Time, Avg Accuracy, Active Devices
- [ ] Date range picker (today, 7d, 30d, custom)
- [ ] Activity trend line chart (sessions per day)
- [ ] Game performance bar chart (accuracy by game type)
- [ ] Difficulty distribution pie chart
- [ ] Response time (TTFT) trend chart
- [ ] Top 10 active devices table
- [ ] Recent sessions table with drill-down
- [ ] Export to CSV button

**API Endpoints:**
```
GET /analytics/session/{mac}?page=1&limit=20
GET /analytics/session/{mac}/{sessionId}
GET /analytics/attempt/{mac}/stats
GET /analytics/streak/{mac}
GET /analytics/progress/{mac}
GET /device/token-usage/summary?startDate=&endDate=
```

**UI Mockup:**
```
+---------------------------------------------------------------------+
| Analytics Dashboard                     Date: [Last 7 Days v]        |
+---------------------------------------------------------------------+
| +----------+ +----------+ +----------+ +----------+                  |
| |Sessions  | |Time Spent| |Accuracy  | |Active Dev|                  |
| |  1,234   | |  56.2 hrs| |  78.5%   | |    45    |                  |
| +----------+ +----------+ +----------+ +----------+                  |
+---------------------------------------------------------------------+
|  Activity Trend                    |  Game Performance               |
|  [Line Chart]                      |  [Bar Chart]                    |
|                                    |  Math    ======== 82%           |
|                                    |  Riddle  ======   71%           |
|                                    |  Word    =======  76%           |
+---------------------------------------------------------------------+
| Recent Sessions                                        [Export]      |
| +---------------------------------------------------------------+   |
| | Device     | Game Type  | Duration | Accuracy | Date          |   |
| | AA:BB:CC.. | Math       | 5:32     | 85%      | Jan 27, 10am  |   |
| +---------------------------------------------------------------+   |
+---------------------------------------------------------------------+
```

**Files to Create:**
- `views/AnalyticsDashboard.vue`
- `components/AnalyticsChart.vue`
- Extend `apis/module/analytics.js`

---

### F03: Device Monitoring Dashboard

**Route:** `/device-monitor`

**User Stories:**
- As an admin, I want to see all devices with their current status
- As an admin, I want to see which mode each device is in
- As an admin, I want to track token usage per device
- As an admin, I want to see firmware versions across fleet

**Acceptance Criteria:**
- [ ] Device grid/list toggle view
- [ ] Status indicators (online/offline based on last_connected)
- [ ] Current mode display (conversation, music, story)
- [ ] Mode switch buttons
- [ ] Token usage sparkline per device
- [ ] Firmware version column with update indicator
- [ ] Filter by status, mode, firmware version
- [ ] Sort by last connected, name, token usage

**API Endpoints:**
```
GET /device/list?page=1&limit=50
GET /device/{mac}/mode
POST /device/{mac}/cycle-mode
GET /device/token-usage/{mac}/stats
GET /device/ota/firmware/latest/{type}
```

**Files to Create:**
- `views/DeviceMonitor.vue`
- `components/DeviceCard.vue`

---

### F04: Playlist Management

**Route:** `/playlist-management`

**User Stories:**
- As an admin, I want to view and manage music/story playlists per device
- As an admin, I want to add content from the library to a device's playlist
- As an admin, I want to reorder playlist items
- As an admin, I want to clear a playlist

**Acceptance Criteria:**
- [ ] Device selector dropdown
- [ ] Tabs for Music Playlist and Story Playlist
- [ ] Draggable list items for reordering
- [ ] Add from library button (opens content picker)
- [ ] Remove item button per row
- [ ] Clear playlist button with confirmation
- [ ] Show content duration and thumbnail

**API Endpoints:**
```
GET    /content/playlist/music/{deviceId}
POST   /content/playlist/music/{deviceId}
DELETE /content/playlist/music/{deviceId}/{contentId}
DELETE /content/playlist/music/{deviceId}/clear
PUT    /content/playlist/music/{deviceId}/reorder
```

**Files to Create:**
- `views/PlaylistManagement.vue`
- `components/PlaylistItem.vue`
- `components/ContentPicker.vue`

---

### F05: Kid Learning Progress

**Route:** `/learning-progress`

**User Stories:**
- As an admin, I want to see learning progress for each kid
- As an admin, I want to view subject/topic breakdown
- As an admin, I want to track skill levels over time

**Acceptance Criteria:**
- [ ] Kid selector (linked to device)
- [ ] Progress overview cards (total sessions, time, accuracy)
- [ ] Subject breakdown bar chart
- [ ] Skill level radar chart
- [ ] Weekly activity calendar
- [ ] Recent activity timeline
- [ ] Achievement badges display

**API Endpoints:**
```
GET /analytics/progress/{mac}
GET /api/mobile/kid/{kidId}/activity
GET /api/mobile/kid/{kidId}/progress
```

**Files to Create:**
- `views/LearningProgress.vue`
- `components/ProgressChart.vue`
- `components/SkillRadar.vue`

---

### F06: Media Playback History

**Route:** `/media-history`

**User Stories:**
- As an admin, I want to see what music/stories have been played
- As an admin, I want to see completion rates
- As an admin, I want to identify popular content

**Acceptance Criteria:**
- [ ] Device filter
- [ ] Date range filter
- [ ] Playback history table (content, start time, duration, completion %)
- [ ] Most played content chart
- [ ] Skip pattern analysis
- [ ] Export functionality

**API Endpoints:**
```
GET /analytics/media/{mac}?page=1&limit=50&type=&startDate=&endDate=
```

**Files to Create:**
- `views/MediaHistory.vue`

---

### F07: System Stats Overview

**Route:** `/system-overview`

**User Stories:**
- As an admin, I want to see system-wide statistics
- As an admin, I want to track user/device registration trends
- As an admin, I want to monitor system health

**Acceptance Criteria:**
- [ ] KPI cards: Total Users, Total Devices, Total Agents, Active Today
- [ ] User registration trend chart (30 days)
- [ ] Device registration trend chart
- [ ] Session count trend chart
- [ ] Token usage trend chart with cost

**API Endpoints:**
```
GET /admin/stats/overview
GET /admin/stats/users
GET /admin/stats/devices
GET /admin/stats/sessions
GET /admin/stats/tokens
```

**Files to Create:**
- `views/SystemOverview.vue`

---

### F08: RFID Testing Console

**Route:** `/rfid-console` (tab in RFID Management)

**User Stories:**
- As an admin, I want to test RFID card lookups
- As an admin, I want to debug card-to-content mappings
- As an admin, I want to test RAG responses

**Acceptance Criteria:**
- [ ] RFID UID input field
- [ ] Lookup button
- [ ] Response display (JSON/formatted)
- [ ] Series lookup test
- [ ] Error display for invalid UIDs

**API Endpoints:**
```
GET /admin/rfid/card/lookup/{rfidUid}
GET /admin/rfid/series/lookup/{uid}
```

**Files to Create:**
- Add tab to `views/RfidManagement.vue`
- `components/RfidConsole.vue`

---

### F13: Daily Email Reports (Cron Job)

**Type:** Backend Service + Dashboard Configuration UI

**User Stories:**
- As an admin, I want to receive daily email summaries of system activity
- As a parent, I want to receive daily updates about my child's learning progress
- As an admin, I want to configure email schedules and recipients
- As an admin, I want to customize what data is included in reports

**Acceptance Criteria:**

**Backend (Cron Service):**
- [ ] Cron job runs daily at configurable time (default: 8 AM)
- [ ] Aggregates previous day's data:
  - Active devices count
  - Total sessions and playtime
  - Game performance (accuracy by type)
  - Token usage and cost
  - New user/device registrations
  - Top content played
- [ ] Generates HTML email template
- [ ] Sends to configured recipients
- [ ] Logs email delivery status
- [ ] Retry mechanism for failed deliveries

**Dashboard UI (Email Settings Page):**
- [ ] Enable/disable daily reports toggle
- [ ] Schedule time picker (hour selection)
- [ ] Recipient list management (add/remove emails)
- [ ] Report sections toggle (choose what to include)
- [ ] Test email button (send sample immediately)
- [ ] View email history/logs

**Email Content Sections:**
1. **Executive Summary** - Key metrics at a glance
2. **Device Activity** - Active devices, new registrations
3. **Learning Progress** - Sessions, accuracy, top performers
4. **Content Engagement** - Most played music/stories
5. **Token Usage** - Consumption and cost breakdown
6. **Alerts** - Inactive devices, low engagement warnings

**Technical Implementation:**

**Option A: Node-cron in manager-api-node**
```javascript
// src/jobs/dailyEmailReport.js
const cron = require('node-cron');
const nodemailer = require('nodemailer');

// Run every day at 8 AM
cron.schedule('0 8 * * *', async () => {
  const report = await generateDailyReport();
  await sendEmailToRecipients(report);
});
```

**Option B: External Cron Service (Recommended for Production)**
- Use Supabase Edge Functions with pg_cron
- Or use external service (Render Cron, Railway Cron, AWS EventBridge)
- Calls internal API endpoint to generate and send report

**API Endpoints:**
```
# Email Configuration
GET    /admin/email-reports/config          # Get current config
PUT    /admin/email-reports/config          # Update config
POST   /admin/email-reports/test            # Send test email
GET    /admin/email-reports/history         # Get send history

# Report Generation (called by cron)
POST   /internal/email-reports/generate     # Generate & send daily report
GET    /internal/email-reports/preview      # Preview report HTML
```

**Database Schema:**
```sql
-- Email report configuration
CREATE TABLE email_report_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN DEFAULT false,
  schedule_hour INTEGER DEFAULT 8,
  schedule_timezone TEXT DEFAULT 'Asia/Kolkata',
  recipients JSONB DEFAULT '[]',
  sections JSONB DEFAULT '{"summary":true,"devices":true,"learning":true,"content":true,"tokens":true,"alerts":true}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email send history
CREATE TABLE email_report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  recipients TEXT[] NOT NULL,
  status TEXT NOT NULL, -- 'sent', 'failed', 'partial'
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Dependencies:**
- `nodemailer` - Email sending
- `node-cron` - Job scheduling
- `handlebars` or `ejs` - Email templating

**Files to Create:**
- `src/jobs/dailyEmailReport.js` - Cron job logic
- `src/services/emailReport.service.js` - Report generation
- `src/routes/emailReport.routes.js` - API endpoints
- `src/templates/dailyReport.hbs` - Email template
- `views/EmailReportSettings.vue` - Dashboard config UI

**Environment Variables:**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=reports@cheeko.ai
SMTP_PASS=app-password
SMTP_FROM="Cheeko Reports <reports@cheeko.ai>"
```

---

## Activity Tracking

### Sprint 1: Foundation (Week 1-2)

| Activity ID | Activity | Feature | Assignee | Status | Est Hours |
|-------------|----------|---------|----------|--------|-----------|
| A01 | Create ContentLibrary.vue | F01 | - | Not Started | 8 |
| A02 | Create ContentDialog.vue | F01 | - | Not Started | 4 |
| A03 | Add content.js API methods | F01 | - | Not Started | 2 |
| A04 | Add router entry for /content-library | F01 | - | Not Started | 0.5 |
| A05 | Add navigation link | F01 | - | Not Started | 0.5 |
| A06 | Test content CRUD operations | F01 | - | Not Started | 2 |
| A07 | Create AnalyticsDashboard.vue | F02 | - | Not Started | 12 |
| A08 | Integrate chart library (ECharts/Chart.js) | F02 | - | Not Started | 4 |
| A09 | Create analytics summary cards | F02 | - | Not Started | 3 |
| A10 | Add date range picker | F02 | - | Not Started | 2 |

### Sprint 2: Device & Playlist (Week 3)

| Activity ID | Activity | Feature | Assignee | Status | Est Hours |
|-------------|----------|---------|----------|--------|-----------|
| A11 | Create DeviceMonitor.vue | F03 | - | Not Started | 8 |
| A12 | Create DeviceCard.vue | F03 | - | Not Started | 4 |
| A13 | Add mode switching API calls | F03 | - | Not Started | 2 |
| A14 | Create PlaylistManagement.vue | F04 | - | Not Started | 8 |
| A15 | Implement drag-and-drop reorder | F04 | - | Not Started | 4 |
| A16 | Create ContentPicker.vue | F04 | - | Not Started | 4 |

### Sprint 3: Progress, History & Email Reports (Week 4)

| Activity ID | Activity | Feature | Assignee | Status | Est Hours |
|-------------|----------|---------|----------|--------|-----------|
| A17 | Create LearningProgress.vue | F05 | - | Not Started | 10 |
| A18 | Create SkillRadar.vue | F05 | - | Not Started | 4 |
| A19 | Create MediaHistory.vue | F06 | - | Not Started | 6 |
| A20 | Create SystemOverview.vue | F07 | - | Not Started | 6 |
| A21 | Add RFID Console tab | F08 | - | Not Started | 4 |
| A22 | Create email_report_config table migration | F13 | - | Not Started | 1 |
| A23 | Create emailReport.service.js | F13 | - | Not Started | 6 |
| A24 | Create emailReport.routes.js | F13 | - | Not Started | 2 |
| A25 | Create dailyReport.hbs email template | F13 | - | Not Started | 3 |
| A26 | Create dailyEmailReport.js cron job | F13 | - | Not Started | 4 |
| A27 | Create EmailReportSettings.vue | F13 | - | Not Started | 6 |
| A28 | Install nodemailer & node-cron deps | F13 | - | Not Started | 0.5 |
| A29 | Configure SMTP environment variables | F13 | - | Not Started | 0.5 |
| A30 | Test email delivery end-to-end | F13 | - | Not Started | 2 |

### Sprint 4: Polish & Testing (Week 5)

| Activity ID | Activity | Feature | Assignee | Status | Est Hours |
|-------------|----------|---------|----------|--------|-----------|
| A31 | End-to-end testing all features | All | - | Not Started | 8 |
| A32 | Performance optimization | All | - | Not Started | 4 |
| A33 | Documentation update | All | - | Not Started | 4 |
| A34 | User acceptance testing | All | - | Not Started | 8 |

---

## Quick Wins (Immediate Implementation)

These can be done in 1-2 hours each:

| QW | Description | File to Modify | Effort |
|----|-------------|----------------|--------|
| QW1 | Add "Content Library" to sidebar/header nav | HeaderBar.vue | 15 min |
| QW2 | Add "Mode" column to AllDevices table | AllDevices.vue | 30 min |
| QW3 | Add stats cards to Home page (users, devices, sessions) | home.vue | 1 hr |
| QW4 | Add playlist tab to Device Management dialog | DeviceManagement.vue | 1 hr |
| QW5 | Add bar charts to Token Analytics page | TokenAnalytics.vue | 2 hr |
| QW6 | Add RFID lookup test button to RFID page | RfidManagement.vue | 1 hr |

### Quick Win Implementation Details

#### QW1: Add Content Library Navigation Link
**File:** `main/manager-web/src/components/HeaderBar.vue`
**Steps:**
1. Add new navigation item in nav menu
2. Route to `/content-library` (can show "Coming Soon" until F01 is built)
3. Add Content icon

#### QW2: Add Mode Column to AllDevices Table
**File:** `main/manager-web/src/views/AllDevices.vue`
**API:** `GET /device/{mac}/mode`
**Steps:**
1. Add `mode` column to el-table
2. Fetch mode for each device (batch or per-row)
3. Display mode with icon/tag (conversation, music, story)

#### QW3: Add Stats Cards to Home Page
**File:** `main/manager-web/src/views/home.vue`
**API:** `GET /admin/stats/overview`
**Steps:**
1. Add API method in admin.js for stats
2. Add row of stat cards above agent table
3. Cards: Total Users, Total Devices, Total Sessions, Active Today
4. Style matching existing card design

#### QW4: Add Playlist Tab to Device Management
**File:** `main/manager-web/src/views/DeviceManagement.vue`
**API:** `GET /device/{mac}/playlist/music`, `GET /device/{mac}/playlist/story`
**Steps:**
1. Add tabs component to device detail view
2. Tab 1: Device Info (current content)
3. Tab 2: Music Playlist (list view)
4. Tab 3: Story Playlist (list view)

#### QW5: Add Bar Charts to Token Analytics
**File:** `main/manager-web/src/views/TokenAnalytics.vue`
**Steps:**
1. Install vue-echarts if not present
2. Add bar chart for token usage by device
3. Add line chart for daily token trend
4. Add pie chart for input vs output tokens

#### QW6: Add RFID Lookup Test to RFID Page
**File:** `main/manager-web/src/views/RfidManagement.vue`
**API:** `GET /admin/rfid/card/lookup/{uid}`
**Steps:**
1. Add 5th tab "Console" to existing tabs
2. Add UID input field + Lookup button
3. Display JSON response in code block
4. Show error for invalid UIDs

---

## Navigation Structure Update

**Current:**
```
Home | Devices | All Devices | Users | RFID | Dict | Providers | Params | OTA | Templates | Token Analytics
```

**Proposed:**
```
Dashboard
├── Home (overview)
├── System Overview (NEW)
└── Analytics Dashboard (NEW)

Devices
├── Device Monitor (NEW)
├── All Devices
└── Device Management

Content
├── Content Library (NEW)
├── Playlist Management (NEW)
└── Media History (NEW)

Learning
├── Kid Profiles
└── Learning Progress (NEW)

Configuration
├── Agent Templates
├── RFID Management (+ Console tab)
├── Dictionary Management
├── Provider Management
├── Parameter Management
└── OTA Management

Administration
├── User Management
├── Token Analytics
└── Email Reports (NEW)
```

---

## Technical Dependencies

**Frontend:**
- **Charts:** Install `echarts` or `vue-echarts` for analytics visualizations
- **Drag-and-drop:** Install `vuedraggable` for playlist reordering
- **Date picker:** Element UI el-date-picker (already available)

**Backend (for F13 - Email Reports):**
- **Email:** `nodemailer` - SMTP email sending
- **Scheduling:** `node-cron` - Cron job scheduling
- **Templating:** `handlebars` - Email HTML templates

**Infrastructure:**
- SMTP server access (Gmail, SendGrid, AWS SES, etc.)
- Database migration for email_report_config table

**No backend changes needed** for P1-P3 features (except F13)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Admin task completion time | -30% |
| Feature adoption rate | 80% in 30 days |
| Support tickets for content management | -50% |
| Data visibility (previously hidden analytics) | 100% exposed |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large dataset performance | Medium | Implement pagination, lazy loading |
| Chart rendering on slow devices | Low | Use lightweight chart library, server-side aggregation |
| API rate limiting | Low | Add request caching, debounce searches |

---

## Approval & Sign-off

- [ ] Product Owner review
- [ ] Technical review
- [ ] UX review
- [ ] Implementation start
