package cheeko.modules.agent.dto;

import java.math.BigDecimal;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics Media Playback DTO
 */
@Data
@Schema(description = "Media Playback Data")
public class AnalyticsMediaPlaybackDTO {
    @Schema(description = "Session ID")
    private String sessionId;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Media type: music or story")
    private String mediaType;

    @Schema(description = "Media ID (song/story identifier)")
    private String mediaId;

    @Schema(description = "Media title (song/story name)")
    private String mediaTitle;

    @Schema(description = "Playback start timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date startedAt;

    @Schema(description = "Playback end timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date endedAt;

    @Schema(description = "Duration played in seconds")
    private Integer durationPlayedSeconds;

    @Schema(description = "Total media duration in seconds")
    private Integer totalDurationSeconds;

    @Schema(description = "Completion percentage (0-100)")
    private BigDecimal completionPercentage;

    @Schema(description = "Skip action: next, previous, stop")
    private String skipAction;

    @Schema(description = "Timestamp if skipped")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date skippedAt;

    @Schema(description = "Additional metadata (JSON string)")
    private String metadata;
}
