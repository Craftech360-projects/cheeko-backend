package cheeko.modules.device.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Device Token Usage - tracks token usage per device per session
 *
 * @author claude
 * @version 2.0, 2025/12/08
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "device_token_usage")
public class DeviceTokenUsageEntity {
    /**
     * Primary Key ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * Device MAC Address
     */
    @TableField(value = "mac_address")
    private String macAddress;

    /**
     * Session/Room ID
     */
    @TableField(value = "session_id")
    private String sessionId;

    /**
     * Audio input tokens (expensive)
     */
    @TableField(value = "input_audio_tokens")
    private Long inputAudioTokens;

    /**
     * Text input tokens
     */
    @TableField(value = "input_text_tokens")
    private Long inputTextTokens;

    /**
     * Cached input tokens (discounted)
     */
    @TableField(value = "input_cached_tokens")
    private Long inputCachedTokens;

    /**
     * Usage date
     */
    @TableField(value = "usage_date")
    private Date usageDate;

    /**
     * Total input tokens
     */
    @TableField(value = "input_tokens")
    private Long inputTokens;

    /**
     * Total output tokens
     */
    @TableField(value = "output_tokens")
    private Long outputTokens;

    /**
     * Audio output tokens (most expensive)
     */
    @TableField(value = "output_audio_tokens")
    private Long outputAudioTokens;

    /**
     * Text output tokens
     */
    @TableField(value = "output_text_tokens")
    private Long outputTextTokens;

    /**
     * Session duration in seconds
     */
    @TableField(value = "session_duration_seconds")
    private Double sessionDurationSeconds;

    /**
     * Average time to first token in seconds (latency)
     */
    @TableField(value = "avg_ttft_seconds")
    private Double avgTtftSeconds;

    /**
     * Number of conversation turns/messages
     */
    @TableField(value = "message_count")
    private Integer messageCount;

    /**
     * Total response generation duration in seconds
     */
    @TableField(value = "total_response_duration_seconds")
    private Double totalResponseDurationSeconds;

    /**
     * Total tokens (input + output) - auto-calculated by database
     */
    @TableField(value = "total_tokens", insertStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER, updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER)
    private Long totalTokens;

    /**
     * Number of sessions that day
     */
    @TableField(value = "session_count")
    private Integer sessionCount;

    /**
     * Record creation time
     */
    @TableField(value = "created_at")
    private Date createdAt;

    /**
     * Record update time
     */
    @TableField(value = "updated_at")
    private Date updatedAt;
}
