package cheeko.modules.agent.entity;

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
 * Analytics: Game Attempts and Performance
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "analytics_game_attempts")
public class AnalyticsGameAttemptEntity {
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
     * Game type: math_tutor, riddle_solver, word_ladder
     */
    @TableField(value = "game_type")
    private String gameType;

    /**
     * The question/riddle/word challenge
     */
    @TableField(value = "question_text")
    private String questionText;

    /**
     * Question type: addition, subtraction, animal-riddle, etc.
     */
    @TableField(value = "question_type")
    private String questionType;

    /**
     * Difficulty level: easy, medium, hard
     */
    @TableField(value = "difficulty_level")
    private String difficultyLevel;

    /**
     * Expected answer
     */
    @TableField(value = "correct_answer")
    private String correctAnswer;

    /**
     * User provided answer
     */
    @TableField(value = "user_answer")
    private String userAnswer;

    /**
     * Answer correctness
     */
    @TableField(value = "is_correct")
    private Boolean isCorrect;

    /**
     * Attempt number: 1 or 2 (retry)
     */
    @TableField(value = "attempt_number")
    private Byte attemptNumber;

    /**
     * Time to answer in milliseconds
     */
    @TableField(value = "response_time_ms")
    private Integer responseTimeMs;

    /**
     * Answer timestamp
     */
    @TableField(value = "answered_at")
    private Date answeredAt;

    /**
     * Game-specific extra data (JSON)
     */
    @TableField(value = "metadata")
    private String metadata;

    /**
     * Record creation time
     */
    @TableField(value = "created_at")
    private Date createdAt;
}
