package xiaozhi.modules.agent.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.page.PageData;
import xiaozhi.common.utils.ConvertUtils;
import xiaozhi.modules.agent.dao.AnalyticsGameAttemptDao;
import xiaozhi.modules.agent.dao.AnalyticsGameSessionDao;
import xiaozhi.modules.agent.dao.AnalyticsMediaPlaybackDao;
import xiaozhi.modules.agent.dao.AnalyticsStreakDao;
import xiaozhi.modules.agent.dao.AnalyticsUserProgressDao;
import xiaozhi.modules.agent.dto.AnalyticsDailyUsageDTO;
import xiaozhi.modules.agent.dto.AnalyticsGameAttemptDTO;
import xiaozhi.modules.agent.dto.AnalyticsGameSessionDTO;
import xiaozhi.modules.agent.dto.AnalyticsMediaPlaybackDTO;
import xiaozhi.modules.agent.dto.AnalyticsStreakDTO;
import xiaozhi.modules.agent.dto.AnalyticsUserStatsDTO;
import xiaozhi.modules.agent.entity.AnalyticsGameAttemptEntity;
import xiaozhi.modules.agent.entity.AnalyticsGameSessionEntity;
import xiaozhi.modules.agent.entity.AnalyticsMediaPlaybackEntity;
import xiaozhi.modules.agent.entity.AnalyticsStreakEntity;
import xiaozhi.modules.agent.entity.AnalyticsUserProgressEntity;
import xiaozhi.modules.agent.service.AnalyticsService;

