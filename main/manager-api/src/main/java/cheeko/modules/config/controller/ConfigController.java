package cheeko.modules.config.controller;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.utils.Result;
import cheeko.common.validator.ValidatorUtils;
import cheeko.modules.config.dto.AgentModelsDTO;
import cheeko.modules.config.service.ConfigService;

/**
 * cheeko-server ConfigurationGet
 *
 * @since 1.0.0
 */
@Slf4j
@RestController
@RequestMapping("config")
@Tag(name = "Parameter Management")
@AllArgsConstructor
public class ConfigController {
    private final ConfigService configService;

    @PostMapping("server-base")
    @Operation(summary = "Server-side configuration interface")
    public Result<Object> getConfig() {
        Object config = configService.getConfig(true);
        return new Result<Object>().ok(config);
    }

    @PostMapping("agent-models")
    @Operation(summary = "Get Agent Model")
    public Result<Object> getAgentModels(@Valid @RequestBody AgentModelsDTO dto) {
        // Validate data
        ValidatorUtils.validateEntity(dto);
        Object models = configService.getAgentModels(dto.getMacAddress(), dto.getSelectedModule());
        return new Result<Object>().ok(models);
    }

    @PostMapping("agent-prompt")
    @Operation(summary = "GetAgentPrompt")
    public Result<String> getAgentPrompt(@Valid @RequestBody Map<String, String> request) {
        String macAddress = request.get("macAddress");

        log.info("🤖 [NEW SESSION] Agent prompt request received for MAC: {}", macAddress);

        if (macAddress == null || macAddress.trim().isEmpty()) {
            log.error("❌ [PROMPT FETCH] MAC address is required but not provided");
            return new Result<String>().error("MAC address is required");
        }

        try {
            String prompt = configService.getAgentPrompt(macAddress);

            if (prompt != null && !prompt.trim().isEmpty()) {
                log.info("✅ [PROMPT FETCH] Successfully fetched prompt for MAC: {} (length: {} chars)",
                    macAddress, prompt.length());
                log.debug("📝 [PROMPT PREVIEW] First 100 chars: {}",
                    prompt.length() > 100 ? prompt.substring(0, 100) + "..." : prompt);
            } else {
                log.warn("⚠️ [PROMPT FETCH] Empty prompt returned for MAC: {}", macAddress);
            }

            return new Result<String>().ok(prompt);
        } catch (Exception e) {
            log.error("❌ [PROMPT FETCH] Failed to fetch prompt for MAC: {} - Error: {}",
                macAddress, e.getMessage(), e);
            throw e;
        }
    }

    @PostMapping("child-profile-by-mac")
    @Operation(summary = "Get child profile associated with device")
    public Result<cheeko.modules.config.dto.ChildProfileDTO> getChildProfileByMac(@Valid @RequestBody Map<String, String> request) {
        String macAddress = request.get("macAddress");
        if (macAddress == null || macAddress.trim().isEmpty()) {
            return new Result<cheeko.modules.config.dto.ChildProfileDTO>().error("MAC address is required");
        }

        cheeko.modules.config.dto.ChildProfileDTO childProfile = configService.getChildProfileByMac(macAddress);
        return new Result<cheeko.modules.config.dto.ChildProfileDTO>().ok(childProfile);
    }

    @PostMapping("agent-template-id")
    @Operation(summary = "GetAgentTemplateID")
    public Result<String> getAgentTemplateId(@Valid @RequestBody Map<String, String> request) {
        String macAddress = request.get("macAddress");
        if (macAddress == null || macAddress.trim().isEmpty()) {
            return new Result<String>().error("MAC address is required");
        }

        String templateId = configService.getAgentTemplateId(macAddress);
        return new Result<String>().ok(templateId);
    }

    @GetMapping("template/{templateId}")
    @Operation(summary = "GetTemplateContent（personality）")
    public Result<String> getTemplateContent(@PathVariable("templateId") String templateId) {
        if (templateId == null || templateId.trim().isEmpty()) {
            return new Result<String>().error("Template ID is required");
        }

        String content = configService.getTemplateContent(templateId);
        return new Result<String>().ok(content);
    }

    @PostMapping("device-location")
    @Operation(summary = "Get device location information")
    public Result<String> getDeviceLocation(@Valid @RequestBody Map<String, String> request) {
        String macAddress = request.get("macAddress");
        if (macAddress == null || macAddress.trim().isEmpty()) {
            return new Result<String>().error("MAC address is required");
        }

        String location = configService.getDeviceLocation(macAddress);
        return new Result<String>().ok(location);
    }

    @PostMapping("weather")
    @Operation(summary = "Get weather forecast")
    public Result<String> getWeatherForecast(@Valid @RequestBody Map<String, String> request) {
        String location = request.get("location");
        if (location == null || location.trim().isEmpty()) {
            return new Result<String>().error("Location is required");
        }

        String weather = configService.getWeatherForecast(location);
        return new Result<String>().ok(weather);
    }
}
