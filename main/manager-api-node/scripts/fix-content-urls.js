/**
 * Fix content URLs to use correct CloudFront domain and path structure
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';

async function fixUrls() {
  const { data: items, error } = await supabase
    .from('content_library')
    .select('id, title, content_type, category, metadata');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('Found', items.length, 'items to update');

  let updated = 0;
  for (const item of items) {
    const filename = item.metadata && item.metadata.filename;
    if (!filename) {
      console.log('No filename for:', item.title);
      continue;
    }

    // URL structure: music/{category}/filename or stories/{category}/filename
    const baseFolder = item.content_type === 'music' ? 'music' : 'stories';
    const category = item.category || 'English';
    const encodedFilename = encodeURIComponent(filename);
    const url = `https://${CLOUDFRONT_DOMAIN}/${baseFolder}/${category}/${encodedFilename}`;

    const { error: updateError } = await supabase
      .from('content_library')
      .update({ url: url })
      .eq('id', item.id);

    if (updateError) {
      console.log('Failed:', item.title, updateError.message);
    } else {
      updated++;
    }
  }

  console.log('\nUpdated', updated, 'items with correct URLs');

  // Show samples
  const { data: sample } = await supabase
    .from('content_library')
    .select('title, content_type, category, url')
    .limit(5);

  console.log('\nSample URLs:');
  sample.forEach(s => {
    console.log(`- ${s.title} (${s.content_type}/${s.category}):`);
    console.log(`  ${s.url}`);
  });
}

fixUrls().catch(console.error);
