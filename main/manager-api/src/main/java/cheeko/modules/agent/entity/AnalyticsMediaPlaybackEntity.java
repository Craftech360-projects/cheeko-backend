package cheeko.modules.agent.entity;

import java.math.BigDecimal;
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
 * Analytics: Music and Story Playback
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "analytics_media_playback")
public class AnalyticsMediaPlaybackEntity {
    /**
     * Primary Key ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * Session ID (FK to game_sessions)
     */
    @TableField(value = "session_id")
    private String sessionId;

    /**
     * Device MAC Address
     */
    @TableField(value = "mac_address")
    private String macAddress;

    /**
     * Media type: music or story
     */
    @TableField(value = "media_type")
    private String mediaType;

    /**
     * Song/Story identifier
     */
    @TableField(value = "media_id")
    private String mediaId;

    /**
     * Song/Story name
     */
    @TableField(value = "media_title")
    private String mediaTitle;

    /**
     * Playback start timestamp
     */
    @TableField(value = "started_at")
    private Date startedAt;

    /**
     * Playback end timestamp
     */
    @TableField(value = "ended_at")
    private Date endedAt;

    /**
     * Actual listen time in seconds
     */
    @TableField(value = "duration_played_seconds")
    private Integer durationPlayedSeconds;

    /**
     * Full media length in seconds
     */
    @TableField(value = "total_duration_seconds")
    private Integer totalDurationSeconds;

    /**
     * Percentage listened (0-100)
     */
    @TableField(value = "completion_percentage")
    private BigDecimal completionPercentage;

    /**
     * Skip action: next, previous, stop, or NULL
     */
    @TableField(value = "skip_action")
    private String skipAction;

    /**
     * Timestamp if skipped
     */
    @TableField(value = "skipped_at")
    private Date skippedAt;

    /**
     * Extra playback data (JSON)
     */
    @TableField(value = "metadata")
    private String metadata;

    /**
     * Record creation time
     */
    @TableField(value = "created_at")
    private Date createdAt;
}
