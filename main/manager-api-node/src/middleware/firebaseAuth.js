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

// ─── Firebase Admin SDK initialisation (lazy singleton) ───────────────────────
let firebaseInitialized = false;

function ensureFirebaseInit() {
    if (firebaseInitialized || admin.apps.length) {
        firebaseInitialized = true;
        return true;
    }
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
        logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set — Firebase auth unavailable');
        return false;
    }
    try {
        admin.initializeApp({
            credential: admin.credential.cert(require('path').resolve(serviceAccountPath)),
            projectId: process.env.FIREBASE_PROJECT_ID || 'cheekoai',
        });
        logger.info('✅ Firebase Admin SDK initialised');
        firebaseInitialized = true;
        return true;
    } catch (err) {
        logger.error('Firebase Admin SDK initialisation failed:', err.message);
        return false;
    }
}

/**
 * Middleware: verify Firebase ID token sent by the Flutter app.
 *
 * On success attaches to req:
 *   req.firebaseUser  — decoded Firebase token payload (uid, email, …)
 *   req.mobileUser    — sys_user row (created if first sign-in)
 */
const requireFirebaseAuth = async (req, res, next) => {
    if (!ensureFirebaseInit()) {
        return unauthorized(res, 'Firebase authentication not configured');
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return unauthorized(res, 'Firebase ID token required');
    }

    const idToken = authHeader.substring(7);

    try {
        // 1. Verify the token with Firebase
        logger.debug(`🔑 [firebaseAuth] Verifying Firebase ID token...`);
        const decoded = await admin.auth().verifyIdToken(idToken);
        logger.debug(`✅ [firebaseAuth] Token verified — uid: ${decoded.uid}, email: ${decoded.email}`);

        req.firebaseUser = decoded; // uid, email, name, picture …

        // 2. Find or create the corresponding sys_user record
        logger.debug(`🔍 [firebaseAuth] Looking up sys_user for uid: ${decoded.uid}`);
        let mobileUser = await prisma.sys_user.findFirst({
            where: { firebase_uid: decoded.uid },
        });
        logger.debug(`📋 [firebaseAuth] sys_user lookup result: ${mobileUser ? `found id=${mobileUser.id}` : 'not found'}`);

        if (!mobileUser) {
            if (decoded.email) {
                mobileUser = await prisma.sys_user.findFirst({
                    where: { email: decoded.email },
                });

                if (mobileUser) {
                    logger.info(`🔗 Linking Firebase uid ${decoded.uid} to existing sys_user email: ${decoded.email}`);
                    mobileUser = await prisma.sys_user.update({
                        where: { id: mobileUser.id },
                        data: {
                            firebase_uid: decoded.uid,
                            username: decoded.uid,
                        },
                    });
                }
            }
        }

        if (!mobileUser) {
            // First login — create a sys_user record for this Firebase user
            logger.debug(`🆕 [firebaseAuth] Creating new sys_user for uid: ${decoded.uid}`);
            mobileUser = await prisma.sys_user.create({
                data: {
                    firebase_uid: decoded.uid,
                    email: decoded.email || null,
                    username: decoded.uid,
                    role: 'parent',
                    status: 1,
                },
            });
            logger.info(`🆕 Created sys_user for Firebase uid: ${decoded.uid}`);
        }

        req.mobileUser = mobileUser;
        next();
    } catch (error) {
        logger.warn(`Firebase token verification failed: ${error.message}`);
        logger.warn(`  code: ${error.code || 'n/a'} | type: ${error.constructor?.name || 'Error'}`);
        if (error.cause) logger.warn(`  cause: ${error.cause.message || error.cause}`);
        return unauthorized(res, 'Invalid or expired Firebase token');
    }
};

module.exports = { requireFirebaseAuth };
