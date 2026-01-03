package cheeko.modules.agent.controller;

import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.page.PageData;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.user.UserDetail;
import cheeko.common.utils.Result;
import cheeko.common.utils.ResultUtils;
import cheeko.modules.agent.dto.AgentChatHistoryDTO;
import cheeko.modules.agent.dto.AgentChatSessionDTO;
import cheeko.modules.agent.dto.AgentCreateDTO;
import cheeko.modules.agent.dto.AgentDTO;
import cheeko.modules.agent.dto.AgentMemoryDTO;
import cheeko.modules.agent.dto.AgentModeCycleResponse;
import cheeko.modules.agent.dto.AgentModeCycleSimpleResponse;
import cheeko.modules.agent.dto.AgentUpdateDTO;
import cheeko.modules.agent.dto.AgentUpdateModeDTO;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.entity.AgentTemplateEntity;
import cheeko.modules.agent.service.AgentChatHistoryService;
import cheeko.modules.agent.service.AgentPluginMappingService;
import cheeko.modules.agent.service.AgentService;
import cheeko.modules.agent.service.AgentTemplateService;
import cheeko.modules.agent.vo.AgentChatHistoryUserVO;
import cheeko.modules.agent.vo.AgentInfoVO;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.service.DeviceService;
import cheeko.modules.security.user.SecurityUser;

@Tag(name = "Agent Management")
@AllArgsConstructor
@RestController
@RequestMapping("/agent")
@Slf4j
public class AgentController {
    private final AgentService agentService;
    private final AgentTemplateService agentTemplateService;
    private final DeviceService deviceService;
    private final AgentChatHistoryService agentChatHistoryService;
    private final AgentPluginMappingService agentPluginMappingService;
    private final RedisUtils redisUtils;

    @GetMapping("/list")
    @Operation(summary = "Get agents list (admin gets all agents, user gets own agents)")
    @RequiresPermissions("sys:role:normal")
    public Result<List<AgentDTO>> getAgentsList() {
        UserDetail user = SecurityUser.getUser();
        List<AgentDTO> agents;

        // Check if user is super admin
        if (user.getSuperAdmin() != null && user.getSuperAdmin() == 1) {
            // Admin sees all agents from all users with owner information
            agents = agentService.getAllAgentsForAdmin();
        } else {
            // Regular user sees only their own agents
            agents = agentService.getUserAgents(user.getId());
        }

        return new Result<List<AgentDTO>>().ok(agents);
    }

