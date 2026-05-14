const { prisma } = require('../config/database');
const logger = require('../utils/logger');

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
        select: { mac_address: true, agent_id: true },
    });
    const macAddresses = (devices || []).map(device => device.mac_address).filter(Boolean);
    const agentIds = (devices || []).map(device => device.agent_id).filter(Boolean);
    const ownershipFilters = [
        { user_id: user.id },
    ];
    if (macAddresses.length > 0) {
        ownershipFilters.push({ mac_address: { in: macAddresses } });
    }
    const ownedWhere = { OR: ownershipFilters };
    const chatOwnershipFilters = [];
    if (macAddresses.length > 0) {
        chatOwnershipFilters.push({ mac_address: { in: macAddresses } });
    }
    if (agentIds.length > 0) {
        chatOwnershipFilters.push({ agent_id: { in: agentIds } });
    }
    const { start, end } = getDayRange(options.now || new Date());

    const [todayCardTapCount, todayAiInteractionCount, recentCardTap] = await Promise.all([
        prisma.rfid_card_tap_log.count({
            where: {
                ...ownedWhere,
                created_at: {
                    gte: start,
                    lte: end,
                },
            },
        }),
        chatOwnershipFilters.length > 0
            ? prisma.ai_agent_chat_history.count({
                where: {
                    chat_type: 1,
                    OR: chatOwnershipFilters,
                    created_at: {
                        gte: start,
                        lte: end,
                    },
                },
            })
            : Promise.resolve(0),
        prisma.rfid_card_tap_log.findFirst({
            where: ownedWhere,
            orderBy: { created_at: 'desc' },
        }),
    ]);

    return {
        today_progress: {
            date: formatLocalDate(start),
            card_tap_count: todayCardTapCount || 0,
            cardTapCount: todayCardTapCount || 0,
            ai_interaction_count: todayAiInteractionCount || 0,
            aiInteractionCount: todayAiInteractionCount || 0,
        },
        todayProgress: {
            date: formatLocalDate(start),
            cardTapCount: todayCardTapCount || 0,
            aiInteractionCount: todayAiInteractionCount || 0,
        },
        recent_activity: formatRecentCardActivity(recentCardTap),
        recentActivity: formatRecentCardActivity(recentCardTap),
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
};
