/**
 * Direct Database Query - Check content_item table
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkContentItems() {
    console.log('Checking content_item table...\n');

    // 1. Check if table exists by trying to query it
    console.log('1. Querying content_item table...');
    const { data, error } = await supabase
        .from('content_item')
        .select('*')
        .limit(5);

    if (error) {
        console.error('❌ ERROR:', error.message);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);

        if (error.code === '42P01') {
            console.log('\n⚠️  Table does not exist!');
            console.log('Need to create content_item table in database.');
        }
    } else {
        console.log(`✅ Table exists! Found ${data.length} items (showing first 5)`);
        if (data.length > 0) {
            console.log('\nSample item:');
            console.log(JSON.stringify(data[0], null, 2));
        }
    }

    // 2. Check for BEDTIME_ROUTINE_FINAL pack items
    console.log('\n2. Checking items for BEDTIME_ROUTINE_FINAL...');

    // First get the pack ID
    const { data: pack } = await supabase
        .from('rfid_content_pack')
        .select('id, pack_code, name')
        .eq('pack_code', 'BEDTIME_ROUTINE_FINAL')
        .single();

    if (pack) {
        console.log(`✅ Found pack: ${pack.name} (ID: ${pack.id})`);

        // Now get items for this pack
        const { data: items, error: itemsError } = await supabase
            .from('content_item')
            .select('*')
            .eq('content_pack_id', pack.id)
            .order('item_number', { ascending: true });

        if (itemsError) {
            console.error('❌ Error fetching items:', itemsError.message);
        } else {
            console.log(`✅ Found ${items.length} items for this pack`);
            if (items.length > 0) {
                console.log('\nFirst 3 items:');
                items.slice(0, 3).forEach(item => {
                    console.log(`  - Item ${item.item_number}: ${item.title}`);
                    console.log(`    Audio: ${item.audio_url ? item.audio_url.substring(0, 50) + '...' : 'N/A'}`);
                    console.log(`    Image: ${item.image_url ? item.image_url.substring(0, 50) + '...' : 'N/A'}`);
                });
            }
        }
    } else {
        console.log('❌ Pack not found');
    }
}

checkContentItems().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
