
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
        // Continue anyway
    } else {
        console.log("Cleared existing schedule.");
    }

    // 2. "Every day" base schedule (day_of_week = null)
    const everyDayItems = [
        {
            start_time: '00:00:00',
            end_time: '06:00:00',
            program_name: 'Late Night Lullabies',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '06:00:00',
            end_time: '09:00:00',
            program_name: 'Morning Singalong',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '09:00:00',
            end_time: '12:00:00',
            program_name: 'Learning Hour',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '12:00:00',
            end_time: '15:00:00',
            program_name: 'Afternoon Playtime',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '15:00:00',
            end_time: '18:00:00',
            program_name: 'Story Time',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '18:00:00',
            end_time: '21:00:00',
            program_name: 'Evening Music',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        },
        {
            start_time: '21:00:00',
            end_time: '23:59:59',
            program_name: 'Bedtime Lullabies',
            playlist_id: 'English',
            day_of_week: null,
            is_active: true
        }
    ];

    // 3. Weekend specials (Saturday = 6, Sunday = 0)
    const weekendItems = [
        // Saturday specials
        {
            start_time: '10:00:00',
            end_time: '12:00:00',
            program_name: 'Saturday Fun Mix',
            playlist_id: 'English',
            day_of_week: 6, // Saturday
            is_active: true
        },
        {
            start_time: '14:00:00',
            end_time: '16:00:00',
            program_name: 'Saturday Dance Party',
            playlist_id: 'English',
            day_of_week: 6, // Saturday
            is_active: true
        },
        // Sunday specials
        {
            start_time: '10:00:00',
            end_time: '12:00:00',
            program_name: 'Sunday Story Marathon',
            playlist_id: 'English',
            day_of_week: 0, // Sunday
            is_active: true
        },
        {
            start_time: '14:00:00',
            end_time: '16:00:00',
            program_name: 'Sunday Rhyme Time',
            playlist_id: 'Hindi',
            day_of_week: 0, // Sunday
            is_active: true
        }
    ];

    const allItems = [...everyDayItems, ...weekendItems];

    const { data, error: insertError } = await supabaseAdmin
        .from('radio_schedule')
        .insert(allItems)
        .select();

    if (insertError) {
        console.error("Error inserting schedule:", insertError);
        process.exit(1);
    }

    console.log(`✅ Successfully seeded radio schedule: ${data.length} items`);
    console.log(`   - ${everyDayItems.length} every-day programs`);
    console.log(`   - ${weekendItems.length} weekend specials`);
}

seedSchedule();
