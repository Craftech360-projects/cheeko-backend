// content_type on rfid_content_pack is a free-text VarChar(50) with no DB
// constraint, and the gateway routes cards by data shape rather than by this
// string. So these are display labels only — any other value, including types
// created from the pack editor, shows its raw value.

// Types offered by default in the pack editor's dropdown.
export const DEFAULT_CONTENT_TYPES = ['story_pack', 'rhyme_pack', 'habit_pack', 'rfidcontent'];

// Labels cover the defaults plus the two values the backend gives special
// meaning (prompt / prompt_pack), so filters over existing data read cleanly.
export const CONTENT_TYPE_LABELS = {
  story_pack: 'Story Pack',
  rhyme_pack: 'Rhyme Pack',
  habit_pack: 'Habit Pack',
  rfidcontent: 'RFID Content',
  prompt: 'AI Prompt',
  prompt_pack: 'Q&A Pack'
};

export const contentTypeLabel = (value) => CONTENT_TYPE_LABELS[value] || value;