/**
 * Analytics Service Implementation
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Slf4j
@Service
public class AnalyticsServiceImpl implements AnalyticsService {

    @Autowired
    private AnalyticsGameSessionDao gameSessionDao;

    @Autowired
    private AnalyticsGameAttemptDao gameAttemptDao;

    @Autowired
    private AnalyticsMediaPlaybackDao mediaPlaybackDao;

    @Autowired
    private AnalyticsUserProgressDao userProgressDao;

    @Autowired
    private AnalyticsStreakDao streakDao;

    @Override
    @Transactional
    public String startSession(AnalyticsGameSessionDTO sessionDTO) {
        log.info("Starting session for MAC: {}, Mode: {}", sessionDTO.getMacAddress(), sessionDTO.getModeType());

        AnalyticsGameSessionEntity entity = new AnalyticsGameSessionEntity();
        BeanUtils.copyProperties(sessionDTO, entity);
        entity.setStartedAt(new Date());
        entity.setCreatedAt(new Date());
        entity.setUpdatedAt(new Date());

        gameSessionDao.insert(entity);

        return sessionDTO.getSessionId();
    }

    @Override
    @Transactional
    public void endSession(String sessionId, String completionStatus) {
        log.info("Ending session: {}, Status: {}", sessionId, completionStatus);

        QueryWrapper<AnalyticsGameSessionEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("session_id", sessionId);
        AnalyticsGameSessionEntity entity = gameSessionDao.selectOne(wrapper);

        if (entity != null) {
            entity.setEndedAt(new Date());
            entity.setCompletionStatus(completionStatus);

            // Calculate duration in seconds
            if (entity.getStartedAt() != null && entity.getEndedAt() != null) {
                long durationMs = entity.getEndedAt().getTime() - entity.getStartedAt().getTime();
                entity.setDurationSeconds((int) (durationMs / 1000));
            }

            entity.setUpdatedAt(new Date());
            gameSessionDao.updateById(entity);

            // Update user progress after session ends
            if (entity.getMacAddress() != null && entity.getModeType() != null) {
                updateUserProgress(entity.getMacAddress(), entity.getModeType());
            }
        }
    }

    @Override
    @Transactional
    public void recordGameAttempt(AnalyticsGameAttemptDTO attemptDTO) {
        log.debug("Recording game attempt for session: {}, Type: {}",
                 attemptDTO.getSessionId(), attemptDTO.getGameType());

        AnalyticsGameAttemptEntity entity = new AnalyticsGameAttemptEntity();
        BeanUtils.copyProperties(attemptDTO, entity);
        entity.setCreatedAt(new Date());

        gameAttemptDao.insert(entity);

        // Update session interaction count
        updateSessionInteractionCount(attemptDTO.getSessionId());
    }

    @Override
    @Transactional
    public void recordMediaPlayback(AnalyticsMediaPlaybackDTO playbackDTO) {
        log.debug("Recording media playback for session: {}, Type: {}, Title: {}",
                 playbackDTO.getSessionId(), playbackDTO.getMediaType(), playbackDTO.getMediaTitle());

        AnalyticsMediaPlaybackEntity entity = new AnalyticsMediaPlaybackEntity();
        BeanUtils.copyProperties(playbackDTO, entity);
        entity.setCreatedAt(new Date());

        // Calculate completion percentage if both durations are provided
        if (playbackDTO.getDurationPlayedSeconds() != null &&
            playbackDTO.getTotalDurationSeconds() != null &&
            playbackDTO.getTotalDurationSeconds() > 0) {
            BigDecimal percentage = new BigDecimal(playbackDTO.getDurationPlayedSeconds())
                    .multiply(new BigDecimal(100))
                    .divide(new BigDecimal(playbackDTO.getTotalDurationSeconds()), 2, RoundingMode.HALF_UP);
            entity.setCompletionPercentage(percentage);
        }

        mediaPlaybackDao.insert(entity);

        // Update session interaction count
        updateSessionInteractionCount(playbackDTO.getSessionId());
    }

    @Override
    @Transactional
    public void recordStreak(AnalyticsStreakDTO streakDTO) {
        log.info("Recording streak for session: {}, Game: {}, Streak #{}, Questions: {}",
                 streakDTO.getSessionId(), streakDTO.getGameType(),
                 streakDTO.getStreakNumber(), streakDTO.getQuestionsInStreak());

        AnalyticsStreakEntity entity = new AnalyticsStreakEntity();
        BeanUtils.copyProperties(streakDTO, entity);
        entity.setCreatedAt(new Date());

        // Calculate duration if not provided
        if (entity.getDurationSeconds() == null &&
            streakDTO.getStartedAt() != null &&
            streakDTO.getEndedAt() != null) {
            long durationMs = streakDTO.getEndedAt().getTime() - streakDTO.getStartedAt().getTime();
            entity.setDurationSeconds((int) (durationMs / 1000));
        }

        streakDao.insert(entity);

        // Update user progress with streak stats
        updateUserProgressWithStreak(streakDTO.getMacAddress(), streakDTO.getGameType(),
                                     streakDTO.getQuestionsInStreak(), entity.getDurationSeconds());
    }

    @Override
    public Map<String, Object> getOverallStats(String macAddress) {
        log.info("Getting overall stats for MAC: {}", macAddress);

        Map<String, Object> stats = new HashMap<>();

        // Get all sessions for this user
        QueryWrapper<AnalyticsGameSessionEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress);
        List<AnalyticsGameSessionEntity> sessions = gameSessionDao.selectList(wrapper);

        stats.put("totalSessions", sessions.size());

        // Calculate total time
        long totalSeconds = sessions.stream()
                .filter(s -> s.getDurationSeconds() != null)
                .mapToLong(AnalyticsGameSessionEntity::getDurationSeconds)
                .sum();
        stats.put("totalTimeSeconds", totalSeconds);
        stats.put("totalTimeMinutes", totalSeconds / 60);

        // Calculate total interactions
        int totalInteractions = sessions.stream()
                .filter(s -> s.getInteractionCount() != null)
                .mapToInt(AnalyticsGameSessionEntity::getInteractionCount)
                .sum();
        stats.put("totalInteractions", totalInteractions);

        // Get mode distribution
        Map<String, Long> modeDistribution = sessions.stream()
                .filter(s -> s.getModeType() != null)
                .collect(Collectors.groupingBy(
                        AnalyticsGameSessionEntity::getModeType,
                        Collectors.counting()
                ));
        stats.put("modeDistribution", modeDistribution);

        // Find most used mode
        String mostUsedMode = modeDistribution.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
        stats.put("mostUsedMode", mostUsedMode);

        return stats;
    }

    @Override
    public AnalyticsUserStatsDTO getGameStats(String macAddress, String gameType) {
        log.info("Getting game stats for MAC: {}, Game: {}", macAddress, gameType);

        AnalyticsUserStatsDTO stats = new AnalyticsUserStatsDTO();
        stats.setMacAddress(macAddress);
        stats.setModeType(gameType);

        // Get all attempts for this game type
        QueryWrapper<AnalyticsGameAttemptEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress)
               .eq("game_type", gameType);
        List<AnalyticsGameAttemptEntity> attempts = gameAttemptDao.selectList(wrapper);

        stats.setTotalInteractions(attempts.size());

        // Calculate correct/incorrect
        long correctCount = attempts.stream()
                .filter(a -> a.getIsCorrect() != null && a.getIsCorrect())
                .count();
        long incorrectCount = attempts.stream()
                .filter(a -> a.getIsCorrect() != null && !a.getIsCorrect())
                .count();

        stats.setTotalCorrect((int) correctCount);
        stats.setTotalIncorrect((int) incorrectCount);

        // Calculate success rate
        if (correctCount + incorrectCount > 0) {
            BigDecimal successRate = new BigDecimal(correctCount)
                    .multiply(new BigDecimal(100))
                    .divide(new BigDecimal(correctCount + incorrectCount), 2, RoundingMode.HALF_UP);
            stats.setSuccessRatePercentage(successRate);
        }

        // Calculate average response time
        double avgResponseTime = attempts.stream()
                .filter(a -> a.getResponseTimeMs() != null)
                .mapToInt(AnalyticsGameAttemptEntity::getResponseTimeMs)
                .average()
                .orElse(0.0);
        stats.setAvgResponseTimeMs((int) avgResponseTime);

        // Get user progress for this game type
        QueryWrapper<AnalyticsUserProgressEntity> progressWrapper = new QueryWrapper<>();
        progressWrapper.eq("mac_address", macAddress)
                      .eq("mode_type", gameType);
        AnalyticsUserProgressEntity progress = userProgressDao.selectOne(progressWrapper);

        if (progress != null) {
            stats.setTotalSessions(progress.getTotalSessions());
            stats.setTotalTimeSeconds(progress.getTotalTimeSeconds());
            stats.setLongestStreak(progress.getLongestStreak());
            stats.setSkillLevel(progress.getSkillLevel());
        }

        return stats;
    }

    @Override
    public Map<String, Object> getMediaStats(String macAddress, String mediaType) {
        log.info("Getting media stats for MAC: {}, Type: {}", macAddress, mediaType);

        Map<String, Object> stats = new HashMap<>();

        // Get all playback events for this media type
        QueryWrapper<AnalyticsMediaPlaybackEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress)
               .eq("media_type", mediaType);
        List<AnalyticsMediaPlaybackEntity> playbacks = mediaPlaybackDao.selectList(wrapper);

        stats.put("totalPlayed", playbacks.size());

        // Calculate total listening time
        int totalSeconds = playbacks.stream()
                .filter(p -> p.getDurationPlayedSeconds() != null)
                .mapToInt(AnalyticsMediaPlaybackEntity::getDurationPlayedSeconds)
                .sum();
        stats.put("totalListeningTimeSeconds", totalSeconds);
        stats.put("totalListeningTimeMinutes", totalSeconds / 60);

        // Get most played items
        Map<String, Long> mediaFrequency = playbacks.stream()
                .filter(p -> p.getMediaTitle() != null)
                .collect(Collectors.groupingBy(
                        AnalyticsMediaPlaybackEntity::getMediaTitle,
                        Collectors.counting()
                ));
        stats.put("mediaFrequency", mediaFrequency);

        List<Map.Entry<String, Long>> topMedia = mediaFrequency.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(10)
                .collect(Collectors.toList());
        stats.put("topPlayed", topMedia);

        // Calculate completion rate
        long completedCount = playbacks.stream()
                .filter(p -> p.getCompletionPercentage() != null &&
                           p.getCompletionPercentage().compareTo(new BigDecimal(80)) >= 0)
                .count();
        if (playbacks.size() > 0) {
            BigDecimal completionRate = new BigDecimal(completedCount)
                    .multiply(new BigDecimal(100))
                    .divide(new BigDecimal(playbacks.size()), 2, RoundingMode.HALF_UP);
            stats.put("completionRatePercentage", completionRate);
        }

        // Count skip actions
        long skipCount = playbacks.stream()
                .filter(p -> p.getSkipAction() != null)
                .count();
        stats.put("totalSkips", skipCount);

        return stats;
    }

    @Override
    public List<AnalyticsGameSessionDTO> getRecentSessions(String macAddress, Integer limit) {
        log.info("Getting recent {} sessions for MAC: {}", limit, macAddress);

        QueryWrapper<AnalyticsGameSessionEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress)
               .orderByDesc("started_at")
               .last("LIMIT " + (limit != null ? limit : 30));

        List<AnalyticsGameSessionEntity> entities = gameSessionDao.selectList(wrapper);

        return entities.stream()
                .map(this::convertToSessionDTO)
                .collect(Collectors.toList());
    }

    @Override
    @Transactional
    public void updateUserProgress(String macAddress, String modeType) {
        log.debug("Updating user progress for MAC: {}, Mode: {}", macAddress, modeType);

        // Get or create progress entity
        QueryWrapper<AnalyticsUserProgressEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress)
               .eq("mode_type", modeType);
        AnalyticsUserProgressEntity progress = userProgressDao.selectOne(wrapper);

        if (progress == null) {
            progress = new AnalyticsUserProgressEntity();
            progress.setMacAddress(macAddress);
            progress.setModeType(modeType);
            progress.setTotalSessions(0);
            progress.setTotalTimeSeconds(0L);
            progress.setTotalInteractions(0);
            progress.setLongestStreak(0);
            progress.setCreatedAt(new Date());
        }

        // Aggregate session data
        QueryWrapper<AnalyticsGameSessionEntity> sessionWrapper = new QueryWrapper<>();
        sessionWrapper.eq("mac_address", macAddress)
                     .eq("mode_type", modeType);
        List<AnalyticsGameSessionEntity> sessions = gameSessionDao.selectList(sessionWrapper);

        progress.setTotalSessions(sessions.size());

        long totalSeconds = sessions.stream()
                .filter(s -> s.getDurationSeconds() != null)
                .mapToLong(AnalyticsGameSessionEntity::getDurationSeconds)
                .sum();
        progress.setTotalTimeSeconds(totalSeconds);

        int totalInteractions = sessions.stream()
                .filter(s -> s.getInteractionCount() != null)
                .mapToInt(AnalyticsGameSessionEntity::getInteractionCount)
                .sum();
        progress.setTotalInteractions(totalInteractions);

        // For game modes, calculate success rate from attempts
        if (modeType.contains("math") || modeType.contains("riddle") || modeType.contains("word")) {
            QueryWrapper<AnalyticsGameAttemptEntity> attemptWrapper = new QueryWrapper<>();
            attemptWrapper.eq("mac_address", macAddress)
                         .eq("game_type", modeType);
            List<AnalyticsGameAttemptEntity> attempts = gameAttemptDao.selectList(attemptWrapper);

            if (!attempts.isEmpty()) {
                long correctCount = attempts.stream()
                        .filter(a -> a.getIsCorrect() != null && a.getIsCorrect())
                        .count();
                BigDecimal successRate = new BigDecimal(correctCount)
                        .multiply(new BigDecimal(100))
                        .divide(new BigDecimal(attempts.size()), 2, RoundingMode.HALF_UP);
                progress.setSuccessRatePercentage(successRate);

                // Determine skill level based on success rate
                if (successRate.compareTo(new BigDecimal(80)) >= 0) {
                    progress.setSkillLevel("advanced");
                } else if (successRate.compareTo(new BigDecimal(50)) >= 0) {
                    progress.setSkillLevel("intermediate");
                } else {
                    progress.setSkillLevel("beginner");
                }
            }
        }

        progress.setLastPlayedAt(new Date());
        progress.setUpdatedAt(new Date());

        // Insert or update
        if (progress.getId() == null) {
            userProgressDao.insert(progress);
        } else {
            userProgressDao.updateById(progress);
        }
    }

    /**
     * Update session interaction count
     */
    private void updateSessionInteractionCount(String sessionId) {
        QueryWrapper<AnalyticsGameSessionEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("session_id", sessionId);
        AnalyticsGameSessionEntity session = gameSessionDao.selectOne(wrapper);

        if (session != null) {
            Integer currentCount = session.getInteractionCount();
            session.setInteractionCount(currentCount != null ? currentCount + 1 : 1);
            session.setUpdatedAt(new Date());
            gameSessionDao.updateById(session);
        }
    }

    /**
     * Update user progress with streak data
     */
    private void updateUserProgressWithStreak(String macAddress, String gameType, int streakLength, int durationSeconds) {
        QueryWrapper<AnalyticsUserProgressEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress)
               .eq("mode_type", gameType);

        AnalyticsUserProgressEntity progress = userProgressDao.selectOne(wrapper);

        if (progress != null) {
            // Update longest streak if this one is bigger
            if (progress.getLongestStreak() == null || streakLength > progress.getLongestStreak()) {
                progress.setLongestStreak(streakLength);
            }

            // Increment total streaks completed
            Integer totalStreaks = progress.getTotalStreaksCompleted();
            progress.setTotalStreaksCompleted(totalStreaks != null ? totalStreaks + 1 : 1);

            // Update average streak time
            Integer currentAvg = progress.getAverageStreakTimeSeconds();
            Integer totalStreaksCount = progress.getTotalStreaksCompleted();
            if (currentAvg != null && totalStreaksCount > 1) {
                // Calculate new average: ((old_avg * (count-1)) + new_time) / count
                int newAvg = ((currentAvg * (totalStreaksCount - 1)) + durationSeconds) / totalStreaksCount;
                progress.setAverageStreakTimeSeconds(newAvg);
            } else {
                progress.setAverageStreakTimeSeconds(durationSeconds);
            }

            progress.setUpdatedAt(new Date());
            userProgressDao.updateById(progress);

            log.debug("Updated streak stats for MAC: {}, Game: {}, Longest: {}, Total: {}, Avg Time: {}s",
                     macAddress, gameType, progress.getLongestStreak(),
                     progress.getTotalStreaksCompleted(), progress.getAverageStreakTimeSeconds());
        }
    }

    /**
     * Convert entity to DTO
     */
    private AnalyticsGameSessionDTO convertToSessionDTO(AnalyticsGameSessionEntity entity) {
        AnalyticsGameSessionDTO dto = new AnalyticsGameSessionDTO();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }

    @Override
    public AnalyticsDailyUsageDTO getDailyUsage(String macAddress, LocalDate date) {
        // Default to today if no date provided
        LocalDate targetDate = (date != null) ? date : LocalDate.now();

        log.info("Getting daily usage for MAC: {}, Date: {}", macAddress, targetDate);

        // Get usage breakdown by mode/character
        List<Map<String, Object>> usageByMode = gameSessionDao.getDailyUsageByMode(macAddress, targetDate);

        // Build breakdown map
        Map<String, AnalyticsDailyUsageDTO.CharacterUsage> breakdown = new LinkedHashMap<>();
        long totalSeconds = 0;
        int totalSessions = 0;

        for (Map<String, Object> row : usageByMode) {
            String modeType = (String) row.get("mode_type");
            Long seconds = ((Number) row.get("total_seconds")).longValue();
            Integer sessions = ((Number) row.get("session_count")).intValue();

            totalSeconds += seconds;
            totalSessions += sessions;

            AnalyticsDailyUsageDTO.CharacterUsage characterUsage = AnalyticsDailyUsageDTO.CharacterUsage.builder()
                    .seconds(seconds)
                    .minutes(seconds / 60)
                    .sessions(sessions)
                    .build();

            breakdown.put(modeType, characterUsage);
        }

        // Calculate total usage in minutes and hours
        long totalMinutes = totalSeconds / 60;
        BigDecimal totalHours = BigDecimal.valueOf(totalSeconds)
                .divide(BigDecimal.valueOf(3600), 2, RoundingMode.HALF_UP);

        // Build response DTO
        return AnalyticsDailyUsageDTO.builder()
                .date(targetDate)
                .macAddress(macAddress)
                .totalUsageSeconds(totalSeconds)
                .totalUsageMinutes(totalMinutes)
                .totalUsageHours(totalHours)
                .sessionCount(totalSessions)
                .breakdownByCharacter(breakdown)
                .build();
    }

    @Override
    public List<AnalyticsDailyUsageDTO> getWeeklyUsage(String macAddress) {
        log.info("Getting weekly usage for MAC: {}", macAddress);

        LocalDate today = LocalDate.now();
        LocalDate sevenDaysAgo = today.minusDays(6); // Last 7 days including today

        List<AnalyticsDailyUsageDTO> weeklyUsage = new ArrayList<>();

        // Get daily usage for each day in the past 7 days
        for (LocalDate date = sevenDaysAgo; !date.isAfter(today); date = date.plusDays(1)) {
            AnalyticsDailyUsageDTO dailyUsage = getDailyUsage(macAddress, date);
            weeklyUsage.add(dailyUsage);
        }

        return weeklyUsage;
    }

    // ==================== GET APIs ====================

    @Override
    public AnalyticsGameSessionDTO getSessionById(Long id) {
        log.info("Getting session by ID: {}", id);

        AnalyticsGameSessionEntity entity = gameSessionDao.selectById(id);
        if (entity == null) {
            return null;
        }

        AnalyticsGameSessionDTO dto = new AnalyticsGameSessionDTO();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }

    @Override
    public PageData<AnalyticsGameSessionDTO> getSessionsList(String macAddress, String modeType,
                                                              LocalDate startDate, LocalDate endDate,
                                                              Integer page, Integer limit) {
        log.info("Getting sessions list - MAC: {}, Mode: {}, StartDate: {}, EndDate: {}, Page: {}, Limit: {}",
                macAddress, modeType, startDate, endDate, page, limit);

        // Build query wrapper with filters
        QueryWrapper<AnalyticsGameSessionEntity> wrapper = new QueryWrapper<>();

        if (macAddress != null && !macAddress.isEmpty()) {
            wrapper.eq("mac_address", macAddress);
        }
        if (modeType != null && !modeType.isEmpty()) {
            wrapper.eq("mode_type", modeType);
        }
        if (startDate != null) {
            wrapper.ge("DATE(started_at)", startDate);
        }
        if (endDate != null) {
            wrapper.le("DATE(started_at)", endDate);
        }

        wrapper.orderByDesc("started_at");

        // Pagination
        IPage<AnalyticsGameSessionEntity> pageParam = new Page<>(page != null ? page : 1, limit != null ? limit : 10);
        IPage<AnalyticsGameSessionEntity> pageData = gameSessionDao.selectPage(pageParam, wrapper);

        // Convert to DTO
        return new PageData<>(
                ConvertUtils.sourceToTarget(pageData.getRecords(), AnalyticsGameSessionDTO.class),
                pageData.getTotal()
        );
    }

    @Override
    public AnalyticsGameAttemptDTO getAttemptById(Long id) {
        log.info("Getting attempt by ID: {}", id);

        AnalyticsGameAttemptEntity entity = gameAttemptDao.selectById(id);
        if (entity == null) {
            return null;
        }

        AnalyticsGameAttemptDTO dto = new AnalyticsGameAttemptDTO();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }

    @Override
    public PageData<AnalyticsGameAttemptDTO> getAttemptsList(String macAddress, String sessionId,
                                                              String gameType, Integer page, Integer limit) {
        log.info("Getting attempts list - MAC: {}, Session: {}, GameType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, gameType, page, limit);

        // Build query wrapper with filters
        QueryWrapper<AnalyticsGameAttemptEntity> wrapper = new QueryWrapper<>();

        if (macAddress != null && !macAddress.isEmpty()) {
            wrapper.eq("mac_address", macAddress);
        }
        if (sessionId != null && !sessionId.isEmpty()) {
            wrapper.eq("session_id", sessionId);
        }
        if (gameType != null && !gameType.isEmpty()) {
            wrapper.eq("game_type", gameType);
        }

        wrapper.orderByDesc("answered_at");

        // Pagination
        IPage<AnalyticsGameAttemptEntity> pageParam = new Page<>(page != null ? page : 1, limit != null ? limit : 10);
        IPage<AnalyticsGameAttemptEntity> pageData = gameAttemptDao.selectPage(pageParam, wrapper);

        // Convert to DTO
        return new PageData<>(
                ConvertUtils.sourceToTarget(pageData.getRecords(), AnalyticsGameAttemptDTO.class),
                pageData.getTotal()
        );
    }

    @Override
    public AnalyticsMediaPlaybackDTO getMediaPlaybackById(Long id) {
        log.info("Getting media playback by ID: {}", id);

        AnalyticsMediaPlaybackEntity entity = mediaPlaybackDao.selectById(id);
        if (entity == null) {
            return null;
        }

        AnalyticsMediaPlaybackDTO dto = new AnalyticsMediaPlaybackDTO();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }

    @Override
    public PageData<AnalyticsMediaPlaybackDTO> getMediaPlaybackList(String macAddress, String sessionId,
                                                                     String mediaType, Integer page, Integer limit) {
        log.info("Getting media playback list - MAC: {}, Session: {}, MediaType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, mediaType, page, limit);

        // Build query wrapper with filters
        QueryWrapper<AnalyticsMediaPlaybackEntity> wrapper = new QueryWrapper<>();

        if (macAddress != null && !macAddress.isEmpty()) {
            wrapper.eq("mac_address", macAddress);
        }
        if (sessionId != null && !sessionId.isEmpty()) {
            wrapper.eq("session_id", sessionId);
        }
        if (mediaType != null && !mediaType.isEmpty()) {
            wrapper.eq("media_type", mediaType);
        }

        wrapper.orderByDesc("started_at");

        // Pagination
        IPage<AnalyticsMediaPlaybackEntity> pageParam = new Page<>(page != null ? page : 1, limit != null ? limit : 10);
        IPage<AnalyticsMediaPlaybackEntity> pageData = mediaPlaybackDao.selectPage(pageParam, wrapper);

        // Convert to DTO
        return new PageData<>(
                ConvertUtils.sourceToTarget(pageData.getRecords(), AnalyticsMediaPlaybackDTO.class),
                pageData.getTotal()
        );
    }

    @Override
    public AnalyticsStreakDTO getStreakById(Long id) {
        log.info("Getting streak by ID: {}", id);

        AnalyticsStreakEntity entity = streakDao.selectById(id);
        if (entity == null) {
            return null;
        }

        AnalyticsStreakDTO dto = new AnalyticsStreakDTO();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }

    @Override
    public PageData<AnalyticsStreakDTO> getStreaksList(String macAddress, String sessionId,
                                                        String gameType, Integer page, Integer limit) {
        log.info("Getting streaks list - MAC: {}, Session: {}, GameType: {}, Page: {}, Limit: {}",
                macAddress, sessionId, gameType, page, limit);

        // Build query wrapper with filters
        QueryWrapper<AnalyticsStreakEntity> wrapper = new QueryWrapper<>();

        if (macAddress != null && !macAddress.isEmpty()) {
            wrapper.eq("mac_address", macAddress);
        }
        if (sessionId != null && !sessionId.isEmpty()) {
            wrapper.eq("session_id", sessionId);
        }
        if (gameType != null && !gameType.isEmpty()) {
            wrapper.eq("game_type", gameType);
        }

        wrapper.orderByDesc("ended_at");

        // Pagination
        IPage<AnalyticsStreakEntity> pageParam = new Page<>(page != null ? page : 1, limit != null ? limit : 10);
        IPage<AnalyticsStreakEntity> pageData = streakDao.selectPage(pageParam, wrapper);

        // Convert to DTO
        return new PageData<>(
                ConvertUtils.sourceToTarget(pageData.getRecords(), AnalyticsStreakDTO.class),
                pageData.getTotal()
        );
    }

    @Override
    public AnalyticsUserProgressEntity getUserProgress(String macAddress, String modeType) {
        log.info("Getting user progress - MAC: {}, Mode: {}", macAddress, modeType);

        QueryWrapper<AnalyticsUserProgressEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress);
        wrapper.eq("mode_type", modeType);

        return userProgressDao.selectOne(wrapper);
    }

    @Override
    public List<AnalyticsUserProgressEntity> getAllUserProgress(String macAddress) {
        log.info("Getting all user progress - MAC: {}", macAddress);

        QueryWrapper<AnalyticsUserProgressEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress);
        wrapper.orderByDesc("last_played_at");

        return userProgressDao.selectList(wrapper);
    }
}
