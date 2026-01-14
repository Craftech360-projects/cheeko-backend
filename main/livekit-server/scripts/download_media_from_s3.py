#!/usr/bin/env python3
"""
S3 Media Download Script
Downloads all media files from S3 bucket to local storage
"""
import os
import sys
from pathlib import Path
import boto3
from botocore.exceptions import ClientError
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# AWS Configuration (from .env)
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "AKIAXKPUZWFKJ7NHSSWW")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "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")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "cheeko-audio-files")

# Local storage path
LOCAL_MEDIA_DIR = Path("local_media")


def download_s3_folder(bucket_name: str, s3_folder: str, local_dir: Path):
    """
    Download entire S3 folder to local directory

    Args:
        bucket_name: S3 bucket name
        s3_folder: S3 folder prefix (e.g., 'music/', 'stories/')
        local_dir: Local directory to save files
    """
    logger.info(f"Downloading from s3://{bucket_name}/{s3_folder} to {local_dir}")

    # Create S3 client
    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
    except Exception as e:
        logger.error(f"Failed to create S3 client: {e}")
        return 0

    # Create local directory
    local_dir.mkdir(parents=True, exist_ok=True)

    # List all objects in S3 folder
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix=s3_folder)

        file_count = 0
        total_size = 0

        for page in pages:
            if 'Contents' not in page:
                logger.warning(f"No files found in s3://{bucket_name}/{s3_folder}")
                return 0

            for obj in page['Contents']:
                s3_key = obj['Key']
                size = obj['Size']

                # Skip if it's a folder marker
                if s3_key.endswith('/'):
                    continue

                # Calculate local file path
                relative_path = s3_key[len(s3_folder):]  # Remove prefix
                local_file = local_dir / relative_path

                # Create parent directories
                local_file.parent.mkdir(parents=True, exist_ok=True)

                # Check if file already exists
                if local_file.exists() and local_file.stat().st_size == size:
                    logger.debug(f"Skipping {s3_key} (already exists)")
                    file_count += 1
                    total_size += size
                    continue

                # Download file
                try:
                    logger.info(f"Downloading: {s3_key} ({size / 1024 / 1024:.2f} MB)")
                    s3_client.download_file(bucket_name, s3_key, str(local_file))
                    file_count += 1
                    total_size += size
                except ClientError as e:
                    logger.error(f"Error downloading {s3_key}: {e}")
                    continue

        logger.info(
            f"✅ Downloaded {file_count} files "
            f"({total_size / 1024 / 1024:.2f} MB) from {s3_folder}"
        )
        return file_count

    except ClientError as e:
        logger.error(f"Error accessing S3 bucket: {e}")
        return 0


def verify_aws_credentials():
    """Verify AWS credentials are valid"""
    logger.info("Verifying AWS credentials...")

    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )

        # Try to list buckets
        s3_client.list_buckets()
        logger.info("✅ AWS credentials are valid")
        return True

    except ClientError as e:
        logger.error(f"❌ Invalid AWS credentials: {e}")
        return False


def main():
    """Main download function"""
    logger.info("=" * 60)
    logger.info("S3 Media Download Tool")
    logger.info("=" * 60)

    # Verify credentials
    if not verify_aws_credentials():
        logger.error("Please check your AWS credentials in .env file")
        sys.exit(1)

    # Folders to download
    folders_to_download = {
        "music/": LOCAL_MEDIA_DIR / "music",
        "stories/": LOCAL_MEDIA_DIR / "stories",
        # Add more folders as needed
        # "images/": LOCAL_MEDIA_DIR / "images",
    }

    total_files = 0

    # Download each folder
    for s3_folder, local_dir in folders_to_download.items():
        logger.info("")
        logger.info("-" * 60)
        count = download_s3_folder(S3_BUCKET, s3_folder, local_dir)
        total_files += count

    logger.info("")
    logger.info("=" * 60)
    logger.info(f"✅ Download Complete!")
    logger.info(f"Total files downloaded: {total_files}")
    logger.info(f"Local media directory: {LOCAL_MEDIA_DIR.absolute()}")
    logger.info("=" * 60)
    logger.info("")
    logger.info("Next steps:")
    logger.info("1. Start the media server:")
    logger.info("   docker-compose up -d media-server")
    logger.info("2. Update .env to use local media:")
    logger.info("   USE_CDN=false")
    logger.info("   LOCAL_MEDIA_URL=http://192.168.1.99:8080")
    logger.info("3. Test media playback with local files")


if __name__ == "__main__":
    main()
