/**
 * Email Report Service
 *
 * Handles daily email report generation and delivery for admin users.
 * Features:
 * - Configuration management (enable/disable, schedule, recipients)
 * - Report data aggregation from various sources
 * - Email template rendering
 * - Send history tracking
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

// =============================================
// Configuration Management
// =============================================

/**
 * Get email report configuration
 * Creates default config if none exists
 * @returns {Promise<Object>} Configuration object
 */
const getConfig = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Try to get existing config
  const { data: config, error } = await supabaseAdmin
    .from('email_report_config')
    .select('*')
    .limit(1)
    .single();

  if (error && error.code === 'PGRST116') {
    // No config exists, create default
    const defaultConfig = {
      enabled: false,
      schedule_hour: 8,
      schedule_timezone: 'Asia/Kolkata',
      recipients: [],
      sections: {
        summary: true,
        devices: true,
        learning: true,
        content: true,
        tokens: true,
        alerts: true
      }
    };

    const { data: newConfig, error: insertError } = await supabaseAdmin
      .from('email_report_config')
      .insert(defaultConfig)
      .select()
      .single();

    if (insertError) {
      logger.error('Failed to create default email config:', insertError);
      throw new Error('Failed to create email configuration');
    }

    return transformConfig(newConfig);
  }

  if (error) {
    logger.error('Failed to get email config:', error);
    throw new Error('Failed to get email configuration');
  }

  return transformConfig(config);
};

/**
 * Update email report configuration
 * @param {Object} updates - Configuration updates
 * @returns {Promise<Object>} Updated configuration
 */
const updateConfig = async (updates) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get existing config first
  const { data: existing } = await supabaseAdmin
    .from('email_report_config')
    .select('id')
    .limit(1)
    .single();

  const updateData = {
    updated_at: new Date().toISOString()
  };

  if (updates.enabled !== undefined) updateData.enabled = updates.enabled;
  if (updates.scheduleHour !== undefined) updateData.schedule_hour = updates.scheduleHour;
  if (updates.scheduleTimezone !== undefined) updateData.schedule_timezone = updates.scheduleTimezone;
  if (updates.recipients !== undefined) updateData.recipients = updates.recipients;
  if (updates.sections !== undefined) updateData.sections = updates.sections;

  if (existing) {
    // Update existing config
    const { data: config, error } = await supabaseAdmin
      .from('email_report_config')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update email config:', error);
      throw new Error('Failed to update email configuration');
    }

    return transformConfig(config);
  } else {
    // Create new config with updates
    const { data: config, error } = await supabaseAdmin
      .from('email_report_config')
      .insert({
        ...updateData,
        enabled: updates.enabled ?? false,
        schedule_hour: updates.scheduleHour ?? 8,
        schedule_timezone: updates.scheduleTimezone ?? 'Asia/Kolkata',
        recipients: updates.recipients ?? [],
        sections: updates.sections ?? {
          summary: true,
          devices: true,
          learning: true,
          content: true,
          tokens: true,
          alerts: true
        }
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create email config:', error);
      throw new Error('Failed to create email configuration');
    }

    return transformConfig(config);
  }
};

/**
 * Transform DB config to API format
 */
const transformConfig = (config) => {
  if (!config) return null;
  return {
    id: config.id,
    enabled: config.enabled,
    scheduleHour: config.schedule_hour,
    scheduleTimezone: config.schedule_timezone,
    recipients: config.recipients || [],
    sections: config.sections || {},
    createdAt: config.created_at,
    updatedAt: config.updated_at
  };
};

// =============================================
// Report Data Aggregation
// =============================================

/**
 * Generate daily report data
 * Aggregates data from various sources for the specified date
 * @param {Date} reportDate - Date to generate report for (defaults to yesterday)
 * @returns {Promise<Object>} Report data
 */
