package cheeko.modules.agent.dto;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics Streak DTO
 */
@Data
@Schema(description = "Streak Completion Data")
public class AnalyticsStreakDTO {
    @Schema(description = "Session ID")
    private String sessionId;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Game type: math_tutor, riddle_solver, word_ladder")
    private String gameType;

    @Schema(description = "Streak number in this session (1, 2, 3...)")
    private Integer streakNumber;

    @Schema(description = "Number of consecutive correct answers in this streak")
    private Integer questionsInStreak;

    @Schema(description = "Streak start timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date startedAt;

    @Schema(description = "Streak end timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date endedAt;

    @Schema(description = "Time taken to complete the streak in seconds")
    private Integer durationSeconds;
}
