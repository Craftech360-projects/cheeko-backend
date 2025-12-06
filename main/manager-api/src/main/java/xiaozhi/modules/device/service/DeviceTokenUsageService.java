package xiaozhi.modules.device.service;

import java.util.List;

import xiaozhi.common.service.BaseService;
import xiaozhi.modules.device.dto.TokenUsageDTO;
import xiaozhi.modules.device.entity.DeviceTokenUsageEntity;

public interface DeviceTokenUsageService extends BaseService<DeviceTokenUsageEntity> {

    /**
     * Record token usage for a device session
     *
     * @param macAddress Device MAC address
     * @param inputTokens Number of input tokens
     * @param outputTokens Number of output tokens
     * @return true if successful
     */
    boolean recordTokenUsage(String macAddress, Long inputTokens, Long outputTokens);

    /**
     * Get today's usage for a device
     *
     * @param macAddress Device MAC address
     * @return Token usage entity or null
     */
    DeviceTokenUsageEntity getTodayUsage(String macAddress);

    /**
     * Get all usage history for a device
     *
     * @param macAddress Device MAC address
     * @return List of usage records
     */
    List<DeviceTokenUsageEntity> getUsageHistory(String macAddress);

    /**
     * Get total tokens used by a device
     *
     * @param macAddress Device MAC address
     * @return TokenUsageDTO with totals
     */
    TokenUsageDTO getTotalUsage(String macAddress);
}
