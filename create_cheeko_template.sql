-- SQL script to create Cheeko (Conversation) template
-- This adds the missing conversation mode template to the database

INSERT INTO ai_agent_template (
    id,
    agent_name,
    agent_code,
    asr_model_id,
    vad_model_id,
    llm_model_id,
    vllm_model_id,
    tts_model_id,
    tts_voice_id,
    mem_model_id,
    intent_model_id,
    system_prompt,
    summary_memory,
    chat_history_conf,
    lang_code,
    language,
    sort,
    is_visible,
    creator,
    created_at
) VALUES (
    'f890abcdef123456789abcdef0001',  -- Unique ID
    'Cheeko',  -- Agent name to match mobile app
    'TMPL_CHEEKO',
    'ASR_Whisper',  -- Default ASR model
    'VAD_SileroVAD',  -- Default VAD model  
    'LLM_OpenAI_GPT4o_Mini',  -- Default LLM model
    'VLLM_OpenAI_GPT4o_Mini',  -- Default VLLM model
    'TTS_EdgeTTS',  -- Default TTS model
    'TTS_EdgeTTS_Ana',  -- Default voice (Ana)
    'Memory_mem_local_short',  -- Local short-term memory
    'Intent_function_call',  -- Function call intent
    'You are Cheeko, a friendly and helpful AI assistant for children. You engage in natural conversations, answer questions, and help with various topics in an age-appropriate manner.',  -- System prompt
    '',  -- Empty summary memory
    1,  -- Chat history conf (1 = text only)
    'en-US',  -- Language code
    'English',  -- Language
    1,  -- Sort order (first in list)
    1,  -- Visible
    1,  -- Creator ID (admin)
    NOW()  -- Created timestamp
);

-- Verify the template was created
SELECT id, agent_name, is_visible, sort 
FROM ai_agent_template 
WHERE is_visible = 1 
ORDER BY sort;
