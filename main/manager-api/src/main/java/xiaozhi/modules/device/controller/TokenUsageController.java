package xiaozhi.modules.device.controller;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.device.dto.TokenUsageDTO;
import xiaozhi.modules.device.entity.DeviceTokenUsageEntity;
import xiaozhi.modules.device.service.DeviceTokenUsageService;

@Tag(name = "Token Usage Management")
@AllArgsConstructor
@RestController
@RequestMapping("/usage")
@Slf4j
public class TokenUsageController {

    private final DeviceTokenUsageService deviceTokenUsageService;

    @PostMapping("/tokens")
    @Operation(summary = "Record token usage for a device session with full breakdown")
    public Result<String> recordTokenUsage(@RequestBody TokenUsageDTO dto) {
        if (StringUtils.isBlank(dto.getMacAddress())) {
            return new Result<String>().error("mac_address is required");
        }
        if (StringUtils.isBlank(dto.getSessionId())) {
            return new Result<String>().error("session_id is required");
        }

        log.info("📊 [TOKEN-USAGE] Received usage for {} session {}: " +
                        "inputAudio={}, inputText={}, input={}, " +
                        "outputAudio={}, outputText={}, output={}, " +
                        "duration={}s, ttft={}s, messages={}",
                dto.getMacAddress(), dto.getSessionId(),
                dto.getInputAudioTokens(), dto.getInputTextTokens(), dto.getInputTokens(),
                dto.getOutputAudioTokens(), dto.getOutputTextTokens(), dto.getOutputTokens(),
                dto.getSessionDurationSeconds(), dto.getAvgTtftSeconds(), dto.getMessageCount());

        boolean success = deviceTokenUsageService.recordSessionTokenUsage(dto);

        if (success) {
            return new Result<String>().ok("Token usage recorded successfully");
        } else {
            return new Result<String>().error("Failed to record token usage");
        }
    }

    @GetMapping("/tokens/{macAddress}/session/{sessionId}")
    @Operation(summary = "Get token usage for a specific session")
    public Result<DeviceTokenUsageEntity> getSessionUsage(
            @PathVariable String macAddress,
            @PathVariable String sessionId) {
        DeviceTokenUsageEntity usage = deviceTokenUsageService.getSessionUsage(macAddress, sessionId);
        return new Result<DeviceTokenUsageEntity>().ok(usage);
    }

    @GetMapping("/tokens/{macAddress}/today")
    @Operation(summary = "Get today's token usage for a device (aggregated)")
    public Result<DeviceTokenUsageEntity> getTodayUsage(@PathVariable String macAddress) {
        DeviceTokenUsageEntity usage = deviceTokenUsageService.getTodayUsage(macAddress);
        return new Result<DeviceTokenUsageEntity>().ok(usage);
    }

    @GetMapping("/tokens/{macAddress}/history")
    @Operation(summary = "Get token usage history for a device (all sessions)")
    public Result<List<DeviceTokenUsageEntity>> getUsageHistory(@PathVariable String macAddress) {
        List<DeviceTokenUsageEntity> history = deviceTokenUsageService.getUsageHistory(macAddress);
        return new Result<List<DeviceTokenUsageEntity>>().ok(history);
    }

    @GetMapping("/tokens/{macAddress}/total")
    @Operation(summary = "Get total token usage for a device (aggregated across all sessions)")
    public Result<TokenUsageDTO> getTotalUsage(@PathVariable String macAddress) {
        TokenUsageDTO total = deviceTokenUsageService.getTotalUsage(macAddress);
        return new Result<TokenUsageDTO>().ok(total);
    }

    // ==================== ANALYTICS ENDPOINTS ====================

    @GetMapping("/analytics/daily-summary")
    @Operation(summary = "Get daily usage summary across all devices")
    public Result<List<Map<String, Object>>> getDailySummary(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date start, end;

            if (StringUtils.isBlank(startDate)) {
                // Default to last 30 days
                Calendar cal = Calendar.getInstance();
                cal.add(Calendar.DAY_OF_MONTH, -30);
                start = sdf.parse(sdf.format(cal.getTime()));
            } else {
                start = sdf.parse(startDate);
            }

            if (StringUtils.isBlank(endDate)) {
                end = sdf.parse(sdf.format(new Date()));
            } else {
                end = sdf.parse(endDate);
            }

            List<Map<String, Object>> summary = deviceTokenUsageService.getDailySummary(start, end);
            return new Result<List<Map<String, Object>>>().ok(summary);
        } catch (Exception e) {
            log.error("Failed to get daily summary: {}", e.getMessage());
            return new Result<List<Map<String, Object>>>().error("Failed to get daily summary");
        }
    }

    @GetMapping("/analytics/per-device")
    @Operation(summary = "Get per-device daily usage")
    public Result<List<Map<String, Object>>> getPerDeviceDailyUsage(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date start, end;

            if (StringUtils.isBlank(startDate)) {
                Calendar cal = Calendar.getInstance();
                cal.add(Calendar.DAY_OF_MONTH, -30);
                start = sdf.parse(sdf.format(cal.getTime()));
            } else {
                start = sdf.parse(startDate);
            }

            if (StringUtils.isBlank(endDate)) {
                end = sdf.parse(sdf.format(new Date()));
            } else {
                end = sdf.parse(endDate);
            }

            List<Map<String, Object>> usage = deviceTokenUsageService.getPerDeviceDailyUsage(start, end);
            return new Result<List<Map<String, Object>>>().ok(usage);
        } catch (Exception e) {
            log.error("Failed to get per-device usage: {}", e.getMessage());
            return new Result<List<Map<String, Object>>>().error("Failed to get per-device usage");
        }
    }

    @GetMapping("/analytics/totals")
    @Operation(summary = "Get overall totals across all devices (optionally filtered by date range)")
    public Result<Map<String, Object>> getOverallTotals(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Date start = null, end = null;

            if (StringUtils.isNotBlank(startDate)) {
                start = sdf.parse(startDate);
            }
            if (StringUtils.isNotBlank(endDate)) {
                end = sdf.parse(endDate);
            }

            Map<String, Object> totals = deviceTokenUsageService.getOverallTotals(start, end);
            return new Result<Map<String, Object>>().ok(totals);
        } catch (Exception e) {
            log.error("Failed to get overall totals: {}", e.getMessage());
            return new Result<Map<String, Object>>().error("Failed to get overall totals");
        }
    }
}
