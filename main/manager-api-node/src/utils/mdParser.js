/**
 * Markdown Parser Utility
 * Extracts content sections from markdown files by sequence number.
 *
 * Expected markdown format:
 * ## 1. Title Here
 *
 * Content here...
 *
 * ---
 *
 * ## 2. Another Title
 * ...
 */

/**
 * Extract content by sequence number from markdown content.
 *
 * @param {string} mdContent - Full markdown content
 * @param {number} sequence - Sequence number (1-based)
 * @returns {{ title: string, content: string } | null} Extracted item or null
 */
const extractBySequence = (mdContent, sequence) => {
  if (!mdContent || typeof mdContent !== 'string' || sequence < 1) {
    return null;
  }

  // Pattern: ## {sequence}. Title\n\nContent...
  // Content ends at next "---" or next "## " or end of string
  const regex = new RegExp(
    `##\\s*${sequence}\\.\\s*([^\\n]+)\\n+([\\s\\S]*?)(?=\\n---\\n|\\n##\\s|$)`
  );
  const match = mdContent.match(regex);

  if (match) {
    const title = match[1].trim();
    let content = match[2].trim();

    // Clean up content - remove trailing separators and whitespace
    content = content.replace(/\n---\s*$/, '').trim();

    return { title, content };
  }

  return null;
};

/**
 * Count total items in markdown content.
 * Counts sections that match the pattern "## {number}. "
 *
 * @param {string} mdContent - Full markdown content
 * @returns {number} Total number of items
 */
const countItems = (mdContent) => {
  if (!mdContent || typeof mdContent !== 'string') {
    return 0;
  }

  const matches = mdContent.match(/##\s*\d+\.\s+/g);
  return matches ? matches.length : 0;
};

/**
 * Validate if a sequence number exists in the markdown content.
 *
 * @param {string} mdContent - Full markdown content
 * @param {number} sequence - Sequence number to validate
 * @returns {boolean} true if sequence exists
 */
const hasSequence = (mdContent, sequence) => {
  return extractBySequence(mdContent, sequence) !== null;
};

module.exports = {
  extractBySequence,
  countItems,
  hasSequence,
};
