const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');
const winston = require('winston');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()],
});

// Initialize Supabase (read-only for export)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    logger.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// Initialize Firebase Admin
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
    logger.error('Missing FIREBASE_SERVICE_ACCOUNT_PATH in .env');
    process.exit(1);
}

try {
    const serviceAccount = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '..', serviceAccountPath), 'utf8')
    );
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
    });
    logger.info('Firebase Admin initialized.');
} catch (error) {
    logger.error('Failed to initialize Firebase Admin', { error: error.message });
    process.exit(1);
}

const batchSize = 100;

async function migrateUsers() {
    logger.info('Starting Supabase to Firebase Auth user migration...');
    let hasMore = true;
    let page = 0;
    let totalMigrated = 0;
    let totalFailed = 0;

    while (hasMore) {
        const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: batchSize,
        });

        if (error) {
            logger.error('Error fetching users from Supabase', { error });
            break;
        }

        if (!users.users || users.users.length === 0) {
            hasMore = false;
            break;
        }

        const firebaseUsersToImport = [];

        for (const sbUser of users.users) {
            if (!sbUser.email) {
                logger.warn(`Skipping user ${sbUser.id} - no email address`);
                continue;
            }

            const firebaseUserRecords = {
                uid: sbUser.id,           // PRESERVE SUPABASE UUID!
                email: sbUser.email,
                emailVerified: !!sbUser.email_confirmed_at,
                disabled: false // assuming active
            };

            // Optionally add phone number if properly formatted (Firebase requires +1234567890 format)
            if (sbUser.phone && sbUser.phone.startsWith('+')) {
                firebaseUserRecords.phoneNumber = sbUser.phone;
            }

            // Extract name if available in user metadata
            if (sbUser.user_metadata) {
                if (sbUser.user_metadata.full_name) {
                    firebaseUserRecords.displayName = sbUser.user_metadata.full_name;
                } else if (sbUser.user_metadata.name) {
                    firebaseUserRecords.displayName = sbUser.user_metadata.name;
                }
            }

            firebaseUsersToImport.push(firebaseUserRecords);
        }

        if (firebaseUsersToImport.length > 0) {
            try {
                const importResult = await admin.auth().importUsers(
                    firebaseUsersToImport.map(u => ({
                        ...u,
                        // Because we are relying on Social Auth (Google/Apple) natively on the device,
                        // we don't necessarily need to securely migrate password hashes (which is complex with Supabase bcrypt/argon2 format) 
                        // If a user tries to sign in with email/pass, they must reset password.
                    }))
                );

                totalMigrated += importResult.successCount;
                totalFailed += importResult.failureCount;

                if (importResult.failureCount > 0) {
                    logger.warn(`Batch produced ${importResult.failureCount} import errors.`);
                    importResult.errors.forEach((err) => {
                        logger.error(`Import Error index ${err.index}: ${err.error.message}`, { uid: firebaseUsersToImport[err.index]?.uid });
                    });
                }
            } catch (err) {
                logger.error('Fatal Firebase import batch error', err);
            }
        }

        logger.info(`Processed batch ${page + 1}: ${firebaseUsersToImport.length} users (Total Success: ${totalMigrated}, Total Failed: ${totalFailed})`);

        // Auth listUsers page starts from 1, but we use page as a counter
        page++;
    }

    logger.info('=============================================');
    logger.info('Migration complete!');
    logger.info(`Total Successfully Migrated: ${totalMigrated}`);
    logger.info(`Total Failures: ${totalFailed}`);
    logger.info('=============================================');
}

migrateUsers().catch(console.error);
