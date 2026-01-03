package cheeko.modules.content.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Playlist Item DTO
 * Represents a playlist item with content details
 * Used for returning playlist data to clients (without full URLs)
 */
@Data
@Schema(description = "Playlist Item with Content Details")
public class PlaylistItemDTO implements Serializable {

    @Schema(description = "Content ID")
    private String contentId;

    @Schema(description = "Content title")
    private String title;

    @Schema(description = "Romanized title")
    private String romanized;

    @Schema(description = "Filename (without full URL path)")
    private String filename;

    @Schema(description = "Category/Language (for stories: Adventure/Fantasy, for music: English/Hindi)")
    private String category;

    @Schema(description = "Position in playlist (0-based)")
    private Integer position;

    @Schema(description = "Duration in seconds")
    private Integer durationSeconds;

    @Schema(description = "Thumbnail URL")
    private String thumbnailUrl;

    @Schema(description = "Creation timestamp (IST)")
    private java.util.Date createdAt;

    @Schema(description = "Last update timestamp (IST)")
    private java.util.Date updatedAt;

    private static final long serialVersionUID = 1L;
}
