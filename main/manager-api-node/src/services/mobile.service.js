const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { ApiError } = require('../middleware/errorHandler');
const { normalizeMacAddress } = require('../utils/helpers');

// ─── Parent Profile ─────────────────────────────────────────────────────────

function dateOrNull(value) {
    return value ? new Date(value) : null;
}

function ageFromBirthDate(value) {
    if (!value) return null;
    const birthDate = new Date(value);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDelta = today.getMonth() - birthDate.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

function getDayRange(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function formatLocalDate(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function positiveDurationMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.trunc(numeric);
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function humanizeKey(value) {
    const raw = value == null ? '' : String(value).trim();
    if (!raw) return 'Unknown';
    const normalized = /^[A-Z0-9_:-]+$/.test(raw) ? raw.toLowerCase() : raw;
    return normalized
        .replace(/^game:/, '')
        .replace(/^card:/, '')
        .replace(/^content:/, '')
        .replace(/^radio:/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function getActivityDetailsRange(period, now = new Date()) {
    const days = period === 'week' ? 7 : 30;
    const end = new Date(now);
    const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
    return { start, end };
}

function incrementCount(grouped, key, name, amount = 1) {
    const resolvedKey = key || 'unknown';
    const current = grouped.get(resolvedKey) || { key: resolvedKey, name: name || humanizeKey(resolvedKey), count: 0 };
    current.count += amount;
    if ((!current.name || current.name === humanizeKey(resolvedKey)) && name) current.name = name;
    grouped.set(resolvedKey, current);
}

function incrementDuration(grouped, key, name, durationMs) {
    const resolvedKey = key || 'unknown';
    const current = grouped.get(resolvedKey) || { key: resolvedKey, name: name || humanizeKey(resolvedKey), durationMs: 0 };
    current.durationMs += durationMs;
    if ((!current.name || current.name === humanizeKey(resolvedKey)) && name) current.name = name;
    grouped.set(resolvedKey, current);
}

function sortCountItems(items) {
    return items.sort((a, b) => b.count - a.count);
}

function sortDurationItems(items) {
    return items.sort((a, b) => (b.durationMs - a.durationMs) || a.name.localeCompare(b.name));
}

function resolveGameKeyAndName(row) {
    const data = safeObject(row.data);
    const key = row.game_id || data.game_id || data.mode || data.game_mode || data.activity || data.activity_type || 'unknown_game';
    const name = data.game_name || data.mode_name || data.activity_name || humanizeKey(key);
    return { key: String(key), name };
}

function resolveCardKeyAndName(row) {
    const data = safeObject(row.data);
    const key = row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id || row.content_id || data.content_id || 'unknown_card';
    const name = data.card_name || data.content_name || data.title || data.pack_name || humanizeKey(key);
    return { key: String(key), name };
}

function resolveUsageKeyAndName(row) {
    const data = safeObject(row.data);
    if (row.game_id || data.game_id) return resolveGameKeyAndName(row);
    if (row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id) return resolveCardKeyAndName(row);
    if (row.content_id || data.content_id) {
        const key = row.content_id || data.content_id;
        return { key: String(key), name: data.content_name || data.title || humanizeKey(key) };
    }
    if (row.station || data.station) {
        const station = row.station || data.station;
        return { key: `radio:${station}`, name: String(station) };
    }
    if (row.event_name === 'ai_talk_end') return { key: 'ai_talk', name: 'AI Talk' };
    return { key: row.event_name || 'other', name: humanizeKey(row.event_name || 'other') };
}

function toCountResponse(metric, period, grouped) {
    const items = sortCountItems(Array.from(grouped.values()));
    const total = items.reduce((sum, item) => sum + item.count, 0);
    return {
        metric,
        period,
        total,
        items,
    };
}

function toDurationResponse(period, grouped) {
    const sorted = sortDurationItems(Array.from(grouped.values()));
    const items = sorted.map(item => {
        const seconds = Math.floor(item.durationMs / 1000);
        return {
            name: item.name,
            key: item.key,
            duration_seconds: seconds,
            durationSeconds: seconds,
        };
    });
    const totalSeconds = items.reduce((sum, item) => sum + item.duration_seconds, 0);
    return {
        metric: 'usage',
        period,
        total_seconds: totalSeconds,
        totalSeconds,
        items,
    };
}

async function getCardNameMap(keys) {
    const rfidKeys = Array.from(new Set((keys || []).filter(Boolean)));
    if (rfidKeys.length === 0) return new Map();

    const mappings = await prisma.rfid_card_mapping.findMany({
        where: { rfid_uid: { in: rfidKeys } },
        select: {
            rfid_uid: true,
            rfid_content_pack: { select: { name: true } },
            rfid_question: { select: { title: true } },
            rfid_pack: { select: { pack_name: true } }
        }
    });

    return new Map((mappings || []).map(mapping => [
        mapping.rfid_uid,
        mapping.rfid_content_pack?.name || mapping.rfid_question?.title || mapping.rfid_pack?.pack_name || null
    ]).filter(([, name]) => Boolean(name)));
}

function formatRecentCardActivity(row) {
    if (!row) return null;

    return {
        id: row.id != null ? row.id.toString() : null,
        mac_address: row.mac_address,
        macAddress: row.mac_address,
        rfid_uid: row.rfid_uid,
        rfidUid: row.rfid_uid,
        card_type: row.card_type || 'unknown',
        cardType: row.card_type || 'unknown',
        content_pack_id: row.content_pack_id != null ? row.content_pack_id.toString() : null,
        contentPackId: row.content_pack_id != null ? row.content_pack_id.toString() : null,
        content_pack_code: row.content_pack_code || null,
        contentPackCode: row.content_pack_code || null,
        content_pack_name: row.content_pack_name || null,
        contentPackName: row.content_pack_name || null,
        created_at: row.created_at,
        createdAt: row.created_at,
    };
}

const HOMEPAGE_AI_CARDS = [
    {
        itemType: 'ai',
        id: 'ai-story-mode',
        title: 'Story AI',
        aiMode: 'story',
        category: 'AI',
        routeName: 'aiStoryMode',
        thumbnailUrl: null,
    },
    {
        itemType: 'ai',
        id: 'ai-music-mode',
        title: 'Music AI',
        aiMode: 'music',
        category: 'AI',
        routeName: 'aiMusicMode',
        thumbnailUrl: null,
    },
    {
        itemType: 'ai',
        id: 'ai-learning-mode',
        title: 'Learning AI',
        aiMode: 'learning',
        category: 'AI',
        routeName: 'aiLearningMode',
        thumbnailUrl: null,
    },
    {
        itemType: 'ai',
        id: 'ai-game-mode',
        title: 'Game AI',
        aiMode: 'game',
        category: 'AI',
        routeName: 'aiGameMode',
        thumbnailUrl: null,
    },
    {
        itemType: 'ai',
        id: 'ai-chat-mode',
        title: 'AI Chat',
        aiMode: 'conversation',
        category: 'AI',
        routeName: 'aiChatMode',
        thumbnailUrl: null,
    },
];

function clampRecommendationLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.min(parsed, 20);
}

function parseBigIntId(value, fieldName) {
    try {
        return BigInt(value);
    } catch (err) {
        throw new ApiError(`${fieldName} must be a valid id`, 400, 400);
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function toArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
}

function addTerms(target, values) {
    toArray(values).forEach(value => {
        const normalized = normalizeText(value);
        if (normalized) target.add(normalized);
    });
}

function addKeywordTokens(target, value) {
    const normalized = normalizeText(value);
    if (!normalized) return;
    target.add(normalized);
    normalized.split(/[^a-z0-9]+/).filter(token => token.length > 1).forEach(token => target.add(token));
}

function metadataTokens(metadata) {
    if (!metadata || typeof metadata !== 'object') return [];
    const values = [];
    const collect = (value) => {
        if (value == null) return;
        if (Array.isArray(value)) {
            value.forEach(collect);
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(collect);
            return;
        }
        values.push(value);
    };
    collect(metadata);
    return values;
}

function collectPreferenceSignals(kid) {
    const preferences = kid.preferences || {};
    const categories = new Set();
    const contentTypes = new Set();
    const aiModes = new Set();

    addTerms(categories, kid.interests);
    addTerms(categories, preferences.interests);
    addTerms(categories, preferences.categories);
    addTerms(categories, preferences.preferredCategories);
    addTerms(categories, preferences.selectedInterests);
    addTerms(categories, preferences.topics);

    addTerms(contentTypes, preferences.contentTypes);
    addTerms(contentTypes, preferences.preferredContentTypes);
    addTerms(contentTypes, preferences.mediaTypes);

    addTerms(aiModes, preferences.aiModes);
    addTerms(aiModes, preferences.preferredAiModes);
    addTerms(aiModes, preferences.aiExperiences);
    addTerms(aiModes, preferences.preferredAiExperiences);

    return { categories, contentTypes, aiModes };
}

function contentTokens(content) {
    return [
        content.title,
        content.name,
        content.category,
        content.content_type,
        content.content_pack_code,
        content.contentPackCode,
        content.pack_code,
        content.packCode,
        ...(Array.isArray(content.tags) ? content.tags : []),
        ...metadataTokens(content.metadata),
    ].map(normalizeText).filter(Boolean);
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return null;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildRecentSignals({ kid, cardTaps, sessions, mediaPlayback }) {
    const preferenceSignals = collectPreferenceSignals(kid);
    const keywords = new Set();
    const recentCategories = new Set();
    const recentContentTypes = new Set();
    const recentModes = new Set();
    const recentContentIds = new Set();
    const recentPackCodes = new Set();
    const recentPackNames = new Set();
    const recentPackCodeLabels = new Map();
    const recentPackNameLabels = new Map();
    let aiCardUsed = false;

    for (const category of preferenceSignals.categories) addKeywordTokens(keywords, category);

    for (const tap of cardTaps || []) {
        [tap.content_pack_name, tap.content_pack_code, tap.card_type, tap.rfid_uid].forEach(value => addKeywordTokens(keywords, value));
        addTerms(recentCategories, tap.content_pack_name);
        addTerms(recentContentTypes, tap.card_type);
        addTerms(recentPackCodes, tap.content_pack_code);
        addTerms(recentPackNames, tap.content_pack_name);
        if (tap.content_pack_code) recentPackCodeLabels.set(normalizeText(tap.content_pack_code), tap.content_pack_code);
        if (tap.content_pack_name) recentPackNameLabels.set(normalizeText(tap.content_pack_name), tap.content_pack_name);
        const tapText = normalizeText(`${tap.content_pack_name || ''} ${tap.content_pack_code || ''} ${tap.card_type || ''}`);
        if (tapText.includes('ai')) {
            aiCardUsed = true;
            if (tapText.includes('story')) recentModes.add('story');
            if (tapText.includes('music')) recentModes.add('music');
            if (tapText.includes('game')) recentModes.add('game');
            if (tapText.includes('learn')) recentModes.add('learning');
            recentModes.add('conversation');
        }
    }

    for (const session of sessions || []) {
        addTerms(recentModes, session.mode_type);
        addTerms(recentContentTypes, session.mode_type);
    }

    for (const playback of mediaPlayback || []) {
        if (playback.content_id != null) recentContentIds.add(playback.content_id.toString());
        addTerms(recentContentTypes, playback.content_type);
    }

    return {
        preferredCategories: preferenceSignals.categories,
        preferredContentTypes: preferenceSignals.contentTypes,
        preferredAiModes: preferenceSignals.aiModes,
        recentKeywords: keywords,
        recentCategories,
        recentContentTypes,
        recentModes,
        recentContentIds,
        recentPackCodes,
        recentPackNames,
        recentPackCodeLabels,
        recentPackNameLabels,
        aiCardUsed,
        language: normalizeText(kid.language || 'en'),
        age: ageFromBirthDate(kid.birth_date),
    };
}

function keywordMatchesContent(keywords, content) {
    const haystack = contentTokens(content).join(' ');
    for (const keyword of keywords) {
        if (keyword && haystack.includes(keyword)) return true;
    }
    return false;
}

function categoryMatches(set, category) {
    const normalized = normalizeText(category);
    return normalized && set.has(normalized);
}

function scoreContent(content, profile) {
    let score = 0;
    const reasons = [];
    const category = normalizeText(content.category);
    const contentType = normalizeText(content.content_type);
    const language = normalizeText(content.language);
    const tokens = contentTokens(content);
    const tokenText = tokens.join(' ');

    for (const code of profile.recentPackCodes) {
        if (code && tokenText.includes(code)) {
            score += 80;
            reasons.push(`Because child used ${profile.recentPackCodeLabels.get(code) || code}`);
            break;
        }
    }

    for (const packName of profile.recentPackNames) {
        if (packName && tokenText.includes(packName)) {
            score += 60;
            reasons.push(`Because child used ${profile.recentPackNameLabels.get(packName) || packName}`);
            break;
        }
    }

    if (categoryMatches(profile.recentCategories, category) || categoryMatches(profile.preferredCategories, category)) {
        score += 50;
        reasons.push(`Because ${content.category} matches your child's recent activity or preferences`);
    }
    if (profile.recentContentTypes.has(contentType) || profile.preferredContentTypes.has(contentType)) {
        score += 40;
        reasons.push(`Because child used ${content.content_type} cards`);
    }
    if (keywordMatchesContent(profile.recentKeywords, content)) {
        score += 30;
        reasons.push(`Because your child recently used ${content.category || content.title}`);
    }
    if (profile.preferredCategories.has(category) || profile.preferredContentTypes.has(contentType)) {
        score += 20;
    }
    if (profile.language && language && profile.language === language) {
        score += 10;
    }
    if (profile.age != null) {
        const min = content.age_min == null ? null : Number(content.age_min);
        const max = content.age_max == null ? null : Number(content.age_max);
        if ((min == null || profile.age >= min) && (max == null || profile.age <= max)) {
            score += 10;
        }
    }
    if (profile.recentContentIds.has(content.id?.toString())) {
        score -= 100;
        reasons.push('Similar alternatives are ranked higher because this was played recently');
    }

    return {
        score,
        reason: reasons[0] || 'Popular content card',
    };
}

function formatRecommendationContent(content, reason) {
    const contentId = content.id != null ? content.id.toString() : null;
    const title = content.title || content.name;
    const category = content.category || 'RFID Content Card';
    const createdAt = content.created_at || content.create_date;
    return {
        itemType: 'content',
        id: contentId,
        contentId,
        title,
        subtitle: reason,
        contentType: content.content_type,
        category,
        packCode: content.pack_code || null,
        contentPackCode: content.pack_code || null,
        thumbnailUrl: normalizeSupabaseAssetUrl(content.thumbnail_url),
        durationSeconds: content.duration_seconds || null,
        formattedDuration: formatDuration(content.duration_seconds),
        totalItems: content.total_items || null,
        createdAt,
        reason,
    };
}

function normalizeSupabaseAssetUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const configuredSupabaseUrl = process.env.SUPABASE_URL;
    if (!configuredSupabaseUrl) return url;

    try {
        const assetUrl = new URL(url);
        const configuredUrl = new URL(configuredSupabaseUrl);
        if (
            assetUrl.hostname.endsWith('.supabase.co') &&
            configuredUrl.hostname.endsWith('.supabase.co') &&
            assetUrl.hostname !== configuredUrl.hostname
        ) {
            assetUrl.hostname = configuredUrl.hostname;
            return assetUrl.toString();
        }
    } catch (error) {
        return url;
    }

    return url;
}

function hasSignals(...sets) {
    return sets.some(set => set && set.size > 0);
}

function scoreAiCard(card, profile, recommendationSource = null) {
    let score = 0;
    const aiMode = normalizeText(card.aiMode);

    if (profile.aiCardUsed) score += 80;
    if (profile.preferredAiModes.has(aiMode)) score += 70;
    if (profile.recentModes.has(aiMode)) score += 20;
    if (profile.recentContentTypes.has(aiMode)) score += 20;
    const isDefaultFallback = recommendationSource === 'default';
    if (score === 0 && !isDefaultFallback) return null;

    const subtitle = isDefaultFallback
        ? 'Try a Cheeko AI experience'
        : (profile.aiCardUsed
        ? 'Because child used an AI card'
        : (profile.preferredAiModes.has(aiMode)
            ? `Because ${card.title} is selected in the child profile preferences`
            : `Because your child recently used ${card.title}`));

    return {
        ...card,
        subtitle,
        reason: subtitle,
        _score: score,
        _createdAt: 0,
    };
}

function sortRecommendations(a, b) {
    if (b._score !== a._score) return b._score - a._score;
    return (b._createdAt || 0) - (a._createdAt || 0);
}

function dedupeRecommendations(items) {
    const seenIds = new Set();
    const seenTitles = new Set();
    const deduped = [];

    for (const item of items) {
        const idKey = `${item.itemType}:${item.id}`;
        const titleKey = `${item.itemType}:${normalizeText(item.title)}`;
        if (seenIds.has(idKey) || seenTitles.has(titleKey)) continue;
        seenIds.add(idKey);
        seenTitles.add(titleKey);
        deduped.push(item);
    }

    return deduped;
}

function collectParentProfileUpdates(data) {
    const updates = {};

    if (data.parent_name || data.fullName || data.displayName) {
        updates.display_name = data.parent_name || data.fullName || data.displayName;
    }
    if (data.phone_number || data.phoneNumber) updates.phone_number = data.phone_number || data.phoneNumber;
    if (data.country_region || data.countryRegion) updates.country_region = data.country_region || data.countryRegion;
    if (data.preferred_language || data.preferredLanguage || data.language) {
        updates.language = data.preferred_language || data.preferredLanguage || data.language;
    }
    if (data.timezone) updates.timezone = data.timezone;
    if (data.email_notifications !== undefined) updates.email_notifications = data.email_notifications;
    if (data.emailNotifications !== undefined) updates.email_notifications = data.emailNotifications;
    if (data.push_notifications !== undefined) updates.push_notifications = data.push_notifications;
    if (data.pushNotifications !== undefined) updates.push_notifications = data.pushNotifications;
    if (data.weekly_report !== undefined) updates.weekly_report = data.weekly_report;
    if (data.weeklyReport !== undefined) updates.weekly_report = data.weeklyReport;
    if (data.fcm_token !== undefined) updates.fcm_token = data.fcm_token;
    if (data.fcmToken !== undefined) updates.fcm_token = data.fcmToken;
    if (data.terms_version !== undefined) updates.terms_version = data.terms_version;
    if (data.termsVersion !== undefined) updates.terms_version = data.termsVersion;
    if (data.terms_accepted_at !== undefined) updates.terms_accepted_at = dateOrNull(data.terms_accepted_at);
    if (data.termsAcceptedAt !== undefined) updates.terms_accepted_at = dateOrNull(data.termsAcceptedAt);
    if (data.privacy_policy_accepted_at !== undefined) {
        updates.privacy_policy_accepted_at = dateOrNull(data.privacy_policy_accepted_at);
    }
    if (data.privacyPolicyAcceptedAt !== undefined) {
        updates.privacy_policy_accepted_at = dateOrNull(data.privacyPolicyAcceptedAt);
    }
    if (data.consent_accepted_at !== undefined) updates.consent_accepted_at = dateOrNull(data.consent_accepted_at);
    if (data.consentAcceptedAt !== undefined) updates.consent_accepted_at = dateOrNull(data.consentAcceptedAt);
    if (data.onboarding_completed !== undefined) updates.onboarding_completed = data.onboarding_completed;
    if (data.onboardingCompleted !== undefined) updates.onboarding_completed = data.onboardingCompleted;

    return updates;
}

function formatParentProfile(profile) {
    if (!profile) return null;

    return {
        ...profile,
        parent_name: profile.display_name,
        fullName: profile.display_name,
        country_region: profile.country_region || null,
        phoneNumber: profile.phone_number,
        fcmToken: profile.fcm_token,
        preferred_language: profile.language,
        preferredLanguage: profile.language,
        notification_preferences: {
            email_notifications: profile.email_notifications,
            push_notifications: profile.push_notifications,
            weekly_report: profile.weekly_report,
        },
        emailNotifications: profile.email_notifications,
        pushNotifications: profile.push_notifications,
        weeklyReport: profile.weekly_report,
        termsVersion: profile.terms_version,
        termsAcceptedAt: profile.terms_accepted_at,
        privacyPolicyAcceptedAt: profile.privacy_policy_accepted_at,
        consentAcceptedAt: profile.consent_accepted_at,
        onboardingCompleted: profile.onboarding_completed,
    };
}

async function getParentProfile(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { parent_profile: true },
    });
    return formatParentProfile(user?.parent_profile || null);
}

async function createParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');
    const updates = collectParentProfileUpdates(data);

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            ...updates,
            onboarding_completed: false,
        },
        update: updates,
    }).then(formatParentProfile);
}

