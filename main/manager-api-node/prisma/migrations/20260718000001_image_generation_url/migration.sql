-- Store where each generated image landed, not just that it happened.
ALTER TABLE "device_image_generations"
  ADD COLUMN IF NOT EXISTS "url" TEXT;
