package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Unified Content Item DTO - Represents a single item in a content pack
 * Works for all content types: habit steps, rhymes, story pages, etc.
 */
@Data
@Schema(description = "Unified Content Item")
public class ContentItemDTO implements Serializable {

    @Schema(description = "Item number (1-based)")
    private Integer itemNumber;

    @Schema(description = "Item title")
    private String title;

    @Schema(description = "Item description/instruction text")
    private String description;

    @Schema(description = "Lyrics or content text (for rhymes)")
    private String lyricsText;

    @Schema(description = "Audio information")
    private AudioInfo audio;

    @Schema(description = "List of images (for habits)")
    private List<ImageInfo> images;

    /**
     * Audio file information
     */
    @Data
    public static class AudioInfo implements Serializable {
        @Schema(description = "Audio URL")
        private String url;

        @Schema(description = "File size in bytes")
        private Long sizeBytes;

        @Schema(description = "Duration in milliseconds")
        private Integer durationMs;
    }

    /**
     * Image file information
     */
    @Data
    public static class ImageInfo implements Serializable {
        @Schema(description = "Image URL")
        private String url;

        @Schema(description = "File size in bytes")
        private Long sizeBytes;

        @Schema(description = "Image sequence number")
        private Integer sequence;
    }
}
