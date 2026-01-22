package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Habit Step DTO for download manifest
 */
@Data
@Schema(description = "Habit Step with media details")
public class HabitStepDTO implements Serializable {

    @Schema(description = "Step number (1-based)")
    private Integer stepNumber;

    @Schema(description = "Step title")
    private String title;

    @Schema(description = "Instruction text")
    private String instructionText;

    @Schema(description = "Audio file details")
    private AudioInfo audio;

    @Schema(description = "Image files")
    private List<ImageInfo> images;

    /**
     * Audio file information
     */
    @Data
    @Schema(description = "Audio file information")
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
    @Schema(description = "Image file information")
    public static class ImageInfo implements Serializable {
        @Schema(description = "Image URL")
        private String url;

        @Schema(description = "File size in bytes")
        private Long sizeBytes;

        @Schema(description = "Sequence number for ordering")
        private Integer sequence;
    }
}
