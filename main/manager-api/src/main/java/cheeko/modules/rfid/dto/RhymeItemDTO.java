package cheeko.modules.rfid.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Rhyme Item DTO for download manifest
 * Similar to HabitStepDTO but for rhyme items
 */
@Data
@Schema(description = "Rhyme Item with audio details")
public class RhymeItemDTO implements Serializable {

    @Schema(description = "Item number (1-based)")
    private Integer itemNumber;

    @Schema(description = "Item title (e.g., Twinkle Twinkle Little Star)")
    private String title;

    @Schema(description = "Lyrics/content text")
    private String lyricsText;

    @Schema(description = "Audio file details")
    private AudioInfo audio;

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
}
