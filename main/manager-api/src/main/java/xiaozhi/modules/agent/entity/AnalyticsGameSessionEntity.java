package xiaozhi.modules.agent.entity;

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
 * Analytics: Game Sessions and Usage Tracking
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "analytics_game_sessions")
public class AnalyticsGameSessionEntity {
    /**
     * Primary Key ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * Session/Room ID
     */
    @TableField(value = "session_id")
    private String sessionId;

    /**
     * Device MAC Address
     */
    @TableField(value = "mac_address")
    private String macAddress;

    /**
     * Agent ID
     */
    @TableField(value = "agent_id")
    private String agentId;

    /**
     * Mode type: Conversation, Math, Riddle, WordLadder, Music, Story
     */
    @TableField(value = "mode_type")
    private String modeType;

    /**
     * Session start timestamp
     */
    @TableField(value = "started_at")
    private Date startedAt;

    /**
     * Session end timestamp
     */
    @TableField(value = "ended_at")
    private Date endedAt;

    /**
     * Session duration in seconds (calculated)
     */
    @TableField(value = "duration_seconds")
    private Integer durationSeconds;

    /**
     * Number of interactions (questions/songs/turns)
     */
    @TableField(value = "interaction_count")
    private Integer interactionCount;

    /**
     * Completion status: completed, interrupted, switched, victory, failure
     */
    @TableField(value = "completion_status")
    private String completionStatus;

    /**
     * Mode-specific extra data (JSON)
     */
    @TableField(value = "metadata")
    private String metadata;

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
