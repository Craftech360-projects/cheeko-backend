package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Habit Download DTO - Response for habit download manifest
 */
@Data
@Schema(description = "Habit Download Manifest")
public class HabitDownloadDTO implements Serializable {

    @Schema(description = "RFID card UID")
    private String rfidUid;

    @Schema(description = "Content type (always 'habit')")
    private String contentType = "habit";

    @Schema(description = "Habit code (e.g., brush-teeth, tie-shoelace)")
    private String habitCode;

    @Schema(description = "Habit display name")
    private String habitName;

    @Schema(description = "Content version")
    private String version;

    @Schema(description = "Content hash for cache validation")
    private String contentHash;

    @Schema(description = "Total number of steps")
    private Integer totalSteps;

    @Schema(description = "Thumbnail image URL")
    private String thumbnailUrl;

    @Schema(description = "List of steps with media URLs")
    private List<HabitStepDTO> steps;
}
