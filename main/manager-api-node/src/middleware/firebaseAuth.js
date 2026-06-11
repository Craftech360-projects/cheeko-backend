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
const { serverError, unauthorized } = require('../utils/response');

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

async function linkExistingUserToFirebaseUid(existingUser, decoded) {
    logger.info(`🔗 Linking Firebase uid ${decoded.uid} to existing sys_user email: ${existingUser.email}`);
    return prisma.sys_user.update({
        where: { id: existingUser.id },
        data: {
            firebase_uid: decoded.uid,
            username: decoded.uid,
        },
    });
}

function isUniqueEmailConstraintError(error) {
    if (error?.code !== 'P2002') return false;
    const targets = Array.isArray(error?.meta?.target) ? error.meta.target : [];
    return targets.includes('email');
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

    let decoded;
    try {
        logger.debug(`🔑 [firebaseAuth] Verifying Firebase ID token...`);
        decoded = await admin.auth().verifyIdToken(idToken);
        logger.debug(`✅ [firebaseAuth] Token verified — uid: ${decoded.uid}, email: ${decoded.email}`);
    } catch (error) {
        logger.warn(`Firebase token verification failed: ${error.message}`);
        logger.warn(`  code: ${error.code || 'n/a'} | type: ${error.constructor?.name || 'Error'}`);
        if (error.cause) logger.warn(`  cause: ${error.cause.message || error.cause}`);
        return unauthorized(res, 'Invalid or expired Firebase token');
    }

    try {
        req.firebaseUser = decoded; // uid, email, name, picture …

        logger.debug(`🔍 [firebaseAuth] Looking up sys_user for uid: ${decoded.uid}`);
        let mobileUser = await prisma.sys_user.findFirst({
            where: { firebase_uid: decoded.uid },
        });
        logger.debug(`📋 [firebaseAuth] sys_user lookup result: ${mobileUser ? `found id=${mobileUser.id}` : 'not found'}`);

        if (!mobileUser && decoded.email) {
            mobileUser = await prisma.sys_user.findFirst({
                where: { email: decoded.email },
            });

            if (mobileUser) {
                mobileUser = await linkExistingUserToFirebaseUid(mobileUser, decoded);
            }
        }

        if (!mobileUser) {
            logger.debug(`🆕 [firebaseAuth] Creating new sys_user for uid: ${decoded.uid}`);
            try {
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
            } catch (error) {
                if (!isUniqueEmailConstraintError(error) || !decoded.email) {
                    throw error;
                }

                logger.warn(`⚠️ [firebaseAuth] Email already exists during create, retrying lookup for ${decoded.email}`);
                const existingUser = await prisma.sys_user.findFirst({
                    where: { email: decoded.email },
                });
                if (!existingUser) {
                    throw error;
                }
                mobileUser = await linkExistingUserToFirebaseUid(existingUser, decoded);
            }
        }

        req.mobileUser = mobileUser;
        next();
    } catch (error) {
        logger.error(`❌ [firebaseAuth] Failed to resolve sys_user for uid ${decoded.uid}: ${error.message}`);
        logger.error(`  code: ${error.code || 'n/a'} | type: ${error.constructor?.name || 'Error'}`);
        return serverError(res, 'Failed to resolve mobile user');
    }
};

module.exports = { requireFirebaseAuth };
