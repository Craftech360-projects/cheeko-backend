package xiaozhi.modules.agent.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Map;

/**
 * Game Attempt Statistics DTO
 * Provides detailed statistics about game attempts including correct/wrong
 * counts
 * and breakdown by question type
 *
 * @author claude
 * @version 1.0, 2025/11/25
 * @since 1.0.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GameAttemptStatsDTO {

    /**
     * Game type (math_tutor, riddle_solver, word_ladder)
     */
    private String gameType;

    /**
     * Total number of attempts (first tries only)
     */
    private Integer totalAttempts;

    /**
     * Number of correct answers on first try
     */
    private Integer correctFirstTry;

    /**
     * Number of incorrect answers on first try
     */
    private Integer incorrectFirstTry;

    /**
     * Number of correct answers on second try
     */
    private Integer correctSecondTry;

    /**
     * Success rate percentage (based on first attempts)
     */
    private BigDecimal successRate;

    /**
     * Breakdown of attempts by question type
     * Key: question type (addition, subtraction, multiplication, division, riddle,
     * etc.)
     * Value: QuestionTypeStats object with correct/incorrect counts
     */
    private Map<String, QuestionTypeStatsDTO> breakdownByType;

    /**
     * Question Type Statistics DTO
     * Contains correct/incorrect counts for a specific question type
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class QuestionTypeStatsDTO {
        /**
         * Question type (addition, subtraction, etc.)
         */
        private String questionType;

        /**
         * Number of correct answers
         */
        private Integer correct;

        /**
         * Number of incorrect answers
         */
        private Integer incorrect;

        /**
         * Accuracy percentage for this question type
         */
        private BigDecimal accuracy;
    }
}
