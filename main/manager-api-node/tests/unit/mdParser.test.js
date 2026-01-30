/**
 * MdParser Utility Unit Tests
 *
 * Tests for markdown content extraction by sequence number.
 */

const { extractBySequence, countItems, hasSequence } = require('../../src/utils/mdParser');

// Sample markdown content matching expected format
const SAMPLE_MD = `## 1. Twinkle Twinkle

Twinkle twinkle little star
How I wonder what you are
Up above the world so high
Like a diamond in the sky

---

## 2. Humpty Dumpty

Humpty Dumpty sat on a wall
Humpty Dumpty had a great fall
All the king's horses and all the king's men
Couldn't put Humpty together again

---

## 3. Jack and Jill

Jack and Jill went up the hill
To fetch a pail of water
Jack fell down and broke his crown
And Jill came tumbling after`;

const SINGLE_ITEM_MD = `## 1. Only Item

This is the only item in the pack.`;

const EMPTY_MD = '';

describe('MdParser Utility', () => {
  // =============================================
  // extractBySequence
  // =============================================

  describe('extractBySequence', () => {
    it('should extract first item by sequence 1', () => {
      const result = extractBySequence(SAMPLE_MD, 1);

      expect(result).not.toBeNull();
      expect(result.title).toBe('Twinkle Twinkle');
      expect(result.content).toContain('Twinkle twinkle little star');
      expect(result.content).toContain('Like a diamond in the sky');
    });

    it('should extract second item by sequence 2', () => {
      const result = extractBySequence(SAMPLE_MD, 2);

      expect(result).not.toBeNull();
      expect(result.title).toBe('Humpty Dumpty');
      expect(result.content).toContain('Humpty Dumpty sat on a wall');
    });

    it('should extract last item by sequence 3', () => {
      const result = extractBySequence(SAMPLE_MD, 3);

      expect(result).not.toBeNull();
      expect(result.title).toBe('Jack and Jill');
      expect(result.content).toContain('Jack and Jill went up the hill');
    });

    it('should return null for non-existent sequence', () => {
      const result = extractBySequence(SAMPLE_MD, 99);

      expect(result).toBeNull();
    });

    it('should return null for sequence 0', () => {
      const result = extractBySequence(SAMPLE_MD, 0);

      expect(result).toBeNull();
    });

    it('should return null for negative sequence', () => {
      const result = extractBySequence(SAMPLE_MD, -1);

      expect(result).toBeNull();
    });

    it('should return null for null content', () => {
      const result = extractBySequence(null, 1);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = extractBySequence(EMPTY_MD, 1);

      expect(result).toBeNull();
    });

    it('should return null for non-string content', () => {
      const result = extractBySequence(123, 1);

      expect(result).toBeNull();
    });

    it('should handle single item markdown', () => {
      const result = extractBySequence(SINGLE_ITEM_MD, 1);

      expect(result).not.toBeNull();
      expect(result.title).toBe('Only Item');
      expect(result.content).toBe('This is the only item in the pack.');
    });

    it('should not include trailing separator in content', () => {
      const result = extractBySequence(SAMPLE_MD, 1);

      expect(result).not.toBeNull();
      expect(result.content).not.toContain('---');
    });

    it('should not include content from next section', () => {
      const result = extractBySequence(SAMPLE_MD, 1);

      expect(result).not.toBeNull();
      expect(result.content).not.toContain('Humpty Dumpty');
    });

    it('should trim whitespace from title and content', () => {
      const result = extractBySequence(SAMPLE_MD, 1);

      expect(result).not.toBeNull();
      expect(result.title).toBe(result.title.trim());
      expect(result.content).toBe(result.content.trim());
    });
  });

  // =============================================
  // countItems
  // =============================================

  describe('countItems', () => {
    it('should count 3 items in sample markdown', () => {
      expect(countItems(SAMPLE_MD)).toBe(3);
    });

    it('should count 1 item in single item markdown', () => {
      expect(countItems(SINGLE_ITEM_MD)).toBe(1);
    });

    it('should return 0 for empty string', () => {
      expect(countItems(EMPTY_MD)).toBe(0);
    });

    it('should return 0 for null', () => {
      expect(countItems(null)).toBe(0);
    });

    it('should return 0 for non-string', () => {
      expect(countItems(123)).toBe(0);
    });

    it('should return 0 for markdown without numbered sections', () => {
      const noSections = '# Title\n\nSome content without numbered sections.';
      expect(countItems(noSections)).toBe(0);
    });
  });

  // =============================================
  // hasSequence
  // =============================================

  describe('hasSequence', () => {
    it('should return true for existing sequence 1', () => {
      expect(hasSequence(SAMPLE_MD, 1)).toBe(true);
    });

    it('should return true for existing sequence 2', () => {
      expect(hasSequence(SAMPLE_MD, 2)).toBe(true);
    });

    it('should return true for existing sequence 3', () => {
      expect(hasSequence(SAMPLE_MD, 3)).toBe(true);
    });

    it('should return false for non-existent sequence', () => {
      expect(hasSequence(SAMPLE_MD, 99)).toBe(false);
    });

    it('should return false for null content', () => {
      expect(hasSequence(null, 1)).toBe(false);
    });

    it('should return false for empty content', () => {
      expect(hasSequence(EMPTY_MD, 1)).toBe(false);
    });
  });
});
