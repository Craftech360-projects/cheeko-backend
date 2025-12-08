package xiaozhi.modules.device.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Token Usage DTO for API requests/responses
 *
 * @author claude
 * @version 2.0, 2025/12/08
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
     * Session ID
     */
    private String sessionId;

    /**
     * Audio input tokens
     */
    private Long inputAudioTokens;

    /**
     * Text input tokens
     */
    private Long inputTextTokens;

    /**
     * Cached input tokens
     */
    private Long inputCachedTokens;

    /**
     * Total input tokens
     */
    private Long inputTokens;

    /**
     * Audio output tokens
     */
    private Long outputAudioTokens;

    /**
     * Text output tokens
     */
    private Long outputTextTokens;

    /**
     * Total output tokens
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

    /**
     * Session duration in seconds
     */
    private Double sessionDurationSeconds;

    /**
     * Average time to first token in seconds (latency)
     */
    private Double avgTtftSeconds;

    /**
     * Number of conversation turns/messages
     */
    private Integer messageCount;

    /**
     * Total response duration in seconds
     */
    private Double totalResponseDurationSeconds;
}
