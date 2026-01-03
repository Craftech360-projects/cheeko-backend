package cheeko.modules.agent.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics Streak Entity - Tracks streak completions
 */
@Data
@TableName("analytics_streaks")
@Schema(description = "Streak completion tracking")
public class AnalyticsStreakEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary Key ID")
    private Long id;

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
    private Date startedAt;

    @Schema(description = "Streak end timestamp")
    private Date endedAt;

    @Schema(description = "Time taken to complete the streak in seconds")
    private Integer durationSeconds;

    @Schema(description = "Record creation time")
    private Date createdAt;
}