const generateReportData = async (reportDate = null) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Default to yesterday
  const date = reportDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const reportData = {
    reportDate: date.toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    summary: {},
    devices: {},
    learning: {},
    content: {},
    tokens: {},
    alerts: []
  };

  try {
    // Summary: Get overall counts
    const [usersResult, devicesResult, agentsResult] = await Promise.all([
      supabaseAdmin.from('sys_user').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('ai_device').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('ai_agent').select('id', { count: 'exact', head: true })
    ]);

    reportData.summary = {
      totalUsers: usersResult.count || 0,
      totalDevices: devicesResult.count || 0,
      totalAgents: agentsResult.count || 0
    };

    // Devices: Active devices for the day
    const { data: activeDevices, count: activeCount } = await supabaseAdmin
      .from('ai_device')
      .select('mac_address, alias, last_connected_at', { count: 'exact' })
      .gte('last_connected_at', startOfDay.toISOString())
      .lte('last_connected_at', endOfDay.toISOString());

    reportData.devices = {
      activeToday: activeCount || 0,
      deviceList: (activeDevices || []).slice(0, 10).map(d => ({
        macAddress: d.mac_address,
        alias: d.alias,
        lastConnected: d.last_connected_at
      }))
    };

    // Learning: Game sessions and performance
    const { data: sessions, count: sessionCount } = await supabaseAdmin
      .from('analytics_game_sessions')
      .select('*', { count: 'exact' })
      .gte('started_at', startOfDay.toISOString())
      .lte('started_at', endOfDay.toISOString());

    const { data: attempts } = await supabaseAdmin
      .from('analytics_game_attempts')
      .select('is_correct, game_type')
      .gte('attempt_time', startOfDay.toISOString())
      .lte('attempt_time', endOfDay.toISOString());

    const correctAttempts = (attempts || []).filter(a => a.is_correct).length;
    const totalAttempts = (attempts || []).length;
    const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

    // Group by game type
    const gameTypeStats = {};
    (attempts || []).forEach(a => {
      if (!gameTypeStats[a.game_type]) {
        gameTypeStats[a.game_type] = { total: 0, correct: 0 };
      }
      gameTypeStats[a.game_type].total++;
      if (a.is_correct) gameTypeStats[a.game_type].correct++;
    });

    reportData.learning = {
      totalSessions: sessionCount || 0,
      totalAttempts,
      correctAttempts,
      accuracy,
      byGameType: Object.entries(gameTypeStats).map(([type, stats]) => ({
        gameType: type,
        attempts: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
      }))
    };

    // Content: Most played content
    const { data: mediaPlayback } = await supabaseAdmin
      .from('analytics_media_playback')
      .select('content_id, content_type')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString());

    const contentCounts = {};
    (mediaPlayback || []).forEach(p => {
      const key = `${p.content_type}:${p.content_id}`;
      contentCounts[key] = (contentCounts[key] || 0) + 1;
    });

    const topContent = Object.entries(contentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [type, id] = key.split(':');
        return { contentType: type, contentId: id, playCount: count };
      });

    reportData.content = {
      totalPlays: (mediaPlayback || []).length,
      topContent
    };

    // Tokens: Usage and cost
    const { data: tokenUsage } = await supabaseAdmin
      .from('device_token_usage')
      .select('input_tokens, output_tokens, total_tokens')
      .eq('usage_date', date.toISOString().split('T')[0]);

    const tokenStats = (tokenUsage || []).reduce((acc, t) => ({
      inputTokens: acc.inputTokens + (t.input_tokens || 0),
      outputTokens: acc.outputTokens + (t.output_tokens || 0),
      totalTokens: acc.totalTokens + (t.total_tokens || 0)
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    // Estimate cost (example rates: $0.015 per 1K input, $0.075 per 1K output)
    const inputCost = (tokenStats.inputTokens / 1000) * 0.015;
    const outputCost = (tokenStats.outputTokens / 1000) * 0.075;

    reportData.tokens = {
      ...tokenStats,
      estimatedCost: Math.round((inputCost + outputCost) * 100) / 100
    };

    // Alerts: Identify issues
    // Check for inactive devices (no activity in 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { data: inactiveDevices, count: inactiveCount } = await supabaseAdmin
      .from('ai_device')
      .select('mac_address, alias', { count: 'exact' })
      .lt('last_connected_at', sevenDaysAgo.toISOString());

    if (inactiveCount > 0) {
      reportData.alerts.push({
        type: 'warning',
        title: 'Inactive Devices',
        message: `${inactiveCount} device(s) haven't connected in the last 7 days`,
        count: inactiveCount
      });
    }

    // Check for low engagement (devices with 0 sessions today)
    if (reportData.devices.activeToday === 0) {
      reportData.alerts.push({
        type: 'info',
        title: 'No Activity',
        message: 'No devices were active today',
        count: 0
      });
    }

  } catch (error) {
    logger.error('Error generating report data:', error);
    reportData.error = error.message;
  }

  return reportData;
};

// =============================================
// Email Sending
// =============================================

/**
 * Generate HTML email from report data
 * @param {Object} reportData - Report data object
 * @param {Object} sections - Which sections to include
 * @returns {string} HTML email content
 */
const generateEmailHtml = (reportData, sections = {}) => {
  const {
    summary = true,
    devices = true,
    learning = true,
    content = true,
    tokens = true,
    alerts = true
  } = sections;

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cheeko Daily Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #FF6B35;
    }
    .header h1 {
      color: #FF6B35;
      margin: 0;
      font-size: 24px;
    }
    .header .date {
      color: #666;
      font-size: 14px;
      margin-top: 8px;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .stat-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #FF6B35;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .alert-warning {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
    }
    .alert-info {
      background: #cce5ff;
      border-left: 4px solid #007bff;
    }
    .alert-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .table th, .table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    .table th {
      background: #f8f9fa;
      font-weight: 600;
      color: #666;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #999;
    }
    .footer a {
      color: #FF6B35;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Cheeko Daily Report</h1>
      <div class="date">${formatDate(reportData.reportDate)}</div>
    </div>
`;

  // Summary Section
  if (summary && reportData.summary) {
    html += `
    <div class="section">
      <div class="section-title">Executive Summary</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${reportData.summary.totalUsers || 0}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${reportData.summary.totalDevices || 0}</div>
          <div class="stat-label">Total Devices</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${reportData.devices?.activeToday || 0}</div>
          <div class="stat-label">Active Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${reportData.summary.totalAgents || 0}</div>
          <div class="stat-label">AI Agents</div>
        </div>
      </div>
    </div>
`;
  }

  // Learning Section
  if (learning && reportData.learning) {
    html += `
    <div class="section">
      <div class="section-title">Learning Progress</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${reportData.learning.totalSessions || 0}</div>
          <div class="stat-label">Sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${reportData.learning.accuracy || 0}%</div>
          <div class="stat-label">Accuracy</div>
        </div>
      </div>
      ${reportData.learning.byGameType?.length > 0 ? `
      <table class="table" style="margin-top: 12px;">
        <thead>
          <tr>
            <th>Game Type</th>
            <th>Attempts</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          ${reportData.learning.byGameType.map(g => `
          <tr>
            <td>${g.gameType}</td>
            <td>${g.attempts}</td>
            <td>${g.accuracy}%</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}
    </div>
`;
  }

  // Content Section
  if (content && reportData.content) {
    html += `
    <div class="section">
      <div class="section-title">Content Engagement</div>
      <div class="stat-card" style="margin-bottom: 12px;">
        <div class="stat-value">${reportData.content.totalPlays || 0}</div>
        <div class="stat-label">Total Plays</div>
      </div>
      ${reportData.content.topContent?.length > 0 ? `
      <table class="table">
        <thead>
          <tr>
            <th>Content Type</th>
            <th>Plays</th>
          </tr>
        </thead>
        <tbody>
          ${reportData.content.topContent.map(c => `
          <tr>
            <td>${c.contentType}</td>
            <td>${c.playCount}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}
    </div>
`;
  }

  // Tokens Section
  if (tokens && reportData.tokens) {
    html += `
    <div class="section">
      <div class="section-title">Token Usage & Cost</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${(reportData.tokens.totalTokens || 0).toLocaleString()}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${reportData.tokens.estimatedCost || '0.00'}</div>
          <div class="stat-label">Est. Cost</div>
        </div>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: #666;">
        Input: ${(reportData.tokens.inputTokens || 0).toLocaleString()} |
        Output: ${(reportData.tokens.outputTokens || 0).toLocaleString()}
      </div>
    </div>
`;
  }

  // Alerts Section
  if (alerts && reportData.alerts?.length > 0) {
    html += `
    <div class="section">
      <div class="section-title">Alerts & Warnings</div>
      ${reportData.alerts.map(alert => `
      <div class="alert alert-${alert.type}">
        <div class="alert-title">${alert.title}</div>
        <div>${alert.message}</div>
      </div>
      `).join('')}
    </div>
`;
  }

  // Footer
  html += `
    <div class="footer">
      <p>This report was automatically generated by Cheeko Admin System</p>
      <p><a href="${process.env.DASHBOARD_URL || 'https://admin.cheeko.ai'}">View Full Dashboard</a></p>
    </div>
  </div>
</body>
</html>
`;

  return html;
};

/**
 * Send email report
 * Note: This is a placeholder - in production, integrate with actual SMTP service
 * @param {string[]} recipients - Email addresses
 * @param {Object} reportData - Report data
 * @param {Object} sections - Which sections to include
 * @returns {Promise<Object>} Send result
 */
const sendEmailReport = async (recipients, reportData, sections) => {
  // Generate HTML content
  const htmlContent = generateEmailHtml(reportData, sections);

  // Check if nodemailer is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('SMTP not configured. Email report will be logged instead.');
    logger.info('Email Report would be sent to:', recipients);
    logger.info('Report Date:', reportData.reportDate);

    // Still record the history even if not actually sent
    return {
      success: true,
      message: 'Email logged (SMTP not configured)',
      recipients,
      simulated: true
    };
  }

  // In production, use nodemailer here
  // const nodemailer = require('nodemailer');
  // const transporter = nodemailer.createTransport({...});
  // await transporter.sendMail({...});

  try {
    // Dynamic import for optional dependency
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || `"Cheeko Reports" <${smtpUser}>`,
      to: recipients.join(', '),
      subject: `Cheeko Daily Report - ${reportData.reportDate}`,
      html: htmlContent
    };

    const result = await transporter.sendMail(mailOptions);
    logger.info('Email report sent successfully:', result.messageId);

    return {
      success: true,
      message: 'Email sent successfully',
      messageId: result.messageId,
      recipients
    };
  } catch (error) {
    logger.error('Failed to send email report:', error);
    return {
      success: false,
      message: error.message,
      recipients
    };
  }
};

// =============================================
// History Management
// =============================================

/**
 * Record email send history
 * @param {Object} params - History params
 * @returns {Promise<Object>} History record
 */
const recordHistory = async ({ reportDate, recipients, status, errorMessage = null, reportData = null }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data, error } = await supabaseAdmin
    .from('email_report_history')
    .insert({
      report_date: reportDate,
      recipients,
      status,
      error_message: errorMessage,
      report_data: reportData,
      sent_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to record email history:', error);
    throw new Error('Failed to record email history');
  }

  return data;
};

/**
 * Get email send history
 * @param {Object} params - Query params
 * @returns {Promise<Object>} Paginated history
 */
const getHistory = async ({ page = 1, limit = 20 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  const { data: history, error, count } = await supabaseAdmin
    .from('email_report_history')
    .select('*', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get email history:', error);
    throw new Error('Failed to get email history');
  }

  return {
    list: (history || []).map(h => ({
      id: h.id,
      reportDate: h.report_date,
      recipients: h.recipients,
      status: h.status,
      errorMessage: h.error_message,
      sentAt: h.sent_at
    })),
    total: count || 0,
    page,
    limit
  };
};

/**
 * Send test email
 * @param {string} recipient - Test recipient email
 * @returns {Promise<Object>} Send result
 */
const sendTestEmail = async (recipient) => {
  // Generate sample report data
  const sampleData = {
    reportDate: new Date().toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: 42,
      totalDevices: 28,
      totalAgents: 5
    },
    devices: {
      activeToday: 15,
      deviceList: [
        { macAddress: 'AA:BB:CC:DD:EE:FF', alias: 'Test Device 1', lastConnected: new Date().toISOString() }
      ]
    },
    learning: {
      totalSessions: 87,
      totalAttempts: 245,
      correctAttempts: 198,
      accuracy: 81,
      byGameType: [
        { gameType: 'math', attempts: 120, correct: 98, accuracy: 82 },
        { gameType: 'riddle', attempts: 75, correct: 60, accuracy: 80 },
        { gameType: 'word_ladder', attempts: 50, correct: 40, accuracy: 80 }
      ]
    },
    content: {
      totalPlays: 156,
      topContent: [
        { contentType: 'music', contentId: '1', playCount: 45 },
        { contentType: 'story', contentId: '2', playCount: 32 }
      ]
    },
    tokens: {
      inputTokens: 125000,
      outputTokens: 85000,
      totalTokens: 210000,
      estimatedCost: 8.25
    },
    alerts: [
      { type: 'info', title: 'Test Alert', message: 'This is a test email report' }
    ]
  };

  const config = await getConfig();
  const result = await sendEmailReport([recipient], sampleData, config.sections);

  // Record test in history
  await recordHistory({
    reportDate: sampleData.reportDate,
    recipients: [recipient],
    status: result.success ? 'sent' : 'failed',
    errorMessage: result.success ? null : result.message,
    reportData: { test: true }
  });

  return result;
};

/**
 * Generate and send daily report
 * Called by cron job
 * @returns {Promise<Object>} Send result
 */
const generateAndSendDailyReport = async () => {
  const config = await getConfig();

  if (!config.enabled) {
    logger.info('Daily email report is disabled');
    return { success: false, message: 'Email reports are disabled' };
  }

  if (!config.recipients || config.recipients.length === 0) {
    logger.warn('No recipients configured for daily report');
    return { success: false, message: 'No recipients configured' };
  }

  try {
    // Generate report data for yesterday
    const reportData = await generateReportData();

    // Send email
    const result = await sendEmailReport(config.recipients, reportData, config.sections);

    // Record history
    await recordHistory({
      reportDate: reportData.reportDate,
      recipients: config.recipients,
      status: result.success ? 'sent' : 'failed',
      errorMessage: result.success ? null : result.message,
      reportData
    });

    return result;
  } catch (error) {
    logger.error('Failed to generate and send daily report:', error);

    // Record failure
    await recordHistory({
      reportDate: new Date().toISOString().split('T')[0],
      recipients: config.recipients || [],
      status: 'failed',
      errorMessage: error.message
    });

    return { success: false, message: error.message };
  }
};

/**
 * Preview report (generate without sending)
 * @returns {Promise<Object>} Report data with HTML
 */
const previewReport = async () => {
  const config = await getConfig();
  const reportData = await generateReportData();
  const html = generateEmailHtml(reportData, config.sections);

  return {
    reportData,
    html,
    sections: config.sections
  };
};

module.exports = {
  getConfig,
  updateConfig,
  generateReportData,
  generateEmailHtml,
  sendEmailReport,
  recordHistory,
  getHistory,
  sendTestEmail,
  generateAndSendDailyReport,
  previewReport
};
