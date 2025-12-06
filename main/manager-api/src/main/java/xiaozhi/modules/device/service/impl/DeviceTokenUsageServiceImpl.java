package xiaozhi.modules.device.service.impl;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

import org.springframework.stereotype.Service;

import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.service.impl.BaseServiceImpl;
import xiaozhi.modules.device.dao.DeviceTokenUsageDao;
import xiaozhi.modules.device.dto.TokenUsageDTO;
import xiaozhi.modules.device.entity.DeviceTokenUsageEntity;
import xiaozhi.modules.device.service.DeviceTokenUsageService;

@Slf4j
@Service
public class DeviceTokenUsageServiceImpl extends BaseServiceImpl<DeviceTokenUsageDao, DeviceTokenUsageEntity>
        implements DeviceTokenUsageService {

    @Override
    public boolean recordTokenUsage(String macAddress, Long inputTokens, Long outputTokens) {
        try {
            // Get today's date (without time)
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date today = sdf.parse(sdf.format(new Date()));

            // Upsert - insert or add to existing
            int result = baseDao.upsertTokenUsage(macAddress, today, inputTokens, outputTokens);

            log.info("📊 [TOKEN-USAGE] Recorded usage for {}: input={}, output={}, result={}",
                    macAddress, inputTokens, outputTokens, result);

            return result > 0;
        } catch (Exception e) {
            log.error("📊 [TOKEN-USAGE] Failed to record usage for {}: {}", macAddress, e.getMessage(), e);
            return false;
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
                    .inputTokens(0L)
                    .outputTokens(0L)
                    .totalTokens(0L)
                    .sessionCount(0)
                    .build();
        }

        Long inputTokens = totals.getInputTokens() != null ? totals.getInputTokens() : 0L;
        Long outputTokens = totals.getOutputTokens() != null ? totals.getOutputTokens() : 0L;

        return TokenUsageDTO.builder()
                .macAddress(macAddress)
                .inputTokens(inputTokens)
                .outputTokens(outputTokens)
                .totalTokens(inputTokens + outputTokens)
                .sessionCount(totals.getSessionCount())
                .build();
    }
}
