package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Unified Content Download DTO - Response for content download manifest
 * Works for all content types: habits, rhymes, stories, etc.
 */
@Data
@Schema(description = "Unified Content Download Manifest")
public class ContentDownloadDTO implements Serializable {

    @Schema(description = "RFID card UID")
    private String rfidUid;

    @Schema(description = "Content type (habit, rhyme, story, etc.)")
    private String contentType;

    @Schema(description = "Content pack code (e.g., brush-teeth, RHYMES_EN_01)")
    private String packCode;

    @Schema(description = "Content display name")
    private String packName;

    @Schema(description = "Content description")
    private String description;

    @Schema(description = "Content version for cache validation")
    private String version;

    @Schema(description = "Content hash for cache validation")
    private String contentHash;

    @Schema(description = "Total number of items")
    private Integer totalItems;

    @Schema(description = "Language code")
    private String language;

    @Schema(description = "Thumbnail image URL (for habits)")
    private String thumbnailUrl;

    @Schema(description = "List of content items with media URLs")
    private List<ContentItemDTO> items;
}
