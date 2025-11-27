package xiaozhi.modules.agent.dto;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics Game Session DTO
 */
@Data
@Schema(description = "Game Session Data")
public class AnalyticsGameSessionDTO {
    @Schema(description = "Session ID")
    private String sessionId;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Agent ID")
    private String agentId;

    @Schema(description = "Mode type: Conversation, Math, Riddle, WordLadder, Music, Story")
    private String modeType;

    @Schema(description = "Session start timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date startedAt;

    @Schema(description = "Session end timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date endedAt;

    @Schema(description = "Session duration in seconds")
    private Integer durationSeconds;

    @Schema(description = "Number of interactions")
    private Integer interactionCount;

    @Schema(description = "Completion status")
    private String completionStatus;

    @Schema(description = "Additional metadata (JSON string)")
    private String metadata;
}
