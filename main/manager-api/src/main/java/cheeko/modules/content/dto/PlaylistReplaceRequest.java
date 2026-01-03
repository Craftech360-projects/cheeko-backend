package cheeko.modules.content.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Request DTO for replacing entire playlist
 */
@Data
@Schema(description = "Replace Playlist Request")
public class PlaylistReplaceRequest implements Serializable {

    @Schema(description = "List of content IDs for new playlist (replaces old one)", required = true)
    private List<String> contentIds;

    private static final long serialVersionUID = 1L;
}
