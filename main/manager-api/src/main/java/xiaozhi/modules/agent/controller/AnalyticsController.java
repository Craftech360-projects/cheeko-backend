package xiaozhi.modules.agent.controller;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.page.PageData;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.agent.dto.AnalyticsDailyUsageDTO;
import xiaozhi.modules.agent.dto.AnalyticsGameAttemptDTO;
import xiaozhi.modules.agent.dto.AnalyticsGameSessionDTO;
import xiaozhi.modules.agent.dto.AnalyticsMediaPlaybackDTO;
import xiaozhi.modules.agent.dto.AnalyticsStreakDTO;
import xiaozhi.modules.agent.dto.AnalyticsUserStatsDTO;
import xiaozhi.modules.agent.entity.AnalyticsUserProgressEntity;
import xiaozhi.modules.agent.service.AnalyticsService;

/**
 * Analytics Controller for game metrics and usage tracking
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Tag(name = "Analytics Management")
@AllArgsConstructor
@RestController
@RequestMapping("/analytics")
@Slf4j
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    @PostMapping("/session/start")
    @Operation(summary = "Start a new game session")
    public Result<String> startSession(@Valid @RequestBody AnalyticsGameSessionDTO sessionDTO) {
        log.info("Starting session for MAC: {}, Mode: {}", sessionDTO.getMacAddress(), sessionDTO.getModeType());

        String sessionId = analyticsService.startSession(sessionDTO);

        return new Result<String>().ok(sessionId);
    }

    @PostMapping("/session/end")
    @Operation(summary = "End a game session")
    public Result<Void> endSession(
            @Parameter(description = "Session ID") @RequestParam String sessionId,
            @Parameter(description = "Completion status") @RequestParam String completionStatus) {
        log.info("Ending session: {}, Status: {}", sessionId, completionStatus);

        analyticsService.endSession(sessionId, completionStatus);

        return new Result<Void>().ok(null);
    }

    @PostMapping("/game-attempt")
    @Operation(summary = "Record a game attempt (question/answer/move)")
    public Result<Void> recordGameAttempt(@Valid @RequestBody AnalyticsGameAttemptDTO attemptDTO) {
        log.debug("Recording game attempt for session: {}", attemptDTO.getSessionId());

        analyticsService.recordGameAttempt(attemptDTO);

        return new Result<Void>().ok(null);
    }

    @PostMapping("/media-event")
    @Operation(summary = "Record media playback event")
    public Result<Void> recordMediaPlayback(@Valid @RequestBody AnalyticsMediaPlaybackDTO playbackDTO) {
        log.debug("Recording media playback for session: {}", playbackDTO.getSessionId());

        analyticsService.recordMediaPlayback(playbackDTO);

        return new Result<Void>().ok(null);
    }

    @PostMapping("/streak")
    @Operation(summary = "Record a completed streak")
    public Result<Void> recordStreak(@Valid @RequestBody AnalyticsStreakDTO streakDTO) {
        log.debug("Recording streak for session: {}, Game: {}, Streak #{}",
                 streakDTO.getSessionId(), streakDTO.getGameType(), streakDTO.getStreakNumber());

        analyticsService.recordStreak(streakDTO);

        return new Result<Void>().ok(null);
    }

    @GetMapping("/user/{macAddress}/overall")
    @Operation(summary = "Get overall usage stats for a user")
    public Result<Map<String, Object>> getOverallStats(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting overall stats for MAC: {}", macAddress);

        Map<String, Object> stats = analyticsService.getOverallStats(macAddress);

        return new Result<Map<String, Object>>().ok(stats);
    }

    @GetMapping("/user/{macAddress}/math")
    @Operation(summary = "Get math game stats")
    public Result<AnalyticsUserStatsDTO> getMathStats(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting math stats for MAC: {}", macAddress);

        AnalyticsUserStatsDTO stats = analyticsService.getGameStats(macAddress, "math_tutor");

        return new Result<AnalyticsUserStatsDTO>().ok(stats);
    }

    @GetMapping("/user/{macAddress}/riddle")
    @Operation(summary = "Get riddle game stats")
    public Result<AnalyticsUserStatsDTO> getRiddleStats(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting riddle stats for MAC: {}", macAddress);

        AnalyticsUserStatsDTO stats = analyticsService.getGameStats(macAddress, "riddle_solver");

        return new Result<AnalyticsUserStatsDTO>().ok(stats);
    }

    @GetMapping("/user/{macAddress}/wordladder")
    @Operation(summary = "Get word ladder game stats")
    public Result<AnalyticsUserStatsDTO> getWordLadderStats(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting word ladder stats for MAC: {}", macAddress);

        AnalyticsUserStatsDTO stats = analyticsService.getGameStats(macAddress, "word_ladder");

        return new Result<AnalyticsUserStatsDTO>().ok(stats);
    }

    @GetMapping("/user/{macAddress}/media")
    @Operation(summary = "Get music/story listening stats")
    public Result<Map<String, Object>> getMediaStats(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress,
            @Parameter(description = "Media type (music or story)") @RequestParam String mediaType) {
        log.info("Getting media stats for MAC: {}, Type: {}", macAddress, mediaType);

        Map<String, Object> stats = analyticsService.getMediaStats(macAddress, mediaType);

        return new Result<Map<String, Object>>().ok(stats);
    }

    @GetMapping("/sessions/{macAddress}")
    @Operation(summary = "Get recent sessions for a user")
    public Result<List<AnalyticsGameSessionDTO>> getRecentSessions(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress,
            @Parameter(description = "Number of sessions to retrieve (default: 30)") @RequestParam(required = false) Integer limit) {
        log.info("Getting recent sessions for MAC: {}, Limit: {}", macAddress, limit);

        List<AnalyticsGameSessionDTO> sessions = analyticsService.getRecentSessions(macAddress, limit);

        return new Result<List<AnalyticsGameSessionDTO>>().ok(sessions);
    }

    @PostMapping("/user-progress/update")
    @Operation(summary = "Update user progress (aggregated stats)")
    public Result<Void> updateUserProgress(
            @Parameter(description = "Device MAC Address") @RequestParam String macAddress,
            @Parameter(description = "Mode type") @RequestParam String modeType) {
        log.info("Updating user progress for MAC: {}, Mode: {}", macAddress, modeType);

        analyticsService.updateUserProgress(macAddress, modeType);

        return new Result<Void>().ok(null);
    }

    @GetMapping("/usage/daily/{macAddress}")
    @Operation(summary = "Get daily usage statistics")
    public Result<AnalyticsDailyUsageDTO> getDailyUsage(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress,
            @Parameter(description = "Date (YYYY-MM-DD), defaults to today")
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        log.info("Getting daily usage for MAC: {}, Date: {}", macAddress, date);

        AnalyticsDailyUsageDTO usage = analyticsService.getDailyUsage(macAddress, date);

        return new Result<AnalyticsDailyUsageDTO>().ok(usage);
    }

    @GetMapping("/usage/weekly/{macAddress}")
    @Operation(summary = "Get weekly usage statistics (last 7 days)")
    public Result<List<AnalyticsDailyUsageDTO>> getWeeklyUsage(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting weekly usage for MAC: {}", macAddress);

        List<AnalyticsDailyUsageDTO> weeklyUsage = analyticsService.getWeeklyUsage(macAddress);

        return new Result<List<AnalyticsDailyUsageDTO>>().ok(weeklyUsage);
    }

    // ==================== GET APIs ====================

    @GetMapping("/sessions/{id}")
    @Operation(summary = "Get session by ID")
    public Result<AnalyticsGameSessionDTO> getSessionById(
            @Parameter(description = "Session ID") @PathVariable Long id) {
        log.info("Getting session by ID: {}", id);

        AnalyticsGameSessionDTO session = analyticsService.getSessionById(id);

        return new Result<AnalyticsGameSessionDTO>().ok(session);
    }

    @GetMapping("/sessions")
    @Operation(summary = "Get sessions list with pagination and filters")
    public Result<PageData<AnalyticsGameSessionDTO>> getSessionsList(
            @Parameter(description = "Device MAC Address") @RequestParam(required = false) String macAddress,
            @Parameter(description = "Mode type") @RequestParam(required = false) String modeType,
            @Parameter(description = "Start date (YYYY-MM-DD)") @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @Parameter(description = "End date (YYYY-MM-DD)") @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @Parameter(description = "Page number (default: 1)") @RequestParam(required = false) Integer page,
            @Parameter(description = "Page size (default: 10)") @RequestParam(required = false) Integer limit) {
        log.info("Getting sessions list - MAC: {}, Mode: {}, StartDate: {}, EndDate: {}, Page: {}, Limit: {}",
                macAddress, modeType, startDate, endDate, page, limit);

        PageData<AnalyticsGameSessionDTO> result = analyticsService.getSessionsList(
                macAddress, modeType, startDate, endDate, page, limit);

        return new Result<PageData<AnalyticsGameSessionDTO>>().ok(result);
    }

    @GetMapping("/attempts/{id}")
    @Operation(summary = "Get game attempt by ID")
    public Result<AnalyticsGameAttemptDTO> getAttemptById(
            @Parameter(description = "Attempt ID") @PathVariable Long id) {
        log.info("Getting attempt by ID: {}", id);

        AnalyticsGameAttemptDTO attempt = analyticsService.getAttemptById(id);

        return new Result<AnalyticsGameAttemptDTO>().ok(attempt);
    }

    @GetMapping("/attempts")
    @Operation(summary = "Get attempts list with pagination and filters")
    public Result<PageData<AnalyticsGameAttemptDTO>> getAttemptsList(
            @Parameter(description = "Device MAC Address") @RequestParam(required = false) String macAddress,
            @Parameter(description = "Session ID") @RequestParam(required = false) String sessionId,
            @Parameter(description = "Game type (math_tutor, riddle_solver, word_ladder)") @RequestParam(required = false) String gameType,
            @Parameter(description = "Page number (default: 1)") @RequestParam(required = false) Integer page,
            @Parameter(description = "Page size (default: 10)") @RequestParam(required = false) Integer limit) {
        log.info("Getting attempts list - MAC: {}, Session: {}, GameType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, gameType, page, limit);

        PageData<AnalyticsGameAttemptDTO> result = analyticsService.getAttemptsList(
                macAddress, sessionId, gameType, page, limit);

        return new Result<PageData<AnalyticsGameAttemptDTO>>().ok(result);
    }

    @GetMapping("/media-playback/{id}")
    @Operation(summary = "Get media playback by ID")
    public Result<AnalyticsMediaPlaybackDTO> getMediaPlaybackById(
            @Parameter(description = "Playback ID") @PathVariable Long id) {
        log.info("Getting media playback by ID: {}", id);

        AnalyticsMediaPlaybackDTO playback = analyticsService.getMediaPlaybackById(id);

        return new Result<AnalyticsMediaPlaybackDTO>().ok(playback);
    }

    @GetMapping("/media-playback")
    @Operation(summary = "Get media playback list with pagination and filters")
    public Result<PageData<AnalyticsMediaPlaybackDTO>> getMediaPlaybackList(
            @Parameter(description = "Device MAC Address") @RequestParam(required = false) String macAddress,
            @Parameter(description = "Session ID") @RequestParam(required = false) String sessionId,
            @Parameter(description = "Media type (music, story)") @RequestParam(required = false) String mediaType,
            @Parameter(description = "Page number (default: 1)") @RequestParam(required = false) Integer page,
            @Parameter(description = "Page size (default: 10)") @RequestParam(required = false) Integer limit) {
        log.info("Getting media playback list - MAC: {}, Session: {}, MediaType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, mediaType, page, limit);

        PageData<AnalyticsMediaPlaybackDTO> result = analyticsService.getMediaPlaybackList(
                macAddress, sessionId, mediaType, page, limit);

        return new Result<PageData<AnalyticsMediaPlaybackDTO>>().ok(result);
    }

    @GetMapping("/streaks/{id}")
    @Operation(summary = "Get streak by ID")
    public Result<AnalyticsStreakDTO> getStreakById(
            @Parameter(description = "Streak ID") @PathVariable Long id) {
        log.info("Getting streak by ID: {}", id);

        AnalyticsStreakDTO streak = analyticsService.getStreakById(id);

        return new Result<AnalyticsStreakDTO>().ok(streak);
    }

    @GetMapping("/streaks")
    @Operation(summary = "Get streaks list with pagination and filters")
    public Result<PageData<AnalyticsStreakDTO>> getStreaksList(
            @Parameter(description = "Device MAC Address") @RequestParam(required = false) String macAddress,
            @Parameter(description = "Session ID") @RequestParam(required = false) String sessionId,
            @Parameter(description = "Game type (math_tutor, riddle_solver, word_ladder)") @RequestParam(required = false) String gameType,
            @Parameter(description = "Page number (default: 1)") @RequestParam(required = false) Integer page,
            @Parameter(description = "Page size (default: 10)") @RequestParam(required = false) Integer limit) {
        log.info("Getting streaks list - MAC: {}, Session: {}, GameType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, gameType, page, limit);

        PageData<AnalyticsStreakDTO> result = analyticsService.getStreaksList(
                macAddress, sessionId, gameType, page, limit);

        return new Result<PageData<AnalyticsStreakDTO>>().ok(result);
    }

    @GetMapping("/user-progress/{macAddress}/{modeType}")
    @Operation(summary = "Get user progress by MAC and mode")
    public Result<AnalyticsUserProgressEntity> getUserProgress(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress,
            @Parameter(description = "Mode type") @PathVariable String modeType) {
        log.info("Getting user progress - MAC: {}, Mode: {}", macAddress, modeType);

        AnalyticsUserProgressEntity progress = analyticsService.getUserProgress(macAddress, modeType);

        return new Result<AnalyticsUserProgressEntity>().ok(progress);
    }

    @GetMapping("/user-progress/{macAddress}")
    @Operation(summary = "Get all user progress for a MAC address")
    public Result<List<AnalyticsUserProgressEntity>> getAllUserProgress(
            @Parameter(description = "Device MAC Address") @PathVariable String macAddress) {
        log.info("Getting all user progress - MAC: {}", macAddress);

        List<AnalyticsUserProgressEntity> progressList = analyticsService.getAllUserProgress(macAddress);

        return new Result<List<AnalyticsUserProgressEntity>>().ok(progressList);
    }
}
