package cheeko.modules.device.service.impl;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import lombok.extern.slf4j.Slf4j;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.modules.device.dao.DeviceTokenUsageDao;
import cheeko.modules.device.dto.TokenUsageDTO;
import cheeko.modules.device.entity.DeviceTokenUsageEntity;
import cheeko.modules.device.service.DeviceTokenUsageService;

@Slf4j
@Service
public class DeviceTokenUsageServiceImpl extends BaseServiceImpl<DeviceTokenUsageDao, DeviceTokenUsageEntity>
        implements DeviceTokenUsageService {

    // Gemini pricing in INR per token (1 USD = 83.33 INR)
    private static final double TEXT_INPUT_RATE_INR = 6.25 / 1_000_000;      // ₹6.25/1M
    private static final double AUDIO_INPUT_RATE_INR = 83.33 / 1_000_000;    // ₹83.33/1M
    private static final double TEXT_OUTPUT_RATE_INR = 25.0 / 1_000_000;     // ₹25/1M
    private static final double AUDIO_OUTPUT_RATE_INR = 333.33 / 1_000_000;  // ₹333.33/1M

    @Override
    public boolean recordSessionTokenUsage(TokenUsageDTO dto) {
        try {
            // Get today's date (without time)
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date today = sdf.parse(sdf.format(new Date()));

            // Upsert - insert or add to existing
            int result = baseDao.upsertSessionTokenUsage(
                    dto.getMacAddress(),
                    dto.getSessionId(),
                    today,
                    dto.getInputAudioTokens() != null ? dto.getInputAudioTokens() : 0L,
                    dto.getInputTextTokens() != null ? dto.getInputTextTokens() : 0L,
                    dto.getInputCachedTokens() != null ? dto.getInputCachedTokens() : 0L,
                    dto.getInputTokens() != null ? dto.getInputTokens() : 0L,
                    dto.getOutputTokens() != null ? dto.getOutputTokens() : 0L,
                    dto.getOutputAudioTokens() != null ? dto.getOutputAudioTokens() : 0L,
                    dto.getOutputTextTokens() != null ? dto.getOutputTextTokens() : 0L,
                    dto.getSessionDurationSeconds(),
                    dto.getAvgTtftSeconds(),
                    dto.getMessageCount() != null ? dto.getMessageCount() : 0,
                    dto.getTotalResponseDurationSeconds()
            );

            log.info("📊 [TOKEN-USAGE] Recorded session usage for {} session {}: " +
                            "inputAudio={}, inputText={}, input={}, " +
                            "outputAudio={}, outputText={}, output={}, " +
                            "duration={}s, ttft={}s, messages={}, result={}",
                    dto.getMacAddress(), dto.getSessionId(),
                    dto.getInputAudioTokens(), dto.getInputTextTokens(), dto.getInputTokens(),
                    dto.getOutputAudioTokens(), dto.getOutputTextTokens(), dto.getOutputTokens(),
                    dto.getSessionDurationSeconds(), dto.getAvgTtftSeconds(), dto.getMessageCount(),
                    result);

            return result > 0;
        } catch (Exception e) {
            log.error("📊 [TOKEN-USAGE] Failed to record session usage for {} session {}: {}",
                    dto.getMacAddress(), dto.getSessionId(), e.getMessage());
            return false;
        }
    }

    @Override
    public DeviceTokenUsageEntity getSessionUsage(String macAddress, String sessionId) {
        try {
            return baseDao.getByMacAddressAndSession(macAddress, sessionId);
        } catch (Exception e) {
            log.error("📊 [TOKEN-USAGE] Failed to get session usage for {} session {}: {}",
                    macAddress, sessionId, e.getMessage());
            return null;
        }
    }

    @Override
    public DeviceTokenUsageEntity getTodayUsage(String macAddress) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date today = sdf.parse(sdf.format(new Date()));
            return baseDao.getByMacAddressAndDate(macAddress, today);
        } catch (Exception e) {
            log.error("📊 [TOKEN-USAGE] Failed to get today's usage for {}: {}", macAddress, e.getMessage());
            return null;
        }
    }

    @Override
    public List<DeviceTokenUsageEntity> getUsageHistory(String macAddress) {
        return baseDao.getByMacAddress(macAddress);
    }

    @Override
    public TokenUsageDTO getTotalUsage(String macAddress) {
        DeviceTokenUsageEntity totals = baseDao.getTotalByMacAddress(macAddress);

        if (totals == null) {
            return TokenUsageDTO.builder()
                    .macAddress(macAddress)
                    .inputAudioTokens(0L)
                    .inputTextTokens(0L)
                    .inputCachedTokens(0L)
                    .inputTokens(0L)
                    .outputAudioTokens(0L)
                    .outputTextTokens(0L)
                    .outputTokens(0L)
                    .totalTokens(0L)
                    .sessionCount(0)
                    .messageCount(0)
                    .sessionDurationSeconds(0.0)
                    .avgTtftSeconds(0.0)
                    .totalResponseDurationSeconds(0.0)
                    .build();
        }

        Long inputAudioTokens = totals.getInputAudioTokens() != null ? totals.getInputAudioTokens() : 0L;
        Long inputTextTokens = totals.getInputTextTokens() != null ? totals.getInputTextTokens() : 0L;
        Long inputCachedTokens = totals.getInputCachedTokens() != null ? totals.getInputCachedTokens() : 0L;
        Long inputTokens = totals.getInputTokens() != null ? totals.getInputTokens() : 0L;
        Long outputAudioTokens = totals.getOutputAudioTokens() != null ? totals.getOutputAudioTokens() : 0L;
        Long outputTextTokens = totals.getOutputTextTokens() != null ? totals.getOutputTextTokens() : 0L;
        Long outputTokens = totals.getOutputTokens() != null ? totals.getOutputTokens() : 0L;

        return TokenUsageDTO.builder()
                .macAddress(macAddress)
                .inputAudioTokens(inputAudioTokens)
                .inputTextTokens(inputTextTokens)
                .inputCachedTokens(inputCachedTokens)
                .inputTokens(inputTokens)
                .outputAudioTokens(outputAudioTokens)
                .outputTextTokens(outputTextTokens)
                .outputTokens(outputTokens)
                .totalTokens(inputTokens + outputTokens)
                .sessionCount(totals.getSessionCount())
                .messageCount(totals.getMessageCount())
                .sessionDurationSeconds(totals.getSessionDurationSeconds())
                .avgTtftSeconds(totals.getAvgTtftSeconds())
                .totalResponseDurationSeconds(totals.getTotalResponseDurationSeconds())
                .build();
    }

    // ==================== ANALYTICS ====================

    @Override
    public List<Map<String, Object>> getDailySummary(Date startDate, Date endDate) {
        List<Map<String, Object>> results = baseDao.getDailySummary(startDate, endDate);
        // Add cost calculation to each row
        for (Map<String, Object> row : results) {
            long inputTextTokens = getLongValue(row, "input_text_tokens");
            long inputAudioTokens = getLongValue(row, "input_audio_tokens");
            long outputTextTokens = getLongValue(row, "output_text_tokens");
            long outputAudioTokens = getLongValue(row, "output_audio_tokens");
            double costInr = calculateCostInINR(inputTextTokens, inputAudioTokens, outputTextTokens, outputAudioTokens);
            row.put("cost_inr", Math.round(costInr * 100.0) / 100.0); // Round to 2 decimals
        }
        return results;
    }

    @Override
    public List<Map<String, Object>> getPerDeviceDailyUsage(Date startDate, Date endDate) {
        List<Map<String, Object>> results = baseDao.getPerDeviceDailyUsage(startDate, endDate);
        // Add cost calculation to each row
        for (Map<String, Object> row : results) {
            long inputTextTokens = getLongValue(row, "input_text_tokens");
            long inputAudioTokens = getLongValue(row, "input_audio_tokens");
            long outputTextTokens = getLongValue(row, "output_text_tokens");
            long outputAudioTokens = getLongValue(row, "output_audio_tokens");
            double costInr = calculateCostInINR(inputTextTokens, inputAudioTokens, outputTextTokens, outputAudioTokens);
            row.put("cost_inr", Math.round(costInr * 100.0) / 100.0);
        }
        return results;
    }

    @Override
    public Map<String, Object> getOverallTotals() {
        Map<String, Object> totals = baseDao.getOverallTotals();
        if (totals != null) {
            long inputTextTokens = getLongValue(totals, "input_text_tokens");
            long inputAudioTokens = getLongValue(totals, "input_audio_tokens");
            long outputTextTokens = getLongValue(totals, "output_text_tokens");
            long outputAudioTokens = getLongValue(totals, "output_audio_tokens");
            double costInr = calculateCostInINR(inputTextTokens, inputAudioTokens, outputTextTokens, outputAudioTokens);
            totals.put("cost_inr", Math.round(costInr * 100.0) / 100.0);
        }
        return totals;
    }

    @Override
    public double calculateCostInINR(long inputTextTokens, long inputAudioTokens,
                                      long outputTextTokens, long outputAudioTokens) {
        return (inputTextTokens * TEXT_INPUT_RATE_INR) +
               (inputAudioTokens * AUDIO_INPUT_RATE_INR) +
               (outputTextTokens * TEXT_OUTPUT_RATE_INR) +
               (outputAudioTokens * AUDIO_OUTPUT_RATE_INR);
    }

    private long getLongValue(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value == null) return 0L;
        if (value instanceof Number) return ((Number) value).longValue();
        return 0L;
    }
}
