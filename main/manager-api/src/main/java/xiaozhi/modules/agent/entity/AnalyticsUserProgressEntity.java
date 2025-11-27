package xiaozhi.modules.agent.entity;

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
 * Analytics: User Progress and Aggregated Stats
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "analytics_user_progress")
public class AnalyticsUserProgressEntity {
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
     * Mode type: Math, Riddle, WordLadder, Music, Story, Conversation
     */
    @TableField(value = "mode_type")
    private String modeType;

    /**
     * Total session count
     */
    @TableField(value = "total_sessions")
    private Integer totalSessions;

    /**
     * Cumulative time spent in seconds
     */
    @TableField(value = "total_time_seconds")
    private Long totalTimeSeconds;

    /**
     * Total questions/songs/turns
     */
    @TableField(value = "total_interactions")
    private Integer totalInteractions;

    /**
     * Accuracy for games (0-100)
     */
    @TableField(value = "success_rate_percentage")
    private BigDecimal successRatePercentage;

    /**
     * Best streak for games
     */
    @TableField(value = "longest_streak")
    private Integer longestStreak;

    /**
     * Total number of streaks completed
     */
    @TableField(value = "total_streaks_completed")
    private Integer totalStreaksCompleted;

    /**
     * Average time to complete a streak (in seconds)
     */
    @TableField(value = "average_streak_time_seconds")
    private Integer averageStreakTimeSeconds;

    /**
     * Skill level: beginner, intermediate, advanced
     */
    @TableField(value = "skill_level")
    private String skillLevel;

    /**
     * Last activity timestamp
     */
    @TableField(value = "last_played_at")
    private Date lastPlayedAt;

    /**
     * Weekly summary for dashboard (JSON)
     */
    @TableField(value = "weekly_summary_json")
    private String weeklySummaryJson;

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
