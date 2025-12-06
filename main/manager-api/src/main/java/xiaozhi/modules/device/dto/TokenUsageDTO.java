package xiaozhi.modules.device.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Token Usage DTO for API requests/responses
 *
 * @author claude
 * @version 1.0, 2025/12/06
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class TokenUsageDTO {
    /**
     * Device MAC address
     */
    private String macAddress;

    /**
     * Input tokens
     */
    private Long inputTokens;

    /**
     * Output tokens
     */
    private Long outputTokens;

    /**
     * Total tokens (input + output)
     */
    private Long totalTokens;

    /**
     * Number of sessions
     */
    private Integer sessionCount;
}
