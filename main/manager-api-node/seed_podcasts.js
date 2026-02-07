
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('./src/config/database');
const { uploadContentFile } = require('./src/services/upload.service');

const PODCAST_DIR = path.join(__dirname, '..', 'podcast');

function cleanTitle(filename) {
  return filename
    .replace(/\.mp3$/i, '')
    .replace(/_/g, ' ')
    .replace(/REV\s*\d+/gi, '')
    .replace(/aup3/gi, '')
    .replace(/COMPLETE/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function seedPodcasts() {
  const scheduleOnly = process.argv.includes('--schedule-only');
  console.log('=== Podcast Upload & Schedule Seed ===\n');

  if (!supabaseAdmin) {
    console.error('Supabase Admin not initialized. Check .env');
    process.exit(1);
  }

  let podcastEntries = [];

  if (scheduleOnly) {
    // Fetch existing podcasts from content_library
    console.log('--schedule-only: Skipping upload, fetching existing podcasts from DB...\n');
    const { data, error } = await supabaseAdmin
      .from('content_library')
      .select('*')
      .eq('content_type', 'podcast')
      .eq('status', 1)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      console.error('No podcasts found in content_library. Run without --schedule-only first.');
      process.exit(1);
    }
    podcastEntries = data;
    console.log(`Found ${podcastEntries.length} existing podcasts\n`);
  } else {
    // 1. Read all mp3 files
    const files = fs.readdirSync(PODCAST_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));
    console.log(`Found ${files.length} podcast files\n`);

    // 2. Upload each to S3 and create content_library entries
    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      const filePath = path.join(PODCAST_DIR, filename);
      const title = cleanTitle(filename);
      const buffer = fs.readFileSync(filePath);

      console.log(`[${i + 1}/${files.length}] Uploading: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);

      try {
        const uploadResult = await uploadContentFile(buffer, filename, 'podcast', 'English', 'audio/mpeg');
        console.log(`  -> ${uploadResult.url}`);

        // Insert into content_library
        const { data: item, error } = await supabaseAdmin
          .from('content_library')
          .insert({
            title,
            content_type: 'podcast',
            category: 'English',
            url: uploadResult.url,
            metadata: { filename: uploadResult.filename, s3Key: uploadResult.s3Key },
            status: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error(`  ERROR creating library entry: ${error.message}`);
        } else {
          podcastEntries.push(item);
          console.log(`  -> Library entry created (id: ${item.id})`);
        }
      } catch (err) {
        console.error(`  ERROR uploading ${filename}: ${err.message}`);
      }
    }

    console.log(`\nUploaded ${podcastEntries.length}/${files.length} podcasts\n`);
  }

  if (podcastEntries.length === 0) {
    console.error('No podcasts available, skipping schedule creation.');
    process.exit(1);
  }

  // 3. Clear existing schedule
  const { error: deleteError } = await supabaseAdmin
    .from('radio_schedule')
    .delete()
    .neq('id', 0);

  if (deleteError) {
    console.error('Error clearing schedule:', deleteError.message);
  } else {
    console.log('Cleared existing radio schedule.\n');
  }

  // 4. Create schedule for all 7 days using podcast CDN URLs
  // Distribute podcasts across time slots and days
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Time slots for each day
  const timeSlots = [
    { start: '06:00:00', end: '09:00:00', label: 'Morning' },
    { start: '09:00:00', end: '12:00:00', label: 'Mid-Morning' },
    { start: '12:00:00', end: '15:00:00', label: 'Afternoon' },
    { start: '15:00:00', end: '18:00:00', label: 'Late Afternoon' },
    { start: '18:00:00', end: '21:00:00', label: 'Evening' },
    { start: '21:00:00', end: '23:59:59', label: 'Night' },
  ];

  // For off-hours, use a playlist fallback
  const fallbackSlots = [
    { start: '00:00:00', end: '06:00:00', label: 'Late Night Lullabies', playlist: 'English' },
  ];

  const scheduleItems = [];
  let podcastIndex = 0;

  for (let day = 0; day < 7; day++) {
    // Late night fallback slot (playlist-based)
    for (const slot of fallbackSlots) {
      scheduleItems.push({
        program_name: `${slot.label}`,
        start_time: slot.start,
        end_time: slot.end,
        playlist_id: slot.playlist,
        stream_url: null,
        day_of_week: day,
        is_active: true
      });
    }

    // Podcast slots — rotate through all podcasts
    for (const slot of timeSlots) {
      const podcast = podcastEntries[podcastIndex % podcastEntries.length];
      scheduleItems.push({
        program_name: `${slot.label}: ${podcast.title}`,
        start_time: slot.start,
        end_time: slot.end,
        playlist_id: null,
        stream_url: podcast.url,
        day_of_week: day,
        is_active: true
      });
      podcastIndex++;
    }
  }

  // Insert in batches (Supabase has limits)
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('radio_schedule')
    .insert(scheduleItems)
    .select();

  if (insertError) {
    console.error('Error inserting schedule:', insertError.message);
    process.exit(1);
  }

  console.log(`Created ${inserted.length} schedule entries across 7 days:`);
  for (let day = 0; day < 7; day++) {
    const dayItems = inserted.filter(i => i.day_of_week === day);
    const podcastSlots = dayItems.filter(i => i.stream_url);
    console.log(`  ${dayNames[day]}: ${dayItems.length} slots (${podcastSlots.length} podcasts with CDN URLs)`);
  }

  console.log('\nDone!');
}

seedPodcasts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
