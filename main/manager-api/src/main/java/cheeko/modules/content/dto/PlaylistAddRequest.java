package cheeko.modules.content.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Request DTO for adding items to playlist
 */
@Data
@Schema(description = "Add Items to Playlist Request")
public class PlaylistAddRequest implements Serializable {

    @Schema(description = "List of content IDs to add to playlist", required = true)
    private List<String> contentIds;

    private static final long serialVersionUID = 1L;
}
