package cheeko.modules.agent.service.impl;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;

import lombok.AllArgsConstructor;
import cheeko.common.constant.Constant;
import cheeko.common.exception.RenException;
import cheeko.common.page.PageData;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.common.user.UserDetail;
import cheeko.common.utils.ConvertUtils;
import cheeko.common.utils.JsonUtils;
import cheeko.modules.agent.dao.AgentDao;
import cheeko.modules.agent.dto.AgentCreateDTO;
import cheeko.modules.agent.dto.AgentDTO;
import cheeko.modules.agent.dto.AgentModeCycleResponse;
import cheeko.modules.agent.dto.AgentUpdateDTO;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.entity.AgentPluginMapping;
import cheeko.modules.agent.entity.AgentTemplateEntity;
import cheeko.modules.agent.service.AgentChatHistoryService;
import cheeko.modules.agent.service.AgentPluginMappingService;
import cheeko.modules.agent.service.AgentService;
import cheeko.modules.agent.service.AgentTemplateService;
import cheeko.modules.agent.vo.AgentInfoVO;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.service.DeviceService;
import cheeko.modules.model.dto.ModelProviderDTO;
import cheeko.modules.model.entity.ModelConfigEntity;
import cheeko.modules.model.service.ModelConfigService;
import cheeko.modules.model.service.ModelProviderService;
import cheeko.modules.security.user.SecurityUser;
import cheeko.modules.sys.enums.SuperAdminEnum;
import cheeko.modules.timbre.service.TimbreService;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
@AllArgsConstructor
public class AgentServiceImpl extends BaseServiceImpl<AgentDao, AgentEntity> implements AgentService {
    private final AgentDao agentDao;
    private final TimbreService timbreModelService;
    private final ModelConfigService modelConfigService;
    private final RedisUtils redisUtils;
    private final DeviceService deviceService;
    private final AgentPluginMappingService agentPluginMappingService;
    private final AgentChatHistoryService agentChatHistoryService;
    private final AgentTemplateService agentTemplateService;
    private final ModelProviderService modelProviderService;

    @Override
    public PageData<AgentEntity> adminAgentList(Map<String, Object> params) {
        IPage<AgentEntity> page = agentDao.selectPage(
                getPage(params, "agent_name", true),
                new QueryWrapper<>());
        return new PageData<>(page.getRecords(), page.getTotal());
    }

    @Override
    public AgentInfoVO getAgentById(String id) {
        AgentInfoVO agent = agentDao.selectAgentInfoById(id);

        if (agent == null) {
            throw new RenException("Agent does not exist");
        }

        if (agent.getMemModelId() != null && agent.getMemModelId().equals(Constant.MEMORY_NO_MEM)) {
            agent.setChatHistoryConf(Constant.ChatHistoryConfEnum.IGNORE.getCode());
        } else {
            // If memory is enabled and chatHistoryConf is null, default to RECORD_TEXT (1)
            if (agent.getChatHistoryConf() == null) {
                agent.setChatHistoryConf(Constant.ChatHistoryConfEnum.RECORD_TEXT.getCode());
            }
        }
        // No need to query plugin list separately, already fetched via SQL
        return agent;
    }