async function updateParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const updates = collectParentProfileUpdates(data);

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            ...updates,
        },
        update: updates,
    }).then(formatParentProfile);
}

async function updateFcmToken(firebaseUid, fcmToken) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            fcm_token: fcmToken,
        },
        update: {
            fcm_token: fcmToken,
        },
    }).then(formatParentProfile);
}

async function clearFcmToken(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            fcm_token: null,
        },
        update: {
            fcm_token: null,
        },
    }).then(formatParentProfile);
}

// ─── User State ─────────────────────────────────────────────────────────────

async function getUserState(firebaseUid) {
    // Mobile app requested user_states, which in Node.js maps to sys_user / parent_profile combinations
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { parent_profile: true },
    });
    if (!user) return null;

    return {
        user_id: user.firebase_uid,
        email: user.email,
        email_verified: true, // Firebase validates emails for OAuth
        onboarding_completed: user.parent_profile?.onboarding_completed || false,
        current_stage: user.parent_profile?.onboarding_completed ? 'completed' : 'profile_setup',
    };
}

async function markOnboardingCompleted(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    await prisma.parent_profile.update({
        where: { user_id: user.id },
        data: { onboarding_completed: true },
    });

    return { success: true };
}

// ─── Kids ───────────────────────────────────────────────────────────────────

