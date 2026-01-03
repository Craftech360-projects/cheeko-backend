package cheeko.modules.agent.dto;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Analytics Game Attempt DTO
 */
@Data
@Schema(description = "Game Attempt Data")
public class AnalyticsGameAttemptDTO {
    @Schema(description = "Session ID")
    private String sessionId;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "Game type: math_tutor, riddle_solver, word_ladder")
    private String gameType;

    @Deprecated
    @Schema(description = "DEPRECATED - Question text (not used, always null)")
    private String questionText;

    @Schema(description = "Question type: addition, subtraction, etc.")
    private String questionType;

    @Schema(description = "Difficulty level: easy, medium, hard")
    private String difficultyLevel;

    @Deprecated
    @Schema(description = "DEPRECATED - Correct answer (not used, always null)")
    private String correctAnswer;

    @Deprecated
    @Schema(description = "DEPRECATED - User's answer (not used, always null)")
    private String userAnswer;

    @Schema(description = "Is answer correct")
    private Boolean isCorrect;

    @Schema(description = "Attempt number (1 or 2)")
    private Byte attemptNumber;

    @Schema(description = "Response time in milliseconds")
    private Integer responseTimeMs;

    @Schema(description = "Answer timestamp")
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private Date answeredAt;

    @Deprecated
    @Schema(description = "DEPRECATED - Additional metadata (not used, always null)")
    private String metadata;
}
