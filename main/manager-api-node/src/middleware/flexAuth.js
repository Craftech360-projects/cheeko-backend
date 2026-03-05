/**
 * Flexible Auth Middleware
 *
 * Accepts EITHER a Firebase ID token (mobile app) OR a custom JWT (web admin dashboard).
 *
 * Mobile flow:  Flutter → Firebase ID token → Bearer header → verifyIdToken → req.mobileUser + req.user
 * Admin flow:   Web app → custom token → Bearer header → sys_user_token lookup → req.user
 *
 * Used for routes that need to serve both mobile and admin clients
 * (e.g. analytics endpoints).
 */

const admin = require('firebase-admin');
const { verifyCustomToken } = require('./auth');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { unauthorized } = require('../utils/response');

/**
 * Middleware: accept Firebase ID token OR custom JWT token.
 *
 * On success always sets req.user (compatible with requireAuth consumers).
 * For Firebase tokens also sets req.firebaseUser and req.mobileUser.
 */
const requireFlexAuth = async (req, res, next) => {
    // Accept Service Key as god mode (same as requireAuth/requireAdmin)
    const serviceKey = req.headers['x-service-key'];
    const SERVICE_SECRET_KEY = process.env.SERVICE_SECRET_KEY;
    if (serviceKey && SERVICE_SECRET_KEY && serviceKey === SERVICE_SECRET_KEY) {
        req.isServiceAuth = true;
        req.user = { id: 0, role: 'admin', super_admin: 1, email: 'service@internal' };
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return unauthorized(res, 'No authorization token provided');
    }

    const token = authHeader.substring(7);

    // ── 1. Try Firebase verification (if SDK is initialised) ──────────────────
    if (admin.apps.length > 0) {
        try {
            const decoded = await admin.auth().verifyIdToken(token);

            // Find or create the sys_user for this Firebase uid
            let mobileUser = await prisma.sys_user.findFirst({
                where: { firebase_uid: decoded.uid },
            });
            if (!mobileUser) {
                mobileUser = await prisma.sys_user.create({
                    data: {
                        firebase_uid: decoded.uid,
                        email: decoded.email || '',
                        username: decoded.email || decoded.uid,
                        role: 'parent',
                        status: 1,
                    },
                });
            }

            req.firebaseUser = decoded;
            req.mobileUser = mobileUser;
            // Normalise to req.user so downstream handlers work unchanged
            req.user = {
                id: mobileUser.id,
                username: mobileUser.username,
                email: mobileUser.email,
                role: mobileUser.role,
                super_admin: 0,
            };
            return next();
        } catch (firebaseError) {
            // Not a valid Firebase token — fall through to custom JWT check
            logger.debug(`flexAuth: Firebase check skipped (${firebaseError.code}), trying custom JWT`);
        }
    }

    // ── 2. Fall back to custom JWT (web admin dashboard) ─────────────────────
    const user = await verifyCustomToken(token);
    if (user) {
        req.user = user;
        req.token = token;
        return next();
    }

    return unauthorized(res, 'Invalid or expired token');
};

module.exports = { requireFlexAuth };
