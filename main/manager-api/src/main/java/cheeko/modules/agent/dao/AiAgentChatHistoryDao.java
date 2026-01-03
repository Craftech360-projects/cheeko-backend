package cheeko.modules.agent.dao;

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
     * ByAgentIDDeleteAudio
     *
     * @param agentId AgentID
     */
    void deleteAudioByAgentId(String agentId);

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