    @GetMapping("/all")
    @Operation(summary = "Agent list (admin)")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = Constant.PAGE, description = "CurrentPage Number，from1Start", required = true),
            @Parameter(name = Constant.LIMIT, description = "Per PagedisplayRecordcount", required = true),
    })
    public Result<PageData<AgentEntity>> adminAgentList(
            @Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<AgentEntity> page = agentService.adminAgentList(params);
        return new Result<PageData<AgentEntity>>().ok(page);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get agent details")
    @RequiresPermissions("sys:role:normal")
    public Result<AgentInfoVO> getAgentById(@PathVariable("id") String id) {
        AgentInfoVO agent = agentService.getAgentById(id);
        return ResultUtils.success(agent);
    }

    @PostMapping
    @Operation(summary = "Create agent")
    @RequiresPermissions("sys:role:normal")
    public Result<String> save(@RequestBody @Valid AgentCreateDTO dto) {
        String agentId = agentService.createAgent(dto);
        return new Result<String>().ok(agentId);
    }

    @PutMapping("/saveMemory/{macAddress}")
    @Operation(summary = "Update agent by device ID")
    public Result<Void> updateByDeviceId(@PathVariable String macAddress, @RequestBody @Valid AgentMemoryDTO dto) {
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            return new Result<>();
        }
        AgentUpdateDTO agentUpdateDTO = new AgentUpdateDTO();
        agentUpdateDTO.setSummaryMemory(dto.getSummaryMemory());
        agentService.updateAgentById(device.getAgentId(), agentUpdateDTO);
        return new Result<>();
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update agent")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> update(@PathVariable String id, @RequestBody @Valid AgentUpdateDTO dto) {
        agentService.updateAgentById(id, dto);
        return new Result<>();
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete agent")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> delete(@PathVariable String id) {
        // First delete associated devices
        deviceService.deleteByAgentId(id);
        // Delete associated chat records
        agentChatHistoryService.deleteByAgentId(id, true, true);
        // Delete associated plugins
        agentPluginMappingService.deleteByAgentId(id);
        // Then delete agent
        agentService.deleteById(id);
        return new Result<>();
    }

    @GetMapping("/template")
    @Operation(summary = "Agent template list")
    @RequiresPermissions("sys:role:normal")
    public Result<List<AgentTemplateEntity>> templateList() {
        List<AgentTemplateEntity> list = agentTemplateService
                .list(new QueryWrapper<AgentTemplateEntity>()
                        .eq("is_visible", 1)
                        .orderByAsc("sort"));
        return new Result<List<AgentTemplateEntity>>().ok(list);
    }

    @PutMapping("/template/{id}")
    @Operation(summary = "Update agent template")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> updateTemplate(@PathVariable String id, @RequestBody AgentTemplateEntity template) {
        template.setId(id);
        agentTemplateService.updateById(template);
        return new Result<>();
    }

    @PostMapping("/template")
    @Operation(summary = "Create agent template")
    @RequiresPermissions("sys:role:normal")
    public Result<String> createTemplate(@RequestBody AgentTemplateEntity template) {
        agentTemplateService.save(template);
        return new Result<String>().ok(template.getId());
    }

    @GetMapping("/{id}/sessions")
    @Operation(summary = "Get agent sessions list")
    @RequiresPermissions("sys:role:normal")
    @Parameters({
            @Parameter(name = Constant.PAGE, description = "CurrentPage Number，from1Start", required = true),
            @Parameter(name = Constant.LIMIT, description = "Per PagedisplayRecordcount", required = true),
    })
    public Result<PageData<AgentChatSessionDTO>> getAgentSessions(
            @PathVariable("id") String id,
            @Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        params.put("agentId", id);
        PageData<AgentChatSessionDTO> page = agentChatHistoryService.getSessionListByAgentId(params);
        return new Result<PageData<AgentChatSessionDTO>>().ok(page);
    }

    @GetMapping("/{id}/chat-history/{sessionId}")
    @Operation(summary = "Get agent chat history")
    @RequiresPermissions("sys:role:normal")
    public Result<List<AgentChatHistoryDTO>> getAgentChatHistory(
            @PathVariable("id") String id,
            @PathVariable("sessionId") String sessionId) {
        // Get current user
        UserDetail user = SecurityUser.getUser();

        // Check permission
        if (!agentService.checkAgentPermission(id, user.getId())) {
            return new Result<List<AgentChatHistoryDTO>>().error("No permission to query this agent's chat records");
        }

        // Query chat records
        List<AgentChatHistoryDTO> result = agentChatHistoryService.getChatHistoryBySessionId(id, sessionId);
        return new Result<List<AgentChatHistoryDTO>>().ok(result);
    }

    @GetMapping("/{id}/chat-history/user")
    @Operation(summary = "Get agent chat history (user)")
    @RequiresPermissions("sys:role:normal")
    public Result<List<AgentChatHistoryUserVO>> getRecentlyFiftyByAgentId(
            @PathVariable("id") String id) {
        // Get current user
        UserDetail user = SecurityUser.getUser();

        // Check permission
        if (!agentService.checkAgentPermission(id, user.getId())) {
            return new Result<List<AgentChatHistoryUserVO>>().error("No permission to query this agent's chat records");
        }

        // Query chat records
        List<AgentChatHistoryUserVO> data = agentChatHistoryService.getRecentlyFiftyByAgentId(id);
        return new Result<List<AgentChatHistoryUserVO>>().ok(data);
    }

    @GetMapping("/{id}/chat-history/audio")
    @Operation(summary = "Get audio content")
    @RequiresPermissions("sys:role:normal")
    public Result<String> getContentByAudioId(
            @PathVariable("id") String id) {
        // Query chat records
        String data = agentChatHistoryService.getContentByAudioId(id);
        return new Result<String>().ok(data);
    }

    @GetMapping("/prompt/{macAddress}")
    @Operation(summary = "Get agent prompt by device MAC address")
    public Result<String> getAgentPromptByMac(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address (remove colons, hyphens, convert to lowercase)
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            // Find device by MAC address
            DeviceEntity device = deviceService.getDeviceByMacAddress(cleanMac);
            if (device == null) {
                return new Result<String>().error("Device not found for MAC address: " + macAddress);
            }

            // Get associated agent
            if (StringUtils.isBlank(device.getAgentId())) {
                return new Result<String>().error("No agent associated with device: " + macAddress);
            }

            AgentEntity agent = agentService.selectById(device.getAgentId());
            if (agent == null) {
                return new Result<String>().error("Agent not found for device: " + macAddress);
            }

            // Return system prompt
            String systemPrompt = agent.getSystemPrompt();
            if (StringUtils.isBlank(systemPrompt)) {
                return new Result<String>().error("No system prompt configured for agent: " + agent.getAgentName());
            }

            return new Result<String>().ok(systemPrompt);

        } catch (Exception e) {
            log.error("Error fetching agent prompt for MAC: " + macAddress, e);
            return new Result<String>().error("Internal server error");
        }
    }

    @PutMapping("/update-mode")
    @Operation(summary = "Update agent mode from template")
    public Result<String> updateMode(@RequestBody @Valid AgentUpdateModeDTO dto) {
        String updatedPrompt = agentService.updateAgentMode(dto.getAgentId(), dto.getModeName());
        return new Result<String>().ok(updatedPrompt);
    }

    @GetMapping("/device/{macAddress}/agent-id")
    @Operation(summary = "Get agent ID by device MAC address")
    public Result<String> getAgentIdByMac(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address (remove colons, hyphens, convert to lowercase)
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            // Find device by MAC address
            DeviceEntity device = deviceService.getDeviceByMacAddress(cleanMac);
            if (device == null) {
                return new Result<String>().error("Device not found for MAC address: " + macAddress);
            }

            // Get associated agent ID
            if (StringUtils.isBlank(device.getAgentId())) {
                return new Result<String>().error("No agent associated with device: " + macAddress);
            }

            // Return agent ID
            return new Result<String>().ok(device.getAgentId());

        } catch (Exception e) {
            log.error("Error fetching agent ID for MAC: " + macAddress, e);
            return new Result<String>().error("Internal server error");
        }
    }

    @PostMapping("/device/{macAddress}/cycle-character")
    @Operation(summary = "Cycle agent character by device MAC address (triggered by button)")
    public Result<AgentModeCycleSimpleResponse> cycleAgentCharacterByMacButton(
            @PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            log.info("🎭 Character cycle requested for device MAC: {}", cleanMac);

            // Call service to cycle mode
            AgentModeCycleResponse fullResponse = agentService.cycleAgentModeByMac(cleanMac);

            // Create simplified response with only essential fields
            AgentModeCycleSimpleResponse simpleResponse = new AgentModeCycleSimpleResponse();
            simpleResponse.setSuccess(fullResponse.isSuccess());
            simpleResponse.setAgentId(fullResponse.getAgentId());
            simpleResponse.setOldModeName(fullResponse.getOldModeName());
            simpleResponse.setNewModeName(fullResponse.getNewModeName());

            return new Result<AgentModeCycleSimpleResponse>().ok(simpleResponse);

        } catch (Exception e) {
            log.error("❌ Error cycling character for MAC {}: {}", macAddress, e.getMessage());
            return new Result<AgentModeCycleSimpleResponse>().error(e.getMessage());
        }
    }

    @PostMapping("/device/{macAddress}/set-character")
    @Operation(summary = "Set specific agent character by device MAC address and character name")
    public Result<AgentModeCycleSimpleResponse> setAgentCharacterByMac(
            @PathVariable("macAddress") String macAddress,
            @RequestBody Map<String, String> requestBody) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();
            String characterName = requestBody.get("characterName");

            if (characterName == null || characterName.trim().isEmpty()) {
                log.error("❌ Character name is required");
                return new Result<AgentModeCycleSimpleResponse>().error("Character name is required");
            }

            log.info("🎭 Set character '{}' requested for device MAC: {}", characterName, cleanMac);

            // Call service to set specific character
            AgentModeCycleResponse fullResponse = agentService.setAgentCharacterByMac(cleanMac, characterName);

            // Create simplified response with only essential fields
            AgentModeCycleSimpleResponse simpleResponse = new AgentModeCycleSimpleResponse();
            simpleResponse.setSuccess(fullResponse.isSuccess());
            simpleResponse.setAgentId(fullResponse.getAgentId());
            simpleResponse.setOldModeName(fullResponse.getOldModeName());
            simpleResponse.setNewModeName(fullResponse.getNewModeName());

            return new Result<AgentModeCycleSimpleResponse>().ok(simpleResponse);

        } catch (Exception e) {
            log.error("❌ Error setting character for MAC {}: {}", macAddress, e.getMessage());
            return new Result<AgentModeCycleSimpleResponse>().error(e.getMessage());
        }
    }

    @GetMapping("/device/{macAddress}/current-character")
    @Operation(summary = "Get current agent character by device MAC address")
    public Result<String> getCurrentCharacterByMac(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            log.info("🔍 Getting current character for device MAC: {}", cleanMac);

            // Get agent by MAC address
            AgentEntity agent = agentService.getDefaultAgentByMacAddress(cleanMac);

            if (agent == null) {
                log.warn("⚠️ No agent found for MAC address: {}", cleanMac);
                return new Result<String>().ok("Cheeko"); // Default fallback
            }

            String currentCharacter = agent.getAgentName();
            if (currentCharacter == null || currentCharacter.trim().isEmpty()) {
                currentCharacter = "Cheeko"; // Default fallback
            }

            log.info("✅ Current character for MAC {}: {}", cleanMac, currentCharacter);
            return new Result<String>().ok(currentCharacter);

        } catch (Exception e) {
            log.error("❌ Error getting current character for MAC {}: {}", macAddress, e.getMessage());
            return new Result<String>().ok("Cheeko"); // Default fallback on error
        }
    }

    @GetMapping("/device/{macAddress}/agent-name")
    @Operation(summary = "Get agent name by device MAC address (for game mode detection)")
    public Result<String> getAgentNameByMac(@PathVariable("macAddress") String macAddress) {
        // Alias to current-character endpoint
        return getCurrentCharacterByMac(macAddress);
    }
}