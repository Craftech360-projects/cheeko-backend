package cheeko.modules.agent.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonFormat;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Analytics: Daily Usage Statistics DTO
 *
 * @author claude
 * @version 1.0, 2025/11/22
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Schema(description = "Daily usage statistics")
public class AnalyticsDailyUsageDTO {

    @Schema(description = "Date (YYYY-MM-DD)")
    @JsonFormat(pattern = "yyyy-MM-dd")
    private LocalDate date;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Total usage in seconds")
    private Long totalUsageSeconds;

    @Schema(description = "Total usage in minutes")
    private Long totalUsageMinutes;

    @Schema(description = "Total usage in hours (decimal)")
    private BigDecimal totalUsageHours;

    @Schema(description = "Total number of sessions")
    private Integer sessionCount;

    @Schema(description = "Usage breakdown by character/mode (character name -> CharacterUsage)")
    private Map<String, CharacterUsage> breakdownByCharacter;

    /**
     * Character-specific usage details
     */
    @Data
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    @Schema(description = "Character usage details")
    public static class CharacterUsage {

        @Schema(description = "Usage in seconds")
        private Long seconds;

        @Schema(description = "Usage in minutes")
        private Long minutes;

        @Schema(description = "Number of sessions")
        private Integer sessions;
    }
}