async function getKids(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { kid_profile: true },
    });
    if (!user) return [];

    // Map to the format the mobile app expects
    return user.kid_profile.map(k => ({
        id: k.id.toString(),
        parent_id: user.firebase_uid,
        name: k.name,
        nickname: k.nickname,
        avatar_url: k.avatar_url,
        date_of_birth: k.birth_date,
        birth_date: k.birth_date,
        age: ageFromBirthDate(k.birth_date),
        is_active: true,
        isActive: true,
        gender: k.gender,
        interests: k.interests || [],
        language: k.language,
        created_at: k.created_at,
        updated_at: k.updated_at,
    }));
}

async function createKid(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const kid = await prisma.kid_profile.create({
        data: {
            user_id: user.id,
            name: data.name,
            nickname: data.nickname,
            birth_date: (data.date_of_birth || data.birth_date) ? new Date(data.date_of_birth || data.birth_date) : null,
            gender: data.gender,
            interests: data.interests || [],
            language: data.language || 'en',
        },
    });

    return {
        id: kid.id.toString(),
        parent_id: user.firebase_uid,
        name: kid.name,
        nickname: kid.nickname,
        date_of_birth: kid.birth_date,
        birth_date: kid.birth_date,
        age: ageFromBirthDate(kid.birth_date),
        is_active: true,
        isActive: true,
        gender: kid.gender,
        interests: kid.interests || [],
    };
}

