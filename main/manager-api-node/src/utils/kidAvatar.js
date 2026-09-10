/**
 * A kid's real photo is only ever minted by POST /api/mobile/kids/:id/avatar,
 * which stores it under kids/avatars/ on our CloudFront. avatar_url is also
 * client-writable (PUT /kids/:id, the admin and legacy kid routes), and a
 * stock-photo URL pasted there showed up as a child's photo. Anything outside
 * our own prefix is therefore not the child's photo: writes drop it and reads
 * hide it.
 *
 * Kept free of service imports so the services can share it without pulling in
 * the S3 client (several unit tests mock upload.service as an empty object).
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';
const KID_AVATAR_PREFIX = `https://${CLOUDFRONT_DOMAIN}/kids/avatars/`;

function isKidAvatarUrl(url) {
  return typeof url === 'string' && url.startsWith(KID_AVATAR_PREFIX) && !url.includes('..');
}

/** For responses: the stored URL if it is one we uploaded, otherwise null. */
function kidAvatarOrNull(url) {
  return isKidAvatarUrl(url) ? url : null;
}

module.exports = { KID_AVATAR_PREFIX, isKidAvatarUrl, kidAvatarOrNull };
