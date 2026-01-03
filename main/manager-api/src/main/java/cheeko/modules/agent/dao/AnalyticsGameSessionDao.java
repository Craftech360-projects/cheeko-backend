package cheeko.modules.agent.dao;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.agent.entity.AnalyticsGameSessionEntity;

/**
 * {@link AnalyticsGameSessionEntity} Analytics Game Session Dao
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Mapper
public interface AnalyticsGameSessionDao extends BaseMapper<AnalyticsGameSessionEntity> {

    /**
     * Get daily usage statistics by MAC address and date
     *
     * @param macAddress Device MAC address
     * @param date Target date
     * @return List of maps containing mode_type, total_seconds, session_count
     */
    @Select("SELECT " +
            "    mode_type, " +
            "    SUM(COALESCE(duration_seconds, 0)) AS total_seconds, " +
            "    COUNT(*) AS session_count " +
            "FROM analytics_game_sessions " +
            "WHERE mac_address = #{macAddress} " +
            "  AND DATE(started_at) = #{date} " +
            "GROUP BY mode_type")
    List<Map<String, Object>> getDailyUsageByMode(@Param("macAddress") String macAddress,
                                                    @Param("date") LocalDate date);

    /**
     * Get weekly usage statistics (last 7 days)
     *
     * @param macAddress Device MAC address
     * @param startDate Start date (7 days ago)
     * @param endDate End date (today)
     * @return List of maps containing date, total_seconds, session_count
     */
    @Select("SELECT " +
            "    DATE(started_at) AS usage_date, " +
            "    SUM(COALESCE(duration_seconds, 0)) AS total_seconds, " +
            "    COUNT(*) AS session_count " +
            "FROM analytics_game_sessions " +
            "WHERE mac_address = #{macAddress} " +
            "  AND DATE(started_at) BETWEEN #{startDate} AND #{endDate} " +
            "GROUP BY DATE(started_at) " +
            "ORDER BY usage_date ASC")
    List<Map<String, Object>> getWeeklyUsage(@Param("macAddress") String macAddress,
                                              @Param("startDate") LocalDate startDate,
                                              @Param("endDate") LocalDate endDate);

    /**
     * Get total usage for a specific date (all modes combined)
     *
     * @param macAddress Device MAC address
     * @param date Target date
     * @return Map containing total_seconds and session_count
     */
    @Select("SELECT " +
            "    SUM(COALESCE(duration_seconds, 0)) AS total_seconds, " +
            "    COUNT(*) AS session_count " +
            "FROM analytics_game_sessions " +
            "WHERE mac_address = #{macAddress} " +
            "  AND DATE(started_at) = #{date}")
    Map<String, Object> getTotalDailyUsage(@Param("macAddress") String macAddress,
                                            @Param("date") LocalDate date);
}
