package cheeko.modules.agent.service;

import java.util.List;

import com.baomidou.mybatisplus.extension.service.IService;

import cheeko.modules.agent.entity.AgentPluginMapping;

/**
 * @description Database operation service for table【ai_agent_plugin_mapping(Agent and plugin unique mapping table)】
 * @createDate 2025-05-25 22:33:17
 */
public interface AgentPluginMappingService extends IService<AgentPluginMapping> {

    /**
     * Get plugin parameters by agent ID
     * 
     * @param agentId
     * @return
     */
    List<AgentPluginMapping> agentPluginParamsByAgentId(String agentId);

    /**
     * Delete plugin parameters by agent ID
     * 
     * @param agentId
     */
    void deleteByAgentId(String agentId);
}
