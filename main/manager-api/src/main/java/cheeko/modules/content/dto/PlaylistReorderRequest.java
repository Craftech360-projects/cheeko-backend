package cheeko.modules.content.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Request DTO for reordering playlist items
 */
@Data
@Schema(description = "Reorder Playlist Request")
public class PlaylistReorderRequest implements Serializable {

    @Schema(description = "List of items with new positions", required = true)
    private List<ReorderItem> items;

    @Data
    public static class ReorderItem implements Serializable {
        @Schema(description = "Content ID", required = true)
        private String contentId;

        @Schema(description = "New position (0-based index)", required = true)
        private Integer position;

        private static final long serialVersionUID = 1L;
    }

    private static final long serialVersionUID = 1L;
}
