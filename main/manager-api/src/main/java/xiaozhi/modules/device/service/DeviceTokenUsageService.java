package xiaozhi.modules.device.service;

import java.util.Date;
import java.util.List;
import java.util.Map;

import xiaozhi.common.service.BaseService;
import xiaozhi.modules.device.dto.TokenUsageDTO;
import xiaozhi.modules.device.entity.DeviceTokenUsageEntity;

public interface DeviceTokenUsageService extends BaseService<DeviceTokenUsageEntity> {

    /**
     * Record token usage for a device session with full breakdown
     */
    boolean recordSessionTokenUsage(TokenUsageDTO dto);

    /**
     * Get usage for a specific session
     */
    DeviceTokenUsageEntity getSessionUsage(String macAddress, String sessionId);

    /**
     * Get today's usage for a device (aggregated)
     */
    DeviceTokenUsageEntity getTodayUsage(String macAddress);

    /**
     * Get all usage history for a device
     */
    List<DeviceTokenUsageEntity> getUsageHistory(String macAddress);

    /**
     * Get total tokens used by a device (aggregated across all sessions)
     */
    TokenUsageDTO getTotalUsage(String macAddress);

    // ==================== ANALYTICS ====================

    /**
     * Get daily summary across all devices
     */
    List<Map<String, Object>> getDailySummary(Date startDate, Date endDate);

    /**
     * Get per-device daily usage
     */
    List<Map<String, Object>> getPerDeviceDailyUsage(Date startDate, Date endDate);

    /**
     * Get overall totals
     */
    Map<String, Object> getOverallTotals();

    /**
     * Calculate cost in INR for given token counts
     * Gemini pricing (in INR, assuming 1 USD = 83.33 INR):
     * - Text Input: ₹6.25/1M tokens ($0.075/1M)
     * - Audio Input: ₹83.33/1M tokens ($1.00/1M)
     * - Text Output: ₹25/1M tokens ($0.30/1M)
     * - Audio Output: ₹333.33/1M tokens ($4.00/1M)
     */
    double calculateCostInINR(long inputTextTokens, long inputAudioTokens,
                               long outputTextTokens, long outputAudioTokens);
}
