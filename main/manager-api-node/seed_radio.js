
require('dotenv').config();
const { supabaseAdmin } = require('./src/config/database');
const logger = require('./src/utils/logger'); // Assuming logger exists

async function seedSchedule() {
    console.log("Starting radio schedule seed...");

    if (!supabaseAdmin) {
        console.error("Supabase Admin not initialized. Check .env");
        process.exit(1);
    }

    // 1. Clear existing schedule
    const { error: deleteError } = await supabaseAdmin
        .from('radio_schedule')
        .delete()
        .neq('id', 0); // Delete all rows where id != 0 (supa delete needs where)

    if (deleteError) {
        console.error("Error clearing schedule:", deleteError);
        // Continue anyway? treating as empty or might have constraints
    } else {
        console.log("Cleared existing schedule.");
    }

    // 2. Insert new schedule
    const scheduleItems = [
        {
            start_time: '00:00:00',
            end_time: '08:00:00',
            program_name: 'Morning Singalong',
            playlist_id: 'English',
            is_active: true
        },
        {
            start_time: '08:00:00',
            end_time: '16:00:00',
            program_name: 'Afternoon Playtime',
            playlist_id: 'English',
            is_active: true
        },
        {
            start_time: '16:00:00',
            end_time: '23:59:59',
            program_name: 'Bedtime Lullabies',
            playlist_id: 'English',
            is_active: true
        }
    ];

    const { data, error: insertError } = await supabaseAdmin
        .from('radio_schedule')
        .insert(scheduleItems)
        .select();

    if (insertError) {
        console.error("Error inserting schedule:", insertError);
        process.exit(1);
    }

    console.log("✅ Successfully seeded radio schedule:", data);
}

seedSchedule();