async function updateKid(kidId, data) {
    const updates = {};
    if (data.name) updates.name = data.name;
    if (data.nickname) updates.nickname = data.nickname;
    if (data.date_of_birth || data.birth_date) updates.birth_date = new Date(data.date_of_birth || data.birth_date);
    if (data.gender) updates.gender = data.gender;
    if (data.interests) updates.interests = data.interests;
    if (data.language) updates.language = data.language;
    if (data.avatar_url) updates.avatar_url = data.avatar_url;

    const kid = await prisma.kid_profile.update({
        where: { id: BigInt(kidId) },
        data: updates,
    });

    return {
        id: kid.id.toString(),
        name: kid.name,
        date_of_birth: kid.birth_date,
        birth_date: kid.birth_date,
        age: ageFromBirthDate(kid.birth_date),
        is_active: true,
        isActive: true,
        gender: kid.gender,
        interests: kid.interests || [],
    };
}

async function deleteKid(firebaseUid, kidId) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    // Verify kid belongs to this user
    const kid = await prisma.kid_profile.findFirst({
        where: { id: BigInt(kidId), user_id: user.id },
    });
    if (!kid) throw new Error('Kid profile not found');

    await prisma.kid_profile.delete({ where: { id: BigInt(kidId) } });
    return { success: true };
}