    @Override
    public boolean insert(AgentEntity entity) {
        // If ID is empty, auto-generate a UUID as ID
        if (entity.getId() == null || entity.getId().trim().isEmpty()) {
            entity.setId(UUID.randomUUID().toString().replace("-", ""));
        }

        // If agent code is empty, auto-generate a code with prefix
        if (entity.getAgentCode() == null || entity.getAgentCode().trim().isEmpty()) {
            entity.setAgentCode("AGT_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8));
        }

        // If sort order field is empty, set default value to 0
        if (entity.getSort() == null) {
            entity.setSort(0);
        }

        // If chat record configuration is empty, set default value to 1 (only record text)
        if (entity.getChatHistoryConf() == null) {
            entity.setChatHistoryConf(1);
        }

        // If memory model is empty, set default value to local short-term memory
        if (entity.getMemModelId() == null || entity.getMemModelId().trim().isEmpty()) {
            entity.setMemModelId("Memory_mem_local_short");
        }

        return super.insert(entity);
    }

    @Override
    public void deleteAgentByUserId(Long userId) {
        UpdateWrapper<AgentEntity> wrapper = new UpdateWrapper<>();
        wrapper.eq("user_id", userId);
        baseDao.delete(wrapper);
    }

    @Override
    public List<AgentDTO> getUserAgents(Long userId) {
        QueryWrapper<AgentEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("user_id", userId);
        List<AgentEntity> agents = agentDao.selectList(wrapper);
        return agents.stream().map(agent -> {
            AgentDTO dto = new AgentDTO();
            dto.setId(agent.getId());
            dto.setAgentName(agent.getAgentName());
            dto.setSystemPrompt(agent.getSystemPrompt());

            // Get TTS ModelName
            dto.setTtsModelName(modelConfigService.getModelNameById(agent.getTtsModelId()));

            // Get LLM ModelName
            dto.setLlmModelName(modelConfigService.getModelNameById(agent.getLlmModelId()));

            // Get VLLM ModelName
            dto.setVllmModelName(modelConfigService.getModelNameById(agent.getVllmModelId()));

            // Get memory model name
            dto.setMemModelId(agent.getMemModelId());

            // Get TTS timbre name
            dto.setTtsVoiceName(timbreModelService.getTimbreNameById(agent.getTtsVoiceId()));

            // Get agent's latest last connection time
            dto.setLastConnectedAt(deviceService.getLatestLastConnectionTime(agent.getId()));

            // Get device count
            dto.setDeviceCount(getDeviceCountByAgentId(agent.getId()));
            return dto;
        }).collect(Collectors.toList());
    }

    @Override
    public List<AgentDTO> getAllAgentsForAdmin() {
        List<Map<String, Object>> agentMaps = agentDao.getAllAgentsWithOwnerInfo();
        return agentMaps.stream().map(agentMap -> {
            AgentDTO dto = new AgentDTO();
            
            // BasicAgentInformation
            String agentId = (String) agentMap.get("id");
            dto.setId(agentId);
            dto.setAgentName((String) agentMap.get("agent_name"));
            dto.setSystemPrompt((String) agentMap.get("system_prompt"));
            
            // Handle LocalDateTime to Date conversion for createDate
            Object createdAt = agentMap.get("created_at");
            if (createdAt instanceof java.time.LocalDateTime) {
                dto.setCreateDate(java.sql.Timestamp.valueOf((java.time.LocalDateTime) createdAt));
            }

            // GetModelName - SameUserMethod
            String ttsModelId = (String) agentMap.get("tts_model_id");
            String llmModelId = (String) agentMap.get("llm_model_id");
            String vllmModelId = (String) agentMap.get("vllm_model_id");
            String memModelId = (String) agentMap.get("mem_model_id");
            String ttsVoiceId = (String) agentMap.get("tts_voice_id");

            dto.setTtsModelName(modelConfigService.getModelNameById(ttsModelId));
            dto.setLlmModelName(modelConfigService.getModelNameById(llmModelId));
            dto.setVllmModelName(modelConfigService.getModelNameById(vllmModelId));
            dto.setMemModelId(memModelId);
            dto.setTtsVoiceName(timbreModelService.getTimbreNameById(ttsVoiceId));

            // Get agent's latest last connection time - same user method
            dto.setLastConnectedAt(deviceService.getLatestLastConnectionTime(agentId));

            // Get device MAC address list - admin only
            String macAddresses = (String) agentMap.get("device_mac_addresses");
            dto.setDeviceMacAddresses(macAddresses);

            // Calculate device count (from MAC address list or use original method)
            if (macAddresses != null && !macAddresses.isEmpty()) {
                dto.setDeviceCount(macAddresses.split(",").length);
            } else {
                // Use original method to get device count
                dto.setDeviceCount(getDeviceCountByAgentId(agentId));
            }

            // Admin only field - user information
            dto.setOwnerUsername((String) agentMap.get("owner_username"));
            
            return dto;
        }).collect(Collectors.toList());
    }

    @Override
    public Integer getDeviceCountByAgentId(String agentId) {
        if (StringUtils.isBlank(agentId)) {
            return 0;
        }

        // First get from Redis
        Integer cachedCount = (Integer) redisUtils.get(RedisKeys.getAgentDeviceCountById(agentId));
        if (cachedCount != null) {
            return cachedCount;
        }

        // If not in Redis, query from database
        Integer deviceCount = agentDao.getDeviceCountByAgentId(agentId);

        // Store result in Redis
        if (deviceCount != null) {
            redisUtils.set(RedisKeys.getAgentDeviceCountById(agentId), deviceCount, 60);
        }

        return deviceCount != null ? deviceCount : 0;
    }

    @Override
    public AgentEntity getDefaultAgentByMacAddress(String macAddress) {
        if (StringUtils.isEmpty(macAddress)) {
            return null;
        }
        return agentDao.getDefaultAgentByMacAddress(macAddress);
    }

    @Override
    public boolean checkAgentPermission(String agentId, Long userId) {
        // GetAgentInformation
        AgentEntity agent = getAgentById(agentId);
        if (agent == null) {
            return false;
        }

        // IfIsSuper Admin，DirectlyReturntrue
        if (SecurityUser.getUser().getSuperAdmin() == SuperAdminEnum.YES.value()) {
            return true;
        }

        // CheckWhetherIsAgents Owner
        return userId.equals(agent.getUserId());
    }

    // ByidUpdateAgentInformation
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateAgentById(String agentId, AgentUpdateDTO dto) {
        // FirstQueryCurrentHaveEntity
        AgentEntity existingEntity = this.getAgentById(agentId);
        if (existingEntity == null) {
            throw new RuntimeException("Agent does not exist");
        }

        // OnlyUpdateProvides NonEmptyField
        if (dto.getAgentName() != null) {
            existingEntity.setAgentName(dto.getAgentName());
        }
        if (dto.getAgentCode() != null) {
            existingEntity.setAgentCode(dto.getAgentCode());
        }
        if (dto.getAsrModelId() != null) {
            existingEntity.setAsrModelId(dto.getAsrModelId());
        }
        if (dto.getVadModelId() != null) {
            existingEntity.setVadModelId(dto.getVadModelId());
        }
        if (dto.getLlmModelId() != null) {
            existingEntity.setLlmModelId(dto.getLlmModelId());
        }
        if (dto.getVllmModelId() != null) {
            existingEntity.setVllmModelId(dto.getVllmModelId());
        }
        if (dto.getTtsModelId() != null) {
            existingEntity.setTtsModelId(dto.getTtsModelId());
        }
        if (dto.getTtsVoiceId() != null) {
            existingEntity.setTtsVoiceId(dto.getTtsVoiceId());
        }
        if (dto.getMemModelId() != null) {
            existingEntity.setMemModelId(dto.getMemModelId());
        }
        if (dto.getIntentModelId() != null) {
            existingEntity.setIntentModelId(dto.getIntentModelId());
        }
        if (dto.getSystemPrompt() != null) {
            existingEntity.setSystemPrompt(dto.getSystemPrompt());
        }
        if (dto.getSummaryMemory() != null) {
            existingEntity.setSummaryMemory(dto.getSummaryMemory());
        }
        if (dto.getChatHistoryConf() != null) {
            existingEntity.setChatHistoryConf(dto.getChatHistoryConf());
        }
        if (dto.getLangCode() != null) {
            existingEntity.setLangCode(dto.getLangCode());
        }
        if (dto.getLanguage() != null) {
            existingEntity.setLanguage(dto.getLanguage());
        }
        if (dto.getSort() != null) {
            existingEntity.setSort(dto.getSort());
        }

        // UpdateFunctionPluginInformation
        List<AgentUpdateDTO.FunctionInfo> functions = dto.getFunctions();
        if (functions != null) {
            // 1. CollectThisSubmits  pluginId
            List<String> newPluginIds = functions.stream()
                    .map(AgentUpdateDTO.FunctionInfo::getPluginId)
                    .toList();

            // 2. QueryCurrentagentCurrentHaves AllMapping
            List<AgentPluginMapping> existing = agentPluginMappingService.list(
                    new QueryWrapper<AgentPluginMapping>()
                            .eq("agent_id", agentId));
            Map<String, AgentPluginMapping> existMap = existing.stream()
                    .collect(Collectors.toMap(AgentPluginMapping::getPluginId, Function.identity()));

            // 3. Construct all entities to save or update
            List<AgentPluginMapping> allToPersist = functions.stream().map(info -> {
                AgentPluginMapping m = new AgentPluginMapping();
                m.setAgentId(agentId);
                m.setPluginId(info.getPluginId());
                m.setParamInfo(JsonUtils.toJsonString(info.getParamInfo()));
                AgentPluginMapping old = existMap.get(info.getPluginId());
                if (old != null) {
                    // Already exists, set id to indicate update
                    m.setId(old.getId());
                }
                return m;
            }).toList();

            // 4. Split: Execute update for those with IDs, execute insert for those without IDs
            List<AgentPluginMapping> toUpdate = allToPersist.stream()
                    .filter(m -> m.getId() != null)
                    .toList();
            List<AgentPluginMapping> toInsert = allToPersist.stream()
                    .filter(m -> m.getId() == null)
                    .toList();

            if (!toUpdate.isEmpty()) {
                agentPluginMappingService.updateBatchById(toUpdate);
            }
            if (!toInsert.isEmpty()) {
                agentPluginMappingService.saveBatch(toInsert);
            }

            // 5. Delete plugin mappings not in the submitted list
            List<Long> toDelete = existing.stream()
                    .filter(old -> !newPluginIds.contains(old.getPluginId()))
                    .map(AgentPluginMapping::getId)
                    .toList();
            if (!toDelete.isEmpty()) {
                agentPluginMappingService.removeBatchByIds(toDelete);
            }
        }

        // SetUpdaterInformation
        UserDetail user = SecurityUser.getUser();
        existingEntity.setUpdater(user.getId());
        existingEntity.setUpdatedAt(new Date());

        // Update memory strategy
        if (existingEntity.getMemModelId() == null || existingEntity.getMemModelId().equals(Constant.MEMORY_NO_MEM)) {
            // DeleteAllRecord
            agentChatHistoryService.deleteByAgentId(existingEntity.getId(), true, true);
            existingEntity.setSummaryMemory("");
        } else if (existingEntity.getChatHistoryConf() != null && existingEntity.getChatHistoryConf() == 1) {
            // DeleteAudioData
            agentChatHistoryService.deleteByAgentId(existingEntity.getId(), true, false);
        }

        boolean b = validateLLMIntentParams(dto.getLlmModelId(), dto.getIntentModelId());
        if (!b) {
            throw new RenException("LLM large model and intent recognition selected parameters do not match");
        }
        this.updateById(existingEntity);
    }

    /**
     * Validate whether large language model and intent recognition parameters match
     *
     * @param llmModelId    Large language model ID
     * @param intentModelId Intent recognition ID
     * @return true if matched, false if not matched
     */
    private boolean validateLLMIntentParams(String llmModelId, String intentModelId) {
        if (StringUtils.isBlank(llmModelId)) {
            return true;
        }
        ModelConfigEntity llmModelData = modelConfigService.selectById(llmModelId);
        if (llmModelData == null || llmModelData.getConfigJson() == null) {
            return true;
        }
        String type = llmModelData.getConfigJson().get("type").toString();
        // If query large language model is openai or ollama, any intent recognition parameter is valid
        if ("openai".equals(type) || "ollama".equals(type)) {
            return true;
        }
        // For types other than openai and ollama, cannot select id as Intent_function_call (function call) intent recognition
        return !"Intent_function_call".equals(intentModelId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String createAgent(AgentCreateDTO dto) {
        // ConvertAsEntity
        AgentEntity entity = ConvertUtils.sourceToTarget(dto, AgentEntity.class);

        // GetDefaultTemplate
        AgentTemplateEntity template = agentTemplateService.getDefaultTemplate();
        if (template != null) {
            // Set default values from template
            entity.setAsrModelId(template.getAsrModelId());
            entity.setVadModelId(template.getVadModelId());
            entity.setLlmModelId(template.getLlmModelId());
            entity.setVllmModelId(template.getVllmModelId());
            entity.setTtsModelId(template.getTtsModelId());
            entity.setTtsVoiceId(template.getTtsVoiceId());
            entity.setMemModelId(template.getMemModelId());
            entity.setIntentModelId(template.getIntentModelId());
            entity.setSystemPrompt(template.getSystemPrompt());
            entity.setSummaryMemory(template.getSummaryMemory());
            entity.setChatHistoryConf(template.getChatHistoryConf());
            entity.setLangCode(template.getLangCode());
            entity.setLanguage(template.getLanguage());
            
            // Override with Cheeko defaults
            entity.setAgentName("Cheeko");  // Always use Cheeko name
            entity.setMemModelId("Memory_mem_local_short");  // Always use Local Short Term memory
            entity.setChatHistoryConf(1);  // Always enable Report Text
            entity.setTtsModelId("TTS_EdgeTTS");  // Always use EdgeTTS model
            entity.setTtsVoiceId("TTS_EdgeTTS_Ana");  // Always use EdgeTTS Ana voice (en-US-AnaNeural)
            
            // Log the overridden values for debugging
            System.out.println("Creating agent with overridden defaults:");
            System.out.println("  Memory: " + entity.getMemModelId());
            System.out.println("  TTS Model: " + entity.getTtsModelId());
            System.out.println("  TTS Voice: " + entity.getTtsVoiceId());
        }

        // Set user ID and creator information
        UserDetail user = SecurityUser.getUser();
        entity.setUserId(user.getId());
        entity.setCreator(user.getId());
        entity.setCreatedAt(new Date());

        // SaveAgent
        insert(entity);

        // FirstCheckWhetherHaveExistPluginMapping
        List<AgentPluginMapping> existingMappings = agentPluginMappingService.list(
                new QueryWrapper<AgentPluginMapping>()
                        .eq("agent_id", entity.getId()));
        
        // CollectHaveExists PluginID
        Set<String> existingPluginIds = existingMappings.stream()
                .map(AgentPluginMapping::getPluginId)
                .collect(Collectors.toSet());

        // SetDefaultPlugin
        List<AgentPluginMapping> toInsert = new ArrayList<>();
        // PlaybackMusic、PlaybackStory、QueryWeather、QueryNews
        String[] pluginIds = new String[] { "SYSTEM_PLUGIN_MUSIC", "SYSTEM_PLUGIN_STORY", 
                "SYSTEM_PLUGIN_WEATHER", "SYSTEM_PLUGIN_NEWS_NEWSNOW" };
        
        for (String pluginId : pluginIds) {
            // SkipHaveExists PluginMapping
            if (existingPluginIds.contains(pluginId)) {
                continue;
            }
            
            ModelProviderDTO provider = modelProviderService.getById(pluginId);
            if (provider == null) {
                continue;
            }
            AgentPluginMapping mapping = new AgentPluginMapping();
            mapping.setPluginId(pluginId);

            Map<String, Object> paramInfo = new HashMap<>();
            List<Map<String, Object>> fields = JsonUtils.parseObject(provider.getFields(), List.class);
            if (fields != null) {
                for (Map<String, Object> field : fields) {
                    paramInfo.put((String) field.get("key"), field.get("default"));
                }
            }
            mapping.setParamInfo(JsonUtils.toJsonString(paramInfo));
            mapping.setAgentId(entity.getId());
            toInsert.add(mapping);
        }

        // Only save when there are new plugins to insert
        if (!toInsert.isEmpty()) {
            agentPluginMappingService.saveBatch(toInsert);
        }
        return entity.getId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String updateAgentMode(String agentId, String modeName) {
        // 1. Verify agent exists
        AgentEntity agent = this.selectById(agentId);
        if (agent == null) {
            throw new RenException("Agent does not exist");
        }

        // 2. Query template by name
        AgentTemplateEntity template = agentTemplateService.getTemplateByName(modeName);
        if (template == null) {
            throw new RenException("Template '" + modeName + "' does not exist");
        }

        // Log old prompt
        String oldPrompt = agent.getSystemPrompt();
        String oldPromptPreview = oldPrompt != null && oldPrompt.length() > 100
            ? oldPrompt.substring(0, 100) + "..."
            : oldPrompt;

        // 3. Copy template config to agent (preserve agent identity and audit info)
        agent.setAsrModelId(template.getAsrModelId());
        agent.setVadModelId(template.getVadModelId());
        agent.setLlmModelId(template.getLlmModelId());
        agent.setVllmModelId(template.getVllmModelId());
        agent.setTtsModelId(template.getTtsModelId());
        agent.setTtsVoiceId(template.getTtsVoiceId());
        agent.setMemModelId(template.getMemModelId());
        agent.setIntentModelId(template.getIntentModelId());
        agent.setSystemPrompt(template.getSystemPrompt());
        agent.setChatHistoryConf(template.getChatHistoryConf());
        agent.setLangCode(template.getLangCode());
        agent.setLanguage(template.getLanguage());
        agent.setAgentName(template.getAgentName());

        // Log new prompt
        String newPrompt = template.getSystemPrompt();
        String newPromptPreview = newPrompt != null && newPrompt.length() > 100
            ? newPrompt.substring(0, 100) + "..."
            : newPrompt;

        // 4. UpdateAuditInformation
        try {
            UserDetail user = SecurityUser.getUser();
            if (user != null) {
                agent.setUpdater(user.getId());
            }
        } catch (Exception e) {
            // Server secret filter - no user context, skip updater
        }
        agent.setUpdatedAt(new Date());

        // 5. Update database
        this.updateById(agent);

        // Log update details
        System.out.println("🔄 ===== AGENT MODE UPDATE =====");
        System.out.println("Agent ID: " + agentId);
        System.out.println("Agent Name: " + agent.getAgentName());
        System.out.println("Template: " + modeName + " (" + template.getId() + ")");
        System.out.println("Old Prompt Preview: " + oldPromptPreview);
        System.out.println("New Prompt Preview: " + newPromptPreview);
        System.out.println("New LLM Model: " + template.getLlmModelId());
        System.out.println("New TTS Model: " + template.getTtsModelId());
        System.out.println("New Memory Model: " + template.getMemModelId());
        System.out.println("Database Updated: YES ✅");
        System.out.println("================================");

        // 6. Return the updated prompt
        return newPrompt;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public AgentModeCycleResponse cycleAgentModeByMac(String macAddress) {
        // 1. Get device by MAC address
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            throw new RenException("Device not found for MAC address: " + macAddress);
        }

        // 2. Get current agent
        AgentEntity agent = this.selectById(device.getAgentId());
        if (agent == null) {
            throw new RenException("No agent associated with device");
        }

        String currentModeName = agent.getAgentName();

        // 3. Get all visible templates ordered by sort
        List<AgentTemplateEntity> allTemplates = agentTemplateService.list(
            new QueryWrapper<AgentTemplateEntity>()
                .eq("is_visible", 1)
                .orderByAsc("sort")
        );

        if (allTemplates.isEmpty()) {
            throw new RenException("No templates available");
        }

        if (allTemplates.size() == 1) {
            // Only one mode available, cannot cycle
            AgentModeCycleResponse response = new AgentModeCycleResponse();
            response.setSuccess(false);
            response.setAgentId(agent.getId());
            response.setOldModeName(currentModeName);
            response.setNewModeName(currentModeName);
            response.setModeIndex(0);
            response.setTotalModes(1);
            response.setMessage("Only one mode available, cannot cycle");
            return response;
        }

        // 4. Find current template index by name
        int currentIndex = -1;
        for (int i = 0; i < allTemplates.size(); i++) {
            if (allTemplates.get(i).getAgentName().equalsIgnoreCase(currentModeName)) {
                currentIndex = i;
                break;
            }
        }

        // 5. Calculate next index (cycle to next mode)
        int nextIndex = (currentIndex + 1) % allTemplates.size();
        AgentTemplateEntity nextTemplate = allTemplates.get(nextIndex);

        // 6. Update agent with template configuration
        String oldModeName = agent.getAgentName();

        agent.setAgentName(nextTemplate.getAgentName());
        agent.setAsrModelId(nextTemplate.getAsrModelId());
        agent.setVadModelId(nextTemplate.getVadModelId());
        agent.setLlmModelId(nextTemplate.getLlmModelId());
        agent.setVllmModelId(nextTemplate.getVllmModelId());
        agent.setTtsModelId(nextTemplate.getTtsModelId());
        agent.setTtsVoiceId(nextTemplate.getTtsVoiceId());
        agent.setMemModelId(nextTemplate.getMemModelId());
        agent.setIntentModelId(nextTemplate.getIntentModelId());
        agent.setSystemPrompt(nextTemplate.getSystemPrompt());
        agent.setChatHistoryConf(nextTemplate.getChatHistoryConf());
        agent.setLangCode(nextTemplate.getLangCode());
        agent.setLanguage(nextTemplate.getLanguage());

        // 7. Update audit info
        try {
            UserDetail user = SecurityUser.getUser();
            if (user != null) {
                agent.setUpdater(user.getId());
            }
        } catch (Exception e) {
            // Server secret filter - no user context, skip updater
        }
        agent.setUpdatedAt(new Date());

        // 8. Save to database
        this.updateById(agent);

        // 9. Build response
        AgentModeCycleResponse response = new AgentModeCycleResponse();
        response.setSuccess(true);
        response.setAgentId(agent.getId());
        response.setOldModeName(oldModeName);
        response.setNewModeName(nextTemplate.getAgentName());
        response.setModeIndex(nextIndex);
        response.setTotalModes(allTemplates.size());
        response.setMessage("Mode changed successfully from " + oldModeName + " to " + nextTemplate.getAgentName());
        response.setNewSystemPrompt(nextTemplate.getSystemPrompt());

        // 10. Log the change
        System.out.println("🔘 ===== AGENT MODE CYCLE (BUTTON) =====");
        System.out.println("Device MAC: " + macAddress);
        System.out.println("Agent ID: " + agent.getId());
        System.out.println("Mode Change: " + oldModeName + " → " + nextTemplate.getAgentName());
        System.out.println("Mode Index: " + nextIndex + " / " + allTemplates.size());
        System.out.println("New LLM Model: " + nextTemplate.getLlmModelId());
        System.out.println("New TTS Model: " + nextTemplate.getTtsModelId());
        System.out.println("Database Updated: YES ✅");
        System.out.println("========================================");

        return response;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public AgentModeCycleResponse setAgentCharacterByMac(String macAddress, String characterName) {
        log.info("🎭 [SET-CHARACTER] Request: MAC={}, character='{}'", macAddress, characterName);

        // 1. Get device by MAC address
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            log.error("🎭 [SET-CHARACTER] Device not found for MAC: {}", macAddress);
            throw new RenException("Device not found for MAC address: " + macAddress);
        }
        log.info("🎭 [SET-CHARACTER] Found device: {}, agentId: {}", device.getId(), device.getAgentId());

        // 2. Get current agent
        AgentEntity agent = this.selectById(device.getAgentId());
        if (agent == null) {
            log.error("🎭 [SET-CHARACTER] No agent for device");
            throw new RenException("No agent associated with device");
        }

        String oldModeName = agent.getAgentName();
        log.info("🎭 [SET-CHARACTER] Current agent: '{}', switching to: '{}'", oldModeName, characterName);

        // 3. Find template by character name (case-insensitive)
        AgentTemplateEntity targetTemplate = agentTemplateService.getOne(
            new QueryWrapper<AgentTemplateEntity>()
                .eq("is_visible", 1)
                .eq("agent_name", characterName)
        );
        log.info("🎭 [SET-CHARACTER] Exact match template: {}", targetTemplate != null ? targetTemplate.getAgentName() : "NOT FOUND");

        if (targetTemplate == null) {
            // Try case-insensitive search
            log.info("🎭 [SET-CHARACTER] Trying case-insensitive search...");
            List<AgentTemplateEntity> allTemplates = agentTemplateService.list(
                new QueryWrapper<AgentTemplateEntity>()
                    .eq("is_visible", 1)
            );
            log.info("🎭 [SET-CHARACTER] Found {} visible templates", allTemplates.size());

            for (AgentTemplateEntity template : allTemplates) {
                log.debug("🎭 [SET-CHARACTER] Comparing '{}' with '{}'", template.getAgentName(), characterName);
                if (template.getAgentName().equalsIgnoreCase(characterName)) {
                    targetTemplate = template;
                    log.info("🎭 [SET-CHARACTER] Case-insensitive match found: '{}'", template.getAgentName());
                    break;
                }
            }
        }

        if (targetTemplate == null) {
            log.error("🎭 [SET-CHARACTER] Template NOT FOUND for character: '{}'", characterName);
            AgentModeCycleResponse response = new AgentModeCycleResponse();
            response.setSuccess(false);
            response.setAgentId(agent.getId());
            response.setOldModeName(oldModeName);
            response.setNewModeName(oldModeName);
            response.setMessage("Character not found: " + characterName);
            return response;
        }
        log.info("🎭 [SET-CHARACTER] Using template: '{}' (id: {})", targetTemplate.getAgentName(), targetTemplate.getId());

        // 4. Check if already on this character
        if (oldModeName.equalsIgnoreCase(characterName)) {
            AgentModeCycleResponse response = new AgentModeCycleResponse();
            response.setSuccess(true);
            response.setAgentId(agent.getId());
            response.setOldModeName(oldModeName);
            response.setNewModeName(oldModeName);
            response.setMessage("Already on character: " + characterName);
            return response;
        }

        // 5. Update agent with template configuration
        agent.setAgentName(targetTemplate.getAgentName());
        agent.setAsrModelId(targetTemplate.getAsrModelId());
        agent.setVadModelId(targetTemplate.getVadModelId());
        agent.setLlmModelId(targetTemplate.getLlmModelId());
        agent.setVllmModelId(targetTemplate.getVllmModelId());
        agent.setTtsModelId(targetTemplate.getTtsModelId());
        agent.setTtsVoiceId(targetTemplate.getTtsVoiceId());
        agent.setMemModelId(targetTemplate.getMemModelId());
        agent.setIntentModelId(targetTemplate.getIntentModelId());
        agent.setSystemPrompt(targetTemplate.getSystemPrompt());
        agent.setChatHistoryConf(targetTemplate.getChatHistoryConf());
        agent.setLangCode(targetTemplate.getLangCode());
        agent.setLanguage(targetTemplate.getLanguage());

        // 6. Update audit info
        try {
            UserDetail user = SecurityUser.getUser();
            if (user != null) {
                agent.setUpdater(user.getId());
            }
        } catch (Exception e) {
            // Server secret filter - no user context, skip updater
        }
        agent.setUpdatedAt(new Date());

        // 7. Save to database
        this.updateById(agent);

        // 8. Build response
        AgentModeCycleResponse response = new AgentModeCycleResponse();
        response.setSuccess(true);
        response.setAgentId(agent.getId());
        response.setOldModeName(oldModeName);
        response.setNewModeName(targetTemplate.getAgentName());
        response.setMessage("Character changed successfully from " + oldModeName + " to " + targetTemplate.getAgentName());
        response.setNewSystemPrompt(targetTemplate.getSystemPrompt());

        // 9. Log the change
        System.out.println("🎭 ===== SET AGENT CHARACTER =====");
        System.out.println("Device MAC: " + macAddress);
        System.out.println("Agent ID: " + agent.getId());
        System.out.println("Character Change: " + oldModeName + " → " + targetTemplate.getAgentName());
        System.out.println("New LLM Model: " + targetTemplate.getLlmModelId());
        System.out.println("New TTS Model: " + targetTemplate.getTtsModelId());
        System.out.println("Database Updated: YES ✅");
        System.out.println("==================================");

        return response;
    }
}
