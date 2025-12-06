package xiaozhi.modules.device.controller;

import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
@RequestMapping("/api/usage")
@Slf4j
public class TokenUsageController {

    private final DeviceTokenUsageService deviceTokenUsageService;

    @PostMapping("/tokens")
    @Operation(summary = "Record token usage for a device session")
    public Result<String> recordTokenUsage(@RequestBody TokenUsageDTO dto) {
        if (StringUtils.isBlank(dto.getMacAddress())) {
            return new Result<String>().error("mac_address is required");
        }
        if (dto.getInputTokens() == null || dto.getOutputTokens() == null) {
            return new Result<String>().error("input_tokens and output_tokens are required");
        }

        log.info("📊 [TOKEN-USAGE] Received usage for {}: input={}, output={}",
                dto.getMacAddress(), dto.getInputTokens(), dto.getOutputTokens());

        boolean success = deviceTokenUsageService.recordTokenUsage(
                dto.getMacAddress(),
                dto.getInputTokens(),
                dto.getOutputTokens());

        if (success) {
            return new Result<String>().ok("Token usage recorded successfully");
        } else {
            return new Result<String>().error("Failed to record token usage");
        }
    }

    @GetMapping("/tokens/{macAddress}/today")
    @Operation(summary = "Get today's token usage for a device")
    public Result<DeviceTokenUsageEntity> getTodayUsage(@PathVariable String macAddress) {
        DeviceTokenUsageEntity usage = deviceTokenUsageService.getTodayUsage(macAddress);
        return new Result<DeviceTokenUsageEntity>().ok(usage);
    }

    @GetMapping("/tokens/{macAddress}/history")
    @Operation(summary = "Get token usage history for a device")
    public Result<List<DeviceTokenUsageEntity>> getUsageHistory(@PathVariable String macAddress) {
        List<DeviceTokenUsageEntity> history = deviceTokenUsageService.getUsageHistory(macAddress);
        return new Result<List<DeviceTokenUsageEntity>>().ok(history);
    }

    @GetMapping("/tokens/{macAddress}/total")
    @Operation(summary = "Get total token usage for a device")
    public Result<TokenUsageDTO> getTotalUsage(@PathVariable String macAddress) {
        TokenUsageDTO total = deviceTokenUsageService.getTotalUsage(macAddress);
        return new Result<TokenUsageDTO>().ok(total);
    }
}
