package cheeko.modules.content.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Response DTO for playlist operations
 */
@Data
@Schema(description = "Playlist Operation Response")
public class PlaylistOperationResponse implements Serializable {

    @Schema(description = "Operation message")
    private String message;

    @Schema(description = "Total items in playlist after operation")
    private Integer totalItems;

    private static final long serialVersionUID = 1L;

    public PlaylistOperationResponse(String message, Integer totalItems) {
        this.message = message;
        this.totalItems = totalItems;
    }
}
