package xiaozhi.modules.device.dao;

import java.util.Date;
import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import xiaozhi.modules.device.entity.DeviceTokenUsageEntity;

@Mapper
public interface DeviceTokenUsageDao extends BaseMapper<DeviceTokenUsageEntity> {

    /**
     * Upsert token usage - insert or update if exists for the same mac_address and date
     */
    @Insert("INSERT INTO device_token_usage (mac_address, usage_date, input_tokens, output_tokens, session_count, created_at, updated_at) " +
            "VALUES (#{macAddress}, #{usageDate}, #{inputTokens}, #{outputTokens}, 1, NOW(), NOW()) " +
            "ON DUPLICATE KEY UPDATE " +
            "input_tokens = input_tokens + #{inputTokens}, " +
            "output_tokens = output_tokens + #{outputTokens}, " +
            "session_count = session_count + 1, " +
            "updated_at = NOW()")
    int upsertTokenUsage(@Param("macAddress") String macAddress,
                         @Param("usageDate") Date usageDate,
                         @Param("inputTokens") Long inputTokens,
                         @Param("outputTokens") Long outputTokens);

    /**
     * Get usage for a specific device and date
     */
    @Select("SELECT * FROM device_token_usage WHERE mac_address = #{macAddress} AND usage_date = #{usageDate}")
    DeviceTokenUsageEntity getByMacAddressAndDate(@Param("macAddress") String macAddress,
                                                   @Param("usageDate") Date usageDate);

    /**
     * Get all usage records for a device
     */
    @Select("SELECT * FROM device_token_usage WHERE mac_address = #{macAddress} ORDER BY usage_date DESC")
    List<DeviceTokenUsageEntity> getByMacAddress(@Param("macAddress") String macAddress);

    /**
     * Get total tokens for a device
     */
    @Select("SELECT COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens " +
            "FROM device_token_usage WHERE mac_address = #{macAddress}")
    DeviceTokenUsageEntity getTotalByMacAddress(@Param("macAddress") String macAddress);
}
