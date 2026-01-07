package cheeko.modules.rfid.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;

/**
 * Markdown Parser Utility
 * Extracts content sections from markdown files by sequence number
 */
public class MdParserUtil {

    /**
     * Content item extracted from markdown
     */
    public static class ContentItem {
        private String title;
        private String content;

        public ContentItem(String title, String content) {
            this.title = title;
            this.content = content;
        }

        public String getTitle() {
            return title;
        }

        public String getContent() {
            return content;
        }
    }

    /**
     * Extract content by sequence number from markdown content
     *
     * Expected format:
     * ## 1. Title Here
     *
     * Content here...
     *
     * ---
     *
     * ## 2. Another Title
     * ...
     *
     * @param mdContent Full markdown content
     * @param sequence Sequence number (1-based)
     * @return ContentItem with title and content, or null if not found
     */
    public static ContentItem extractBySequence(String mdContent, int sequence) {
        if (StringUtils.isBlank(mdContent) || sequence < 1) {
            return null;
        }

        // Pattern to match: ## {sequence}. Title\n\nContent...
        // Captures: group(1) = title, group(2) = content
        // Content ends at next "---" or next "## " or end of string
        String regex = "##\\s*" + sequence + "\\.\\s*([^\\n]+)\\n+([\\s\\S]*?)(?=\\n---\\n|\\n##\\s|$)";
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(mdContent);

        if (matcher.find()) {
            String title = matcher.group(1).trim();
            String content = matcher.group(2).trim();

            // Clean up content - remove trailing separators and whitespace
            content = content.replaceAll("\\n---\\s*$", "").trim();

            return new ContentItem(title, content);
        }

        return null;
    }

    /**
     * Count total items in markdown content
     * Counts sections that match the pattern "## {number}. "
     *
     * @param mdContent Full markdown content
     * @return Total number of items
     */
    public static int countItems(String mdContent) {
        if (StringUtils.isBlank(mdContent)) {
            return 0;
        }

        Pattern pattern = Pattern.compile("##\\s*\\d+\\.\\s+");
        Matcher matcher = pattern.matcher(mdContent);

        int count = 0;
        while (matcher.find()) {
            count++;
        }

        return count;
    }

    /**
     * Validate if a sequence number exists in the markdown content
     *
     * @param mdContent Full markdown content
     * @param sequence Sequence number to validate
     * @return true if sequence exists, false otherwise
     */
    public static boolean hasSequence(String mdContent, int sequence) {
        return extractBySequence(mdContent, sequence) != null;
    }
}
