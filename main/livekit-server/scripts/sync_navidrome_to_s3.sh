#!/bin/bash
# =============================================================================
# Navidrome to S3 Sync Script
# =============================================================================
# Syncs audio files from Navidrome music folder to S3 for CloudFront delivery.
# NOTE: Only ADDS new files to S3, never deletes from S3 (safe sync).
#
# Usage:
#   ./sync_navidrome_to_s3.sh
#
# Cron setup (every 10 minutes):
#   */10 * * * * /path/to/scripts/sync_navidrome_to_s3.sh
# =============================================================================

# Configuration
MUSIC_FOLDER="${NAVIDROME_MUSIC_FOLDER:-/home/cheeko/livekit-server/navidrome_music}"
S3_BUCKET="${S3_BUCKET_NAME:-cheeko-audio-files}"
S3_PREFIX="audio"
LOG_FILE="${LOG_FILE:-/var/log/cheeko/s3-sync.log}"
AWS_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Log function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" >> "$LOG_FILE"
}

log "=========================================="
log "Starting S3 sync..."
log "Source: $MUSIC_FOLDER"
log "Destination: s3://$S3_BUCKET/$S3_PREFIX"

# Check if source folder exists
if [ ! -d "$MUSIC_FOLDER" ]; then
    log "ERROR: Music folder does not exist: $MUSIC_FOLDER"
    exit 1
fi

# Sync WITHOUT --delete flag (only add new files, never remove from S3)
aws s3 sync "$MUSIC_FOLDER" "s3://$S3_BUCKET/$S3_PREFIX" \
    --region "$AWS_REGION" \
    --exclude "*.DS_Store" \
    --exclude "*.db" \
    --exclude ".navidrome*" \
    --exclude "*.sqlite" \
    --exclude "Thumbs.db" \
    >> "$LOG_FILE" 2>&1

SYNC_STATUS=$?

if [ $SYNC_STATUS -eq 0 ]; then
    log "S3 sync completed successfully"
else
    log "ERROR: S3 sync failed with status $SYNC_STATUS"
fi

# Optional: Invalidate CloudFront cache (uncomment if needed)
# DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
# if [ -n "$DISTRIBUTION_ID" ]; then
#     log "Invalidating CloudFront cache..."
#     aws cloudfront create-invalidation \
#         --distribution-id "$DISTRIBUTION_ID" \
#         --paths "/$S3_PREFIX/*" \
#         >> "$LOG_FILE" 2>&1
#     log "CloudFront invalidation requested"
# fi

log "Sync process finished"
log "=========================================="

exit $SYNC_STATUS
