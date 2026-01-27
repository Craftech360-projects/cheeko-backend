/**
 * Script to seed agent templates into Supabase database
 * Run with: node scripts/seed-templates.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generate deterministic UUIDs based on template names (so they're consistent across runs)
function generateDeterministicUUID(name) {
  const hash = crypto.createHash('sha256').update(name).digest('hex');
  // Format as UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${['8', '9', 'a', 'b'][parseInt(hash[16], 16) % 4]}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Note: Model IDs are NULL because Supabase uses UUIDs while MySQL uses string identifiers
// The model IDs can be configured later via the Template Management UI
const templates = [
  {
    id: generateDeterministicUUID('TEMPLATE_CHEEKO'),
    agent_code: 'Cheeko',
    agent_name: 'Cheeko',
    asr_model_id: null,
    vad_model_id: null,
    llm_model_id: null,
    vllm_model_id: null,
    tts_model_id: null,
    tts_voice_id: null,
    mem_model_id: null,
    intent_model_id: null,
    chat_history_conf: 1,
    system_prompt: 'You are CHEEKO, a fun, witty, and slightly mischievous AI friend for kids. Be energetic, dramatic, and expressive. Use Indian cultural references and expressions. Always be supportive and warm.',
    summary_memory: null,
    lang_code: 'en',
    language: 'English',
    is_visible: 1,
    sort: 0
  },
  {
    id: generateDeterministicUUID('TEMPLATE_MATH_TUTOR'),
    agent_code: 'math_tutor',
    agent_name: 'Math Tutor',
    asr_model_id: null,
    vad_model_id: null,
    llm_model_id: null,
    vllm_model_id: null,
    tts_model_id: null,
    tts_voice_id: null,
    mem_model_id: null,
    intent_model_id: null,
    chat_history_conf: 1,
    system_prompt: 'You are CHEEKO the Math Commander. Create fun math adventures with story-based problems. Use Indian contexts like cricket, festivals, and food. Celebrate correct answers enthusiastically!',
    summary_memory: null,
    lang_code: 'en',
    language: 'English',
    is_visible: 1,
    sort: 10
  },
  {
    id: generateDeterministicUUID('TEMPLATE_WORD_LADDER'),
    agent_code: 'word_ladder',
    agent_name: 'Word Ladder',
    asr_model_id: null,
    vad_model_id: null,
    llm_model_id: null,
    vllm_model_id: null,
    tts_model_id: null,
    tts_voice_id: null,
    mem_model_id: null,
    intent_model_id: null,
    chat_history_conf: 1,
    system_prompt: 'You are CHEEKO the Word Engine Pilot. Play word chain games where each word must start with the last letter of the previous word. Build chains of 10 words to win!',
    summary_memory: null,
    lang_code: 'en',
    language: 'English',
    is_visible: 1,
    sort: 11
  },
  {
    id: generateDeterministicUUID('TEMPLATE_RIDDLE_SOLVER'),
    agent_code: 'riddle_solver',
    agent_name: 'Riddle Solver',
    asr_model_id: null,
    vad_model_id: null,
    llm_model_id: null,
    vllm_model_id: null,
    tts_model_id: null,
    tts_voice_id: null,
    mem_model_id: null,
    intent_model_id: null,
    chat_history_conf: 1,
    system_prompt: 'You are CHEEKO the Master of Mysteries. Present riddles in mysterious locations. Use Indian objects and cultural references. Celebrate when riddles are solved!',
    summary_memory: null,
    lang_code: 'en',
    language: 'English',
    is_visible: 1,
    sort: 12
  },
  {
    id: generateDeterministicUUID('TEMPLATE_STORYTELLER'),
    agent_code: 'storyteller',
    agent_name: 'StoryTeller',
    asr_model_id: null,
    vad_model_id: null,
    llm_model_id: null,
    vllm_model_id: null,
    tts_model_id: null,
    tts_voice_id: null,
    mem_model_id: null,
    intent_model_id: null,
    chat_history_conf: 2,
    system_prompt: 'You are CHEEKO the Storyteller. Read stories expressively with different voices for characters. Use sound effects and dramatic pauses. Also recite shlokas and mantras peacefully.',
    summary_memory: null,
    lang_code: 'en',
    language: 'English',
    is_visible: 1,
    sort: 13
  }
];

async function seedTemplates() {
  console.log('Seeding agent templates to Supabase...\n');

  for (const template of templates) {
    try {
      // Check if template already exists
      const { data: existing } = await supabase
        .from('ai_agent_template')
        .select('id')
        .eq('id', template.id)
        .single();

      if (existing) {
        // Update existing template
        const { error } = await supabase
          .from('ai_agent_template')
          .update({
            ...template,
            updated_at: new Date().toISOString()
          })
          .eq('id', template.id);

        if (error) {
          console.error(`Failed to update ${template.id}:`, error.message);
        } else {
          console.log(`Updated: ${template.agent_name} (${template.id})`);
        }
      } else {
        // Insert new template
        const { error } = await supabase
          .from('ai_agent_template')
          .insert({
            ...template,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (error) {
          console.error(`Failed to insert ${template.id}:`, error.message);
        } else {
          console.log(`Inserted: ${template.agent_name} (${template.id})`);
        }
      }
    } catch (err) {
      console.error(`Error processing ${template.id}:`, err.message);
    }
  }

  console.log('\nDone!');
}

seedTemplates();
