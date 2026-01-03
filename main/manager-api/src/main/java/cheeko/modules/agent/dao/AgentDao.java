package cheeko.modules.agent.dao;

import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import cheeko.common.dao.BaseDao;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.vo.AgentInfoVO;

@Mapper
public interface AgentDao extends BaseDao<AgentEntity> {
    /**
     * Get agent's device count
     * 
     * @param agentId Agent ID
     * @return Device count
     */
    Integer getDeviceCountByAgentId(@Param("agentId") String agentId);

    /**
     * Query corresponding device's default agent information by device MAC address
     *
     * @param macAddress Device MAC address
     * @return Default agent information
     */
    @Select(" SELECT a.* FROM ai_device d " +
            " LEFT JOIN ai_agent a ON d.agent_id = a.id " +
            " WHERE REPLACE(REPLACE(LOWER(d.mac_address), ':', ''), '-', '') = REPLACE(REPLACE(LOWER(#{macAddress}), ':', ''), '-', '') " +
            " ORDER BY d.id DESC LIMIT 1")
    AgentEntity getDefaultAgentByMacAddress(@Param("macAddress") String macAddress);

    /**
     * Get all agents and their owner information (admin dedicated)
     *
     * @return All agent list and user information
     */
    @Select("SELECT " +
            "a.id, a.agent_name, a.system_prompt, a.tts_model_id, " +
            "a.llm_model_id, a.vllm_model_id, a.mem_model_id, a.tts_voice_id, " +
            "a.created_at, a.updated_at, a.user_id, " +
            "u.username as owner_username, " +
            "GROUP_CONCAT(d.mac_address SEPARATOR ',') as device_mac_addresses " +
            "FROM ai_agent a " +
            "LEFT JOIN sys_user u ON a.user_id = u.id " +
            "LEFT JOIN ai_device d ON a.id = d.agent_id " +
            "GROUP BY a.id " +
            "ORDER BY a.created_at DESC")
    List<Map<String, Object>> getAllAgentsWithOwnerInfo();

    /**
     * Query agent information by ID, including plugin information
     *
     * @param agentId Agent ID
     */
    AgentInfoVO selectAgentInfoById(@Param("agentId") String agentId);
}