// ─── RPC Replacements ───────────────────────────────────────────────────────

async function checkEmailExists(email) {
    const user = await prisma.sys_user.findUnique({
        where: { email },
    });
    return { exists: !!user };
}

async function deleteUserAccount(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    // Delete all user references (Cascade should handle most if set up, but doing it explicitly for safety)
    await prisma.$transaction([
        prisma.kid_profile.deleteMany({ where: { user_id: user.id } }),
        prisma.parent_profile.deleteMany({ where: { user_id: user.id } }),
        prisma.ai_device.deleteMany({ where: { user_id: user.id } }),
        prisma.sys_user.delete({ where: { id: user.id } })
    ]);

    return { success: true, user_id: firebaseUid, deleted_at: new Date().toISOString() };
}

async function getHomepageActivity(firebaseUid, options = {}) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: { id: true },
    });
    if (!user) throw new Error('User not found');

    const devices = await prisma.ai_device.findMany({
        where: { user_id: user.id },
        select: { mac_address: true },
    });
    const macAddresses = (devices || []).map(device => device.mac_address).filter(Boolean);
    const ownershipFilters = [
        { user_id: user.id },
    ];
    if (macAddresses.length > 0) {
        ownershipFilters.push({ mac_address: { in: macAddresses } });
    }
    const ownedWhere = { OR: ownershipFilters };
    const { start, end } = getDayRange(options.now || new Date());

    const todayToyAnalyticsPromise = macAddresses.length > 0
        ? prisma.device_analytics_event.findMany({
            where: {
                mac_address: { in: macAddresses },
                server_received_at: {
                    gte: start,
                    lte: end,
                },
            },
            select: {
                event_name: true,
                duration_ms: true,
            },
        })
        : Promise.resolve([]);

    const [recentCardTap, todayToyAnalytics] = await Promise.all([
        prisma.rfid_card_tap_log.findFirst({
            where: ownedWhere,
            orderBy: { created_at: 'desc' },
        }),
        todayToyAnalyticsPromise,
    ]);
    const usageTimeSeconds = Math.floor((todayToyAnalytics || []).reduce((sum, event) => (
        sum + positiveDurationMs(event.duration_ms)
    ), 0) / 1000);
    const gamesPlayed = (todayToyAnalytics || []).filter(event => event.event_name === 'game_start').length;
    const todayCardTapCount = (todayToyAnalytics || []).filter(event => event.event_name === 'card_session_start').length;
    const todayAiInteractionCount = (todayToyAnalytics || []).filter(event => event.event_name === 'ai_talk_start').length;

    return {
        today_progress: {
            date: formatLocalDate(start),
            card_tap_count: todayCardTapCount || 0,
            cardTapCount: todayCardTapCount || 0,
            ai_interaction_count: todayAiInteractionCount || 0,
            aiInteractionCount: todayAiInteractionCount || 0,
            usage_time_seconds: usageTimeSeconds,
            usageTimeSeconds,
            games_played: gamesPlayed,
            gamesPlayed,
        },
        todayProgress: {
            date: formatLocalDate(start),
            cardTapCount: todayCardTapCount || 0,
            aiInteractionCount: todayAiInteractionCount || 0,
            usageTimeSeconds,
            gamesPlayed,
        },
        recent_activity: formatRecentCardActivity(recentCardTap),
        recentActivity: formatRecentCardActivity(recentCardTap),
    };
}

