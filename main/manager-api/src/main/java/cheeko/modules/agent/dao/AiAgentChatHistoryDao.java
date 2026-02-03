package cheeko.modules.agent.dao;

import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.agent.entity.AgentChatHistoryEntity;

/**
 * {@link AgentChatHistoryEntity} AgentChatHistoryRecordDaoObject
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
@Mapper
public interface AiAgentChatHistoryDao extends BaseMapper<AgentChatHistoryEntity> {

    /**
     * Get count of unique devices that interacted today
     *
     * @return Count of unique devices
     */
    Integer getTodayDeviceCount();

    /**
     * Get count of unique devices that interacted this month
     *
     * @return Count of unique devices
     */
    Integer getMonthDeviceCount();

    /**
     * Get list of active devices today with MAC and agent name
     *
     * @return List of device info maps
     */
    List<Map<String, Object>> getTodayActiveDevices();

    /**
     * Get list of active devices this month with MAC and agent name
     *
     * @return List of device info maps
     */
    List<Map<String, Object>> getMonthActiveDevices();

    /**
     * ByAgentIDDeleteChatHistoryRecord
     *
     * @param agentId AgentID
     */
    void deleteHistoryByAgentId(String agentId);

    /**
     * ByAgentIDDeleteAudioID
     *
     * @param agentId AgentID
     */
    void deleteAudioIdByAgentId(String agentId);
}
