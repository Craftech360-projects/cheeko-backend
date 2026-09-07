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

// ---------------------------------------------------------------------------
// Playlists created from the UI
//
// A content type only exists because some pack carries that string, so a
// freshly named playlist would vanish the moment the dialog closed and would
// never appear in the filter until its first pack was saved. This registry
// holds those names locally so an empty playlist stays visible and keeps its
// display capitalisation; once a pack is saved with it, the value is derived
// from the packs like any other and the registry is just a label source.
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'cheeko.contentTypes.custom';

/** Reads the registry defensively: storage can be unavailable or corrupt. */
function readRegistry() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeRegistry(map) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // Private windows and blocked site data: the playlist still works for this
    // session, it just will not be remembered.
  }
}

/** Turns a typed name into the snake_case shape every stored value uses. */
export function normalizeContentType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

/** `[{ value, label }]` for every playlist created from the UI. */
export function customContentTypes() {
  const map = readRegistry();
  return Object.keys(map).map(value => ({ value, label: map[value] }));
}

/**
 * Records a playlist under its normalised value, keeping the name as typed for
 * display. Returns `{ value, label }`, or null when the name normalises away.
 */
export function registerContentType(name) {
  const label = String(name || '').trim();
  const value = normalizeContentType(label);
  if (!value) return null;

  const map = readRegistry();
  map[value] = label;
  writeRegistry(map);
  return { value, label };
}

export function forgetContentType(value) {
  const map = readRegistry();
  if (!(value in map)) return;
  delete map[value];
  writeRegistry(map);
}

/** Shipped label, else a name created from the UI, else the raw value. */
export const contentTypeLabel = (value) => {
  if (!value) return value;
  if (CONTENT_TYPE_LABELS[value]) return CONTENT_TYPE_LABELS[value];
  const custom = readRegistry()[value];
  return custom || value;
};
