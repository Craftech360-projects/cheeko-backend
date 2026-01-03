package cheeko.modules.agent.service;

import java.util.List;
import java.util.Map;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.agent.dto.AgentCreateDTO;
import cheeko.modules.agent.dto.AgentDTO;
import cheeko.modules.agent.dto.AgentModeCycleResponse;
import cheeko.modules.agent.dto.AgentUpdateDTO;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.vo.AgentInfoVO;

/**
 * Agent table handling service
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
public interface AgentService extends BaseService<AgentEntity> {
    /**
     * Get admin agent list
     *
     * @param params Query parameters
     * @return Pagination data
     */
    PageData<AgentEntity> adminAgentList(Map<String, Object> params);

    /**
     * Get agent by ID
     *
     * @param id Agent ID
     * @return AgentEntity
     */
    AgentInfoVO getAgentById(String id);

    /**
     * Insert agent
     *
     * @param entity AgentEntity
     * @return Whether success
     */
    boolean insert(AgentEntity entity);

    /**
     * Get user's agent list
     *
     * @param userId User ID
     * @return Agent list
     */
    List<AgentDTO> getUserAgents(Long userId);

    /**
     * Get all agent list (admin dedicated, includes user information)
     *
     * @return All agent list
     */
    List<AgentDTO> getAllAgentsForAdmin();

    /**
     * Delete agent by user ID
     *
     * @param userId User ID
     */
    void deleteAgentByUserId(Long userId);


    /**
     * Get device count by agent ID
     *
     * @param agentId Agent ID
     * @return Device count
     */
    Integer getDeviceCountByAgentId(String agentId);

    /**
     * Query corresponding device's default agent information by device MAC address
     *
     * @param macAddress Device MAC address
     * @return Default agent information, returns null when not exists
     */
    AgentEntity getDefaultAgentByMacAddress(String macAddress);

    /**
     * Check whether user has permission to access agent
     *
     * @param agentId Agent ID
     * @param userId  User ID
     * @return Whether has permission
     */
    boolean checkAgentPermission(String agentId, Long userId);

    /**
     * Update agent
     *
     * @param agentId Agent ID
     * @param dto     Information required to update agent
     */
    void updateAgentById(String agentId, AgentUpdateDTO dto);

    /**
     * Create agent
     *
     * @param dto Information required to create agent
     * @return Created agent ID
     */
    String createAgent(AgentCreateDTO dto);

    /**
     * Update agent mode by template name
     *
     * @param agentId  Agent ID
     * @param modeName Template name
     * @return Updated system prompt
     */
    String updateAgentMode(String agentId, String modeName);

    /**
     * Cycle switch agent mode by device MAC address
     * Used for device button triggered mode switching
     *
     * @param macAddress Device MAC address
     * @return Mode switching response information
     */
    AgentModeCycleResponse cycleAgentModeByMac(String macAddress);

    /**
     * Set specified agent role by device MAC address
     * Used for directly switching to specific role
     *
     * @param macAddress Device MAC address
     * @param characterName Role name
     * @return Role switching response information
     */
    AgentModeCycleResponse setAgentCharacterByMac(String macAddress, String characterName);
}