async function getHomepageActivityDetails(firebaseUid, options = {}) {
    const metric = String(options.metric || '').trim().toLowerCase();
    const period = String(options.period || '').trim().toLowerCase();
    if (!['games', 'usage', 'cards'].includes(metric)) {
        throw new ApiError('metric must be one of: games, usage, cards', 400, 400);
    }
    if (!['week', 'month'].includes(period)) {
        throw new ApiError('period must be one of: week, month', 400, 400);
    }

    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: { id: true },
    });
    if (!user) throw new ApiError('Access denied', 403, 403);

    const devices = await prisma.ai_device.findMany({
        where: { user_id: user.id },
        select: { id: true, mac_address: true },
    });
    const ownedMacAddresses = (devices || [])
        .map(device => normalizeMacAddress(device.mac_address) || device.mac_address)
        .filter(Boolean);
    const requestedMac = normalizeMacAddress(options.mac || options.mac_address || options.macAddress);
    let macAddresses = ownedMacAddresses;
    if (options.mac || options.mac_address || options.macAddress) {
        if (!requestedMac || !ownedMacAddresses.includes(requestedMac)) {
            throw new ApiError('Device not found', 404, 404);
        }
        macAddresses = [requestedMac];
    }

    if (macAddresses.length === 0) {
        return metric === 'usage'
            ? toDurationResponse(period, new Map())
            : toCountResponse(metric, period, new Map());
    }

    const { start, end } = getActivityDetailsRange(period, options.now || new Date());
    const events = await prisma.device_analytics_event.findMany({
        where: {
            mac_address: { in: macAddresses },
            server_received_at: {
                gte: start,
                lte: end,
            }
        },
        select: {
            event_name: true,
            duration_ms: true,
            rfid_uid: true,
            content_id: true,
            content_type: true,
            game_id: true,
            station: true,
            data: true,
        },
        orderBy: { server_received_at: 'asc' },
        take: 5000,
    });

    if (metric === 'games') {
        const grouped = new Map();
        for (const event of events || []) {
            if (event.event_name !== 'game_start') continue;
            const { key, name } = resolveGameKeyAndName(event);
            incrementCount(grouped, key, name);
        }
        return toCountResponse('games', period, grouped);
    }

    if (metric === 'cards') {
        const grouped = new Map();
        const rawCardNames = new Map();
        for (const event of events || []) {
            if (event.event_name !== 'card_session_start') continue;
            const { key, name } = resolveCardKeyAndName(event);
            rawCardNames.set(key, name);
            incrementCount(grouped, key, name);
        }
        const cardNameMap = await getCardNameMap(Array.from(grouped.keys()));
        for (const [key, item] of grouped.entries()) {
            item.name = cardNameMap.get(key) || rawCardNames.get(key) || item.name;
        }
        return toCountResponse('cards', period, grouped);
    }

    const grouped = new Map();
    const rawCardNames = new Map();
    const cardKeys = new Set();
    for (const event of events || []) {
        const durationMs = positiveDurationMs(event.duration_ms);
        if (durationMs <= 0) continue;
        const { key, name } = resolveUsageKeyAndName(event);
        if (event.rfid_uid || safeObject(event.data).rfid_uid || safeObject(event.data).card_uid || safeObject(event.data).card_id) {
            cardKeys.add(key);
            rawCardNames.set(key, name);
        }
        incrementDuration(grouped, key, name, durationMs);
    }
    const cardNameMap = await getCardNameMap(Array.from(cardKeys));
    for (const [key, item] of grouped.entries()) {
        if (cardNameMap.has(key)) {
            item.name = cardNameMap.get(key);
        } else if (rawCardNames.has(key)) {
            item.name = rawCardNames.get(key);
        }
    }
    return toDurationResponse(period, grouped);
}

