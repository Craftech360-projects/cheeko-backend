package cheeko.modules.device.dao;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Insert;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.device.entity.DeviceTokenUsageEntity;

@Mapper
public interface DeviceTokenUsageDao extends BaseMapper<DeviceTokenUsageEntity> {

    /**
     * Upsert token usage - insert or update if exists for the same mac_address and session_id
     */
    @Insert("INSERT INTO device_token_usage (mac_address, session_id, usage_date, " +
            "input_audio_tokens, input_text_tokens, input_cached_tokens, " +
            "input_tokens, output_tokens, output_audio_tokens, output_text_tokens, " +
            "session_duration_seconds, avg_ttft_seconds, message_count, total_response_duration_seconds, " +
            "session_count, created_at, updated_at) " +
            "VALUES (#{macAddress}, #{sessionId}, #{usageDate}, " +
            "#{inputAudioTokens}, #{inputTextTokens}, #{inputCachedTokens}, " +
            "#{inputTokens}, #{outputTokens}, #{outputAudioTokens}, #{outputTextTokens}, " +
            "#{sessionDurationSeconds}, #{avgTtftSeconds}, #{messageCount}, #{totalResponseDurationSeconds}, " +
            "1, NOW(), NOW()) " +
            "ON DUPLICATE KEY UPDATE " +
            "input_audio_tokens = input_audio_tokens + #{inputAudioTokens}, " +
            "input_text_tokens = input_text_tokens + #{inputTextTokens}, " +
            "input_cached_tokens = input_cached_tokens + #{inputCachedTokens}, " +
            "input_tokens = input_tokens + #{inputTokens}, " +
            "output_tokens = output_tokens + #{outputTokens}, " +
            "output_audio_tokens = output_audio_tokens + #{outputAudioTokens}, " +
            "output_text_tokens = output_text_tokens + #{outputTextTokens}, " +
            "session_duration_seconds = COALESCE(session_duration_seconds, 0) + COALESCE(#{sessionDurationSeconds}, 0), " +
            "avg_ttft_seconds = (COALESCE(avg_ttft_seconds, 0) * COALESCE(message_count, 0) + COALESCE(#{avgTtftSeconds}, 0) * COALESCE(#{messageCount}, 0)) / NULLIF(COALESCE(message_count, 0) + COALESCE(#{messageCount}, 0), 0), " +
            "message_count = COALESCE(message_count, 0) + COALESCE(#{messageCount}, 0), " +
            "total_response_duration_seconds = COALESCE(total_response_duration_seconds, 0) + COALESCE(#{totalResponseDurationSeconds}, 0), " +
            "session_count = session_count + 1, " +
            "updated_at = NOW()")
    int upsertSessionTokenUsage(@Param("macAddress") String macAddress,
                                @Param("sessionId") String sessionId,
                                @Param("usageDate") Date usageDate,
                                @Param("inputAudioTokens") Long inputAudioTokens,
                                @Param("inputTextTokens") Long inputTextTokens,
                                @Param("inputCachedTokens") Long inputCachedTokens,
                                @Param("inputTokens") Long inputTokens,
                                @Param("outputTokens") Long outputTokens,
                                @Param("outputAudioTokens") Long outputAudioTokens,
                                @Param("outputTextTokens") Long outputTextTokens,
                                @Param("sessionDurationSeconds") Double sessionDurationSeconds,
                                @Param("avgTtftSeconds") Double avgTtftSeconds,
                                @Param("messageCount") Integer messageCount,
                                @Param("totalResponseDurationSeconds") Double totalResponseDurationSeconds);

    /**
     * Get usage for a specific session
     */
    @Select("SELECT * FROM device_token_usage WHERE mac_address = #{macAddress} AND session_id = #{sessionId}")
    DeviceTokenUsageEntity getByMacAddressAndSession(@Param("macAddress") String macAddress,
                                                      @Param("sessionId") String sessionId);

    /**
     * Get all usage records for a device
     */
    @Select("SELECT * FROM device_token_usage WHERE mac_address = #{macAddress} ORDER BY created_at DESC")
    List<DeviceTokenUsageEntity> getByMacAddress(@Param("macAddress") String macAddress);

    /**
     * Get total tokens for a device (aggregated across all sessions)
     */
    @Select("SELECT " +
            "COALESCE(SUM(input_audio_tokens), 0) as input_audio_tokens, " +
            "COALESCE(SUM(input_text_tokens), 0) as input_text_tokens, " +
            "COALESCE(SUM(input_cached_tokens), 0) as input_cached_tokens, " +
            "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
            "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
            "COALESCE(SUM(output_audio_tokens), 0) as output_audio_tokens, " +
            "COALESCE(SUM(output_text_tokens), 0) as output_text_tokens, " +
            "COALESCE(SUM(session_duration_seconds), 0) as session_duration_seconds, " +
            "COALESCE(AVG(avg_ttft_seconds), 0) as avg_ttft_seconds, " +
            "COALESCE(SUM(message_count), 0) as message_count, " +
            "COALESCE(SUM(total_response_duration_seconds), 0) as total_response_duration_seconds, " +
            "COUNT(*) as session_count " +
            "FROM device_token_usage WHERE mac_address = #{macAddress}")
    DeviceTokenUsageEntity getTotalByMacAddress(@Param("macAddress") String macAddress);

