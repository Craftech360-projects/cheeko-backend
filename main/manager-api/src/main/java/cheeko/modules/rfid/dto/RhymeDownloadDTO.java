package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Rhyme Download DTO - Response for rhyme download manifest
 * Similar to HabitDownloadDTO but for rhyme content packs
 */
@Data
@Schema(description = "Rhyme Download Manifest")
public class RhymeDownloadDTO implements Serializable {

    @Schema(description = "RFID card UID")
    private String rfidUid;

    @Schema(description = "Content type (always 'rhyme')")
    private String contentType = "rhyme";

    @Schema(description = "Pack code (e.g., RHYMES_EN_01)")
    private String packCode;

    @Schema(description = "Pack display name")
    private String packName;

    @Schema(description = "Content version for cache validation")
    private String version;

    @Schema(description = "Content hash for cache validation")
    private String contentHash;

    @Schema(description = "Total number of items in pack")
    private Integer totalItems;

    @Schema(description = "Language code")
    private String language;

    @Schema(description = "List of rhyme items with audio URLs")
    private List<RhymeItemDTO> items;
}
