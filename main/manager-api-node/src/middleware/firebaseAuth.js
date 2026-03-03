/**
 * Firebase Auth Middleware
 *
 * Used ONLY for mobile Flutter endpoints (/toy/api/mobile/*).
 * Does NOT replace the existing auth.js which handles admin dashboard
 * custom token authentication via sys_user_token table.
 *
 * Flow:
 *   Flutter → Firebase ID token → Bearer header
 *   → verifyIdToken(token) → uid + email
 *   → look up sys_user by firebase_uid → attach to req.firebaseUser
 */

const admin = require('firebase-admin');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { unauthorized } = require('../utils/response');

// ─── Firebase Admin SDK initialisation (singleton) ────────────────────────────
if (!admin.apps.length) {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required');
    }
    admin.initializeApp({
        credential: admin.credential.cert(require('path').resolve(serviceAccountPath)),
        projectId: process.env.FIREBASE_PROJECT_ID || 'cheekoai',
    });
    logger.info('✅ Firebase Admin SDK initialised');
}

/**
 * Middleware: verify Firebase ID token sent by the Flutter app.
 *
 * On success attaches to req:
 *   req.firebaseUser  — decoded Firebase token payload (uid, email, …)
 *   req.mobileUser    — sys_user row (created if first sign-in)
 */
const requireFirebaseAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return unauthorized(res, 'Firebase ID token required');
    }

    const idToken = authHeader.substring(7);

    try {
        // 1. Verify the token with Firebase
        const decoded = await admin.auth().verifyIdToken(idToken);

        req.firebaseUser = decoded; // uid, email, name, picture …

        // 2. Find or create the corresponding sys_user record
        let mobileUser = await prisma.sys_user.findFirst({
            where: { firebase_uid: decoded.uid },
        });

        if (!mobileUser) {
            // First login — create a sys_user record for this Firebase user
            mobileUser = await prisma.sys_user.create({
                data: {
                    firebase_uid: decoded.uid,
                    email: decoded.email || '',
                    username: decoded.email || decoded.uid,
                    role: 'parent',
                    status: 1,
                },
            });
            logger.info(`🆕 Created sys_user for Firebase uid: ${decoded.uid}`);
        }

        req.mobileUser = mobileUser;
        next();
    } catch (error) {
        logger.warn('Firebase token verification failed:', error.message);
        return unauthorized(res, 'Invalid or expired Firebase token');
    }
};

module.exports = { requireFirebaseAuth };
