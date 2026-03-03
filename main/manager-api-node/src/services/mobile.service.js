const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// ─── Parent Profile ─────────────────────────────────────────────────────────

async function getParentProfile(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { parent_profile: true },
    });
    return user?.parent_profile || null;
}

async function createParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    return prisma.parent_profile.create({
        data: {
            user_id: user.id,
            email: user.email,
            display_name: data.parent_name || data.fullName,
            phone_number: data.phone_number,
            language: data.preferred_language,
            timezone: data.timezone,
            onboarding_completed: false,
        },
    });
}

async function updateParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const updates = {};
    if (data.parent_name) updates.display_name = data.parent_name;
    if (data.phone_number) updates.phone_number = data.phone_number;
    if (data.preferred_language) updates.language = data.preferred_language;
    if (data.timezone) updates.timezone = data.timezone;
    if (data.onboarding_completed !== undefined) updates.onboarding_completed = data.onboarding_completed;

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            ...updates,
        },
        update: updates,
    });
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

    // Map to the format the mobile app expects (supbase kids table format)
    return user.kid_profile.map(k => ({
        id: k.id.toString(),
        parent_id: user.firebase_uid,
        name: k.name,
        nickname: k.nickname,
        avatar_url: k.avatar_url,
        birth_date: k.birth_date,
        gender: k.gender,
        language: k.language,
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
            birth_date: data.birth_date ? new Date(data.birth_date) : null,
            gender: data.gender,
            language: data.language || 'en',
        },
    });

    return {
        id: kid.id.toString(),
        parent_id: user.firebase_uid,
        name: kid.name,
        nickname: kid.nickname,
        birth_date: kid.birth_date,
        gender: kid.gender,
    };
}

async function updateKid(kidId, data) {
    const updates = {};
    if (data.name) updates.name = data.name;
    if (data.nickname) updates.nickname = data.nickname;
    if (data.birth_date) updates.birth_date = new Date(data.birth_date);
    if (data.gender) updates.gender = data.gender;
    if (data.language) updates.language = data.language;
    if (data.avatar_url) updates.avatar_url = data.avatar_url;

    const kid = await prisma.kid_profile.update({
        where: { id: BigInt(kidId) },
        data: updates,
    });

    return { id: kid.id.toString(), name: kid.name };
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

module.exports = {
    getParentProfile,
    createParentProfile,
    updateParentProfile,
    getUserState,
    markOnboardingCompleted,
    getKids,
    createKid,
    updateKid,
    checkEmailExists,
    deleteUserAccount,
};