async function getHomepageRecommendations(firebaseUid, options = {}) {
    const limit = clampRecommendationLimit(options.limit);
    const kidId = options.kidId || options.kid_id;
    if (!kidId) throw new ApiError('kidId is required', 400, 400);
    const kidBigIntId = parseBigIntId(kidId, 'kidId');

    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: { id: true },
    });
    if (!user) throw new ApiError('Access denied', 403, 403);

    const kid = await prisma.kid_profile.findFirst({
        where: {
            id: kidBigIntId,
            user_id: user.id,
        },
    });
    if (!kid) throw new ApiError('Access denied', 403, 403);

    logger.info('recommendations_requested', { userId: user.id?.toString(), kidId: kid.id?.toString(), limit });

    const devices = await prisma.ai_device.findMany({
        where: {
            user_id: user.id,
            OR: [
                { kid_id: kid.id },
                { kid_id: null },
            ],
        },
        select: { mac_address: true, agent_id: true, kid_id: true },
    });
    const macAddresses = (devices || []).map(device => device.mac_address).filter(Boolean);
    const agentIds = (devices || []).map(device => device.agent_id).filter(Boolean);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activityOwnership = [
        { kid_id: kid.id },
        { user_id: user.id },
    ];
    if (macAddresses.length > 0) {
        activityOwnership.push({ mac_address: { in: macAddresses } });
    }

    const [cardTaps, sessions, mediaPlayback, chatHistory, contentCandidates] = await Promise.all([
        prisma.rfid_card_tap_log.findMany({
            where: {
                OR: activityOwnership,
                created_at: { gte: since },
            },
            orderBy: { created_at: 'desc' },
            take: 20,
        }),
        macAddresses.length > 0
            ? prisma.analytics_game_sessions.findMany({
                where: {
                    mac_address: { in: macAddresses },
                    started_at: { gte: since },
                },
                orderBy: { started_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        macAddresses.length > 0
            ? prisma.analytics_media_playback.findMany({
                where: {
                    mac_address: { in: macAddresses },
                    created_at: { gte: since },
                },
                orderBy: { created_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        (macAddresses.length > 0 || agentIds.length > 0)
            ? prisma.ai_agent_chat_history.findMany({
                where: {
                    chat_type: 1,
                    OR: [
                        ...(macAddresses.length > 0 ? [{ mac_address: { in: macAddresses } }] : []),
                        ...(agentIds.length > 0 ? [{ agent_id: { in: agentIds } }] : []),
                    ],
                    created_at: { gte: since },
                },
                orderBy: { created_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        prisma.rfid_content_pack.findMany({
            where: { active: true },
            orderBy: { create_date: 'desc' },
            take: Math.max(limit * 8, 50),
        }),
    ]);

    const profile = buildRecentSignals({ kid, cardTaps, sessions, mediaPlayback });
    if ((chatHistory || []).length > 0) {
        profile.recentModes.add('conversation');
    }

    const hasRecentActivity = Boolean(
        (cardTaps || []).length ||
        (sessions || []).length ||
        (mediaPlayback || []).length ||
        (chatHistory || []).length
    );
    const hasProfilePreferences = hasSignals(
        profile.preferredCategories,
        profile.preferredContentTypes,
        profile.preferredAiModes
    );
    const recommendationSource = hasRecentActivity
        ? 'personalized'
        : (hasProfilePreferences ? 'profile' : 'default');

    const scoredContent = (contentCandidates || [])
        .filter(content => content && content.active !== false && content.status !== 'inactive')
        .map(content => {
            const scored = scoreContent(content, profile);
            return {
                ...formatRecommendationContent(content, scored.reason),
                _score: scored.score,
                _createdAt: (content.created_at || content.create_date) ? new Date(content.created_at || content.create_date).getTime() : 0,
                _recentlyConsumed: profile.recentContentIds.has(content.id?.toString()),
            };
        });

    const nonConsumedContent = scoredContent.filter(item => !item._recentlyConsumed);
    const contentPool = nonConsumedContent.length >= limit ? nonConsumedContent : scoredContent;
    const aiItems = HOMEPAGE_AI_CARDS
        .map(card => scoreAiCard(card, profile, recommendationSource))
        .filter(Boolean);

    const rankedPool = recommendationSource === 'default' && aiItems.length > 0 && limit > 1
        ? [
            ...dedupeRecommendations(contentPool.sort(sortRecommendations)).slice(0, limit - 1),
            ...dedupeRecommendations(aiItems.sort(sortRecommendations)).slice(0, 1),
        ]
        : [...contentPool, ...aiItems].sort(sortRecommendations);

    const ranked = dedupeRecommendations(rankedPool)
        .slice(0, limit)
        .map(({ _score, _createdAt, _recentlyConsumed, ...item }) => item);

    logger.info('recommendations_returned_count', {
        userId: user.id?.toString(),
        kidId: kid.id?.toString(),
        count: ranked.length,
        recommendation_source: ranked.length === 0 ? 'empty' : recommendationSource,
    });

    return {
        items: ranked,
        recommendationSource: ranked.length === 0 ? 'empty' : recommendationSource,
        source: ranked.length === 0 ? 'empty' : recommendationSource,
        generatedAt: new Date().toISOString(),
    };
}

module.exports = {
    getParentProfile,
    createParentProfile,
    updateParentProfile,
    updateFcmToken,
    clearFcmToken,
    getUserState,
    markOnboardingCompleted,
    getKids,
    createKid,
    updateKid,
    deleteKid,
    checkEmailExists,
    deleteUserAccount,
    getHomepageActivity,
    getHomepageActivityDetails,
    getHomepageRecommendations,
};