    /**
     * Get usage for a specific device and date (aggregated across sessions for that day)
     */
    @Select("SELECT " +
            "COALESCE(SUM(input_audio_tokens), 0) as input_audio_tokens, " +
            "COALESCE(SUM(input_text_tokens), 0) as input_text_tokens, " +
            "COALESCE(SUM(input_cached_tokens), 0) as input_cached_tokens, " +
            "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
            "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
            "COALESCE(SUM(output_audio_tokens), 0) as output_audio_tokens, " +
            "COALESCE(SUM(output_text_tokens), 0) as output_text_tokens, " +
            "COALESCE(SUM(session_duration_seconds), 0) as session_duration_seconds, " +
            "COALESCE(AVG(avg_ttft_seconds), 0) as avg_ttft_seconds, " +
            "COALESCE(SUM(message_count), 0) as message_count, " +
            "COALESCE(SUM(total_response_duration_seconds), 0) as total_response_duration_seconds, " +
            "COUNT(*) as session_count " +
            "FROM device_token_usage WHERE mac_address = #{macAddress} AND usage_date = #{usageDate}")
    DeviceTokenUsageEntity getByMacAddressAndDate(@Param("macAddress") String macAddress,
                                                   @Param("usageDate") Date usageDate);

    // ==================== ANALYTICS QUERIES ====================

    /**
     * Get daily summary across all devices
     */
    @Select("SELECT " +
            "usage_date, " +
            "COUNT(DISTINCT mac_address) as unique_devices, " +
            "COUNT(*) as total_sessions, " +
            "COALESCE(SUM(input_audio_tokens), 0) as input_audio_tokens, " +
            "COALESCE(SUM(input_text_tokens), 0) as input_text_tokens, " +
            "COALESCE(SUM(input_cached_tokens), 0) as input_cached_tokens, " +
            "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
            "COALESCE(SUM(output_audio_tokens), 0) as output_audio_tokens, " +
            "COALESCE(SUM(output_text_tokens), 0) as output_text_tokens, " +
            "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
            "COALESCE(SUM(message_count), 0) as message_count, " +
            "COALESCE(AVG(avg_ttft_seconds), 0) as avg_ttft_seconds, " +
            "COALESCE(SUM(session_duration_seconds), 0) as total_duration_seconds, " +
            "COALESCE(AVG(session_duration_seconds), 0) as avg_duration_seconds " +
            "FROM device_token_usage " +
            "WHERE usage_date >= #{startDate} AND usage_date <= #{endDate} " +
            "GROUP BY usage_date " +
            "ORDER BY usage_date DESC")
    List<Map<String, Object>> getDailySummary(@Param("startDate") Date startDate, @Param("endDate") Date endDate);

    /**
     * Get per-device daily usage with owner name
     * Join path: device_token_usage -> ai_device -> ai_agent -> sys_user
     */
    @Select("SELECT " +
            "dtu.mac_address, " +
            "dtu.usage_date, " +
            "COALESCE(su.username, 'Unknown') as owner_name, " +
            "COUNT(*) as session_count, " +
            "COALESCE(SUM(dtu.input_audio_tokens), 0) as input_audio_tokens, " +
            "COALESCE(SUM(dtu.input_text_tokens), 0) as input_text_tokens, " +
            "COALESCE(SUM(dtu.input_tokens), 0) as input_tokens, " +
            "COALESCE(SUM(dtu.output_audio_tokens), 0) as output_audio_tokens, " +
            "COALESCE(SUM(dtu.output_text_tokens), 0) as output_text_tokens, " +
            "COALESCE(SUM(dtu.output_tokens), 0) as output_tokens, " +
            "COALESCE(SUM(dtu.message_count), 0) as message_count, " +
            "COALESCE(AVG(dtu.avg_ttft_seconds), 0) as avg_ttft_seconds, " +
            "COALESCE(SUM(dtu.session_duration_seconds), 0) as total_duration_seconds " +
            "FROM device_token_usage dtu " +
            "LEFT JOIN ai_device ad ON dtu.mac_address COLLATE utf8mb4_unicode_ci = ad.mac_address COLLATE utf8mb4_unicode_ci " +
            "LEFT JOIN ai_agent ag ON ad.agent_id = ag.id " +
            "LEFT JOIN sys_user su ON ag.user_id = su.id " +
            "WHERE dtu.usage_date >= #{startDate} AND dtu.usage_date <= #{endDate} " +
            "GROUP BY dtu.mac_address, dtu.usage_date, su.username " +
            "ORDER BY dtu.usage_date DESC, dtu.mac_address")
    List<Map<String, Object>> getPerDeviceDailyUsage(@Param("startDate") Date startDate, @Param("endDate") Date endDate);

    /**
     * Get overall totals
     */
    @Select("SELECT " +
            "COUNT(DISTINCT mac_address) as unique_devices, " +
            "COUNT(*) as total_sessions, " +
            "COALESCE(SUM(input_audio_tokens), 0) as input_audio_tokens, " +
            "COALESCE(SUM(input_text_tokens), 0) as input_text_tokens, " +
            "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
            "COALESCE(SUM(output_audio_tokens), 0) as output_audio_tokens, " +
            "COALESCE(SUM(output_text_tokens), 0) as output_text_tokens, " +
            "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
            "COALESCE(SUM(message_count), 0) as total_messages, " +
            "COALESCE(AVG(avg_ttft_seconds), 0) as avg_ttft_seconds, " +
            "COALESCE(SUM(session_duration_seconds), 0) as total_duration_seconds " +
            "FROM device_token_usage")
    Map<String, Object> getOverallTotals();
}
