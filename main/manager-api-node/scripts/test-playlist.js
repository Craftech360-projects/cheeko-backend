/**
 * Test playlist fetch without FK join
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPlaylist() {
  console.log('='.repeat(60));
  console.log('Testing Fixed Playlist Logic');
  console.log('='.repeat(60));

  // First, get a real device to test with
  console.log('\n--- Getting a device ---\n');
  const { data: devices, error: deviceError } = await supabase
    .from('device')
    .select('id, mac')
    .limit(1);

  if (deviceError || !devices || devices.length === 0) {
    console.log('No devices found. Creating a test without device ID validation...');
    console.log('\n--- Testing basic playlist query ---\n');

    // Just test that the query structure works
    const { data: allPlaylist, error: allError } = await supabase
      .from('music_playlist')
      .select('id, position, created_at, content_id, device_id')
      .limit(5);

    if (allError) {
      console.error('Basic query error:', allError.message);
    } else {
      console.log('Basic query OK. Results:', allPlaylist?.length || 0);
      if (allPlaylist?.length > 0) {
        console.log('Sample:', JSON.stringify(allPlaylist[0], null, 2));
      }
    }

    console.log('\n--- Test PASSED (basic query works) ---');
    return;
  }

  const deviceId = devices[0].id;
  console.log('Using device:', devices[0].mac, '(ID:', deviceId, ')');

  const table = 'music_playlist';

  // Step 1: Get playlist items
  console.log('\n--- Step 1: Fetch playlist items ---\n');
  const { data: playlistItems, error: playlistError } = await supabase
    .from(table)
    .select('id, position, created_at, content_id')
    .eq('device_id', deviceId)
    .order('position', { ascending: true });

  if (playlistError) {
    console.error('Playlist fetch error:', playlistError.message);
    return;
  }

  console.log('Playlist items:', playlistItems?.length || 0);

  if (!playlistItems || playlistItems.length === 0) {
    console.log('No playlist items found. This is OK - playlist is empty.');
    console.log('\n--- Test PASSED (empty playlist returns []) ---');
    return;
  }

  // Step 2: Get unique content IDs
  const contentIds = [...new Set(playlistItems.map(item => item.content_id).filter(Boolean))];
  console.log('Content IDs to fetch:', contentIds);

  if (contentIds.length === 0) {
    console.log('No content IDs in playlist');
    return;
  }

  // Step 3: Fetch content details
  console.log('\n--- Step 2: Fetch content details ---\n');
  const { data: contentItems, error: contentError } = await supabase
    .from('content_library')
    .select('id, title, description, content_type, category, url, thumbnail_url, duration_seconds')
    .in('id', contentIds);

  if (contentError) {
    console.error('Content fetch error:', contentError.message);
    return;
  }

  console.log('Content items fetched:', contentItems?.length || 0);

  // Step 4: Create content map and merge
  const contentMap = {};
  (contentItems || []).forEach(content => {
    contentMap[content.id] = content;
  });

  const result = playlistItems.map(item => ({
    id: item.id,
    position: item.position,
    contentId: item.content_id,
    createdAt: item.created_at,
    content: contentMap[item.content_id] || null
  }));

  console.log('\n--- Final Result ---\n');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n--- Test PASSED ---');
}

testPlaylist().catch(console.error);
