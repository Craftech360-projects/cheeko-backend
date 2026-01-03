package cheeko.modules.agent.service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import cheeko.common.page.PageData;
import cheeko.modules.agent.dto.AnalyticsDailyUsageDTO;
import cheeko.modules.agent.dto.AnalyticsGameAttemptDTO;
import cheeko.modules.agent.dto.AnalyticsGameSessionDTO;
import cheeko.modules.agent.dto.AnalyticsMediaPlaybackDTO;
import cheeko.modules.agent.dto.AnalyticsStreakDTO;
import cheeko.modules.agent.dto.AnalyticsUserStatsDTO;
import cheeko.modules.agent.entity.AnalyticsUserProgressEntity;

/**
 * Analytics Service for game metrics and usage tracking
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
public interface AnalyticsService {

    /**
     * Start a new game session
     *
     * @param sessionDTO Session data
     * @return Session ID
     */
    String startSession(AnalyticsGameSessionDTO sessionDTO);

    /**
     * End a game session
     *
     * @param sessionId        Session ID
     * @param completionStatus Completion status (completed, interrupted, switched,
     *                         victory, failure)
     */
    void endSession(String sessionId, String completionStatus);

    /**
     * Record a game attempt (question/answer/move)
     *
     * @param attemptDTO Attempt data
     */
    void recordGameAttempt(AnalyticsGameAttemptDTO attemptDTO);

    /**
     * Record media playback event
     *
     * @param playbackDTO Playback data
     */
    void recordMediaPlayback(AnalyticsMediaPlaybackDTO playbackDTO);

    /**
     * Record a completed streak
     *
     * @param streakDTO Streak data
     */
    void recordStreak(AnalyticsStreakDTO streakDTO);

    /**
     * Get overall usage stats for a user
     *
     * @param macAddress Device MAC address
     * @return Overall usage statistics
     */
    Map<String, Object> getOverallStats(String macAddress);

    /**
     * Get game-specific stats (Math, Riddle, WordLadder)
     *
     * @param macAddress Device MAC address
     * @param gameType   Game type (math_tutor, riddle_solver, word_ladder)
     * @return Game-specific statistics
     */
    AnalyticsUserStatsDTO getGameStats(String macAddress, String gameType);

    /**
     * Get media stats (Music/Story)
     *
     * @param macAddress Device MAC address
     * @param mediaType  Media type (music, story)
     * @return Media statistics
     */
    Map<String, Object> getMediaStats(String macAddress, String mediaType);

    /**
     * Get recent sessions for a user
     *
     * @param macAddress Device MAC address
     * @param limit      Number of sessions to retrieve
     * @return List of recent sessions
     */
    List<AnalyticsGameSessionDTO> getRecentSessions(String macAddress, Integer limit);

    /**
     * Update user progress (aggregated stats)
     * This should be called periodically or after significant game events
     *
     * @param macAddress Device MAC address
     * @param modeType   Mode type
     */
    void updateUserProgress(String macAddress, String modeType);

    /**
     * Get daily usage statistics for a specific date
     *
     * @param macAddress Device MAC address
     * @param date       Target date (defaults to today if null)
     * @return Daily usage statistics with breakdown by character/mode
     */
    AnalyticsDailyUsageDTO getDailyUsage(String macAddress, LocalDate date);

    /**
     * Get weekly usage statistics (last 7 days)
     *
     * @param macAddress Device MAC address
     * @return List of daily usage for the past 7 days
     */
    List<AnalyticsDailyUsageDTO> getWeeklyUsage(String macAddress);

    // ==================== GET APIs ====================

    /**
     * Get session by ID
     *
     * @param id Session ID
     * @return Session details
     */
    AnalyticsGameSessionDTO getSessionById(Long id);

    /**
     * Get sessions list with pagination and filters
     *
     * @param macAddress Device MAC address (optional)
     * @param modeType   Mode type filter (optional)
     * @param startDate  Start date filter (optional)
     * @param endDate    End date filter (optional)
     * @param page       Page number
     * @param limit      Page size
     * @return Paginated session list
     */
    PageData<AnalyticsGameSessionDTO> getSessionsList(String macAddress, String modeType,
            LocalDate startDate, LocalDate endDate,
            Integer page, Integer limit);

    /**
     * Get game attempt by ID
     *
     * @param id Attempt ID
     * @return Attempt details
     */
    AnalyticsGameAttemptDTO getAttemptById(Long id);

    /**
     * Get attempts list with pagination and filters
     *
     * @param macAddress Device MAC address (optional)
     * @param sessionId  Session ID filter (optional)
     * @param gameType   Game type filter (optional)
     * @param page       Page number
     * @param limit      Page size
     * @return Paginated attempts list
     */
    PageData<AnalyticsGameAttemptDTO> getAttemptsList(String macAddress, String sessionId,
            String gameType, Integer page, Integer limit);

    /**
     * Get media playback by ID
     *
     * @param id Playback ID
     * @return Playback details
     */
    AnalyticsMediaPlaybackDTO getMediaPlaybackById(Long id);

    /**
     * Get media playback list with pagination and filters
     *
     * @param macAddress Device MAC address (optional)
     * @param sessionId  Session ID filter (optional)
     * @param mediaType  Media type filter (optional)
     * @param page       Page number
     * @param limit      Page size
     * @return Paginated playback list
     */
    PageData<AnalyticsMediaPlaybackDTO> getMediaPlaybackList(String macAddress, String sessionId,
            String mediaType, Integer page, Integer limit);

    /**
     * Get streak by ID
     *
     * @param id Streak ID
     * @return Streak details
     */
    AnalyticsStreakDTO getStreakById(Long id);

    /**
     * Get streaks list with pagination and filters
     *
     * @param macAddress Device MAC address (optional)
     * @param sessionId  Session ID filter (optional)
     * @param gameType   Game type filter (optional)
     * @param page       Page number
     * @param limit      Page size
     * @return Paginated streaks list
     */
    PageData<AnalyticsStreakDTO> getStreaksList(String macAddress, String sessionId,
            String gameType, Integer page, Integer limit);

    /**
     * Get user progress by MAC and mode
     *
     * @param macAddress Device MAC address
     * @param modeType   Mode type
     * @return User progress for specific mode
     */
    AnalyticsUserProgressEntity getUserProgress(String macAddress, String modeType);

    /**
     * Get all user progress for a MAC address
     *
     * @param macAddress Device MAC address
     * @return List of all progress records for the user
     */
    List<AnalyticsUserProgressEntity> getAllUserProgress(String macAddress);

    /**
     * Get game attempt statistics with breakdown by question type
     *
     * @param macAddress Device MAC address
     * @return Map of game type to attempt statistics
     */
    Map<String, cheeko.modules.agent.dto.GameAttemptStatsDTO> getGameAttemptStats(String macAddress);

    /**
     * Get count of unique devices that interacted today
     *
     * @return Count of unique devices
     */
    Integer getTodayDeviceCount();

    /**
     * Get count of unique devices that interacted this month
     *
     * @return Count of unique devices
     */
    Integer getMonthDeviceCount();
}
