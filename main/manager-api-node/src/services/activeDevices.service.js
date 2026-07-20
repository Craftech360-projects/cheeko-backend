/**
 * Active Devices Analytics Service
 *
 * Aggregates "which devices were active on a given IST date" from RFID taps
 * and voice sessions, plus per-device drill-down (RFID pack breakdown, chat history).
 *
 * VERIFIED SCHEMA (see ACTIVE_DEVICES_ANALYTICS_PLAN.md Global Constraints):
 * - Join RFID taps on mac_address, NOT device_id (device_id is NULL on ~67% of rows).
 * - All date filtering is explicit IST: (created_at AT TIME ZONE 'Asia/Kolkata')::date = $date.
 * - voice_sessions has NO created_at — use started_at. It has mac_address directly.
 * - ai_agent_chat_history has mac_address AND created_at directly (no agent join needed).
 */

const { prisma } = require('../config/database');

const IST = 'Asia/Kolkata';

/**
 * Devices with any activity (RFID tap OR voice session) on the given IST date.
 * NOTE: taps join on mac_address — device_id is NULL on ~67% of tap rows.
 */
const listActiveDevices = async (dateISO) => {
  return prisma.$queryRaw`
    WITH taps AS (
      SELECT t.mac_address,
             count(*)::int              AS tap_count,
             min(t.created_at)          AS first_tap,
             max(t.created_at)          AS last_tap
      FROM rfid_card_tap_log t
      WHERE (t.created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
      GROUP BY t.mac_address
    ),
    sess AS (
      -- voice_sessions has mac_address directly and uses started_at (NOT created_at)
      SELECT v.mac_address,
             count(*)::int              AS session_count,
             min(v.started_at)          AS first_sess,
             max(v.started_at)          AS last_sess
      FROM voice_sessions v
      WHERE (v.started_at AT TIME ZONE ${IST})::date = ${dateISO}::date
      GROUP BY v.mac_address
    ),
    macs AS (
      SELECT mac_address FROM taps
      UNION
      SELECT mac_address FROM sess
    )
    SELECT m.mac_address,
           d.id            AS device_id,
           d.agent_id,
           k.name          AS kid_name,
           p.display_name  AS parent_name,
           -- Owner fallback: many devices are bound directly to an admin
           -- sys_user with no kid_profile. Without this the UI cannot tell an
           -- admin/test device apart from a deleted one (both render blank).
           u.username      AS owner_username,
           COALESCE(t.tap_count, 0)     AS tap_count,
           COALESCE(s.session_count, 0) AS session_count,
           LEAST(t.first_tap, s.first_sess) AS first_activity,
           GREATEST(t.last_tap, s.last_sess) AS last_activity
    FROM macs m
    LEFT JOIN taps t ON t.mac_address = m.mac_address
    LEFT JOIN sess s ON s.mac_address = m.mac_address
    LEFT JOIN ai_device d ON d.mac_address = m.mac_address
    LEFT JOIN kid_profile k ON k.id = d.kid_id
    LEFT JOIN parent_profile p ON p.user_id = k.user_id
    LEFT JOIN sys_user u ON u.id = d.user_id
    ORDER BY (COALESCE(t.tap_count,0) + COALESCE(s.session_count,0)) DESC;
  `;
};

/** Per-device RFID breakdown for one IST date. */
const deviceRfidBreakdown = async (mac, dateISO) => {
  return prisma.$queryRaw`
    SELECT COALESCE(NULLIF(content_pack_name,''), card_type) AS pack,
           count(*)::int AS taps,
           count(DISTINCT rfid_uid)::int AS cards,
           max(created_at) AS last_tap
    FROM rfid_card_tap_log
    WHERE mac_address ILIKE ${mac}
      AND (created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
    GROUP BY 1 ORDER BY taps DESC;
  `;
};

/**
 * Date-scoped chat history for a device (Task 6, Option A).
 *
 * Reads voice_session_messages, NOT ai_agent_chat_history. The LiveKit agent
 * posts to /agent/chat-history/report, which agent.service.js writes into
 * voice_session_messages; ai_agent_chat_history is the legacy xiaozhi table
 * and has had no new rows since 2026-06-06.
 *
 * role is aliased to the chat_type the UI expects (1=user, 2=agent).
 */
const deviceChatHistory = async (mac, dateISO) => prisma.$queryRaw`
  SELECT id,
         session_id,
         CASE WHEN role = 'user' THEN 1 ELSE 2 END AS chat_type,
         content,
         audio_id,
         created_at
  FROM voice_session_messages
  WHERE mac_address ILIKE ${mac}
    AND (created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
  ORDER BY created_at ASC, sequence ASC
  LIMIT 500;
`;

module.exports = { listActiveDevices, deviceRfidBreakdown, deviceChatHistory };
