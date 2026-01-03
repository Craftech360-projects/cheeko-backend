package cheeko.modules.agent.dto;

import java.math.BigDecimal;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics User Statistics DTO
 */
@Data
@Schema(description = "User Statistics Data")
public class AnalyticsUserStatsDTO {
    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Mode/Game type")
    private String modeType;

    @Schema(description = "Total sessions")
    private Integer totalSessions;

    @Schema(description = "Total time spent in seconds")
    private Long totalTimeSeconds;

    @Schema(description = "Total interactions (questions/songs/turns)")
    private Integer totalInteractions;

    @Schema(description = "Success rate percentage (0-100)")
    private BigDecimal successRatePercentage;

    @Schema(description = "Longest streak")
    private Integer longestStreak;

    @Schema(description = "Skill level: beginner, intermediate, advanced")
    private String skillLevel;

    @Schema(description = "Total correct answers")
    private Integer totalCorrect;

    @Schema(description = "Total incorrect answers")
    private Integer totalIncorrect;

    @Schema(description = "Average response time in milliseconds")
    private Integer avgResponseTimeMs;
}
