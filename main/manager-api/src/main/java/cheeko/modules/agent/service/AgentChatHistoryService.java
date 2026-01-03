package cheeko.modules.agent.service;

import java.util.List;
import java.util.Map;

import com.baomidou.mybatisplus.extension.service.IService;

import cheeko.common.page.PageData;
import cheeko.modules.agent.dto.AgentChatHistoryDTO;
import cheeko.modules.agent.dto.AgentChatSessionDTO;
import cheeko.modules.agent.entity.AgentChatHistoryEntity;
import cheeko.modules.agent.vo.AgentChatHistoryUserVO;

/**
 * Agent chat record table handling service
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
public interface AgentChatHistoryService extends IService<AgentChatHistoryEntity> {

    /**
     * Get session list by agent ID
     *
     * @param params Query parameters, includes agentId, page, limit
     * @return Pagination session list
     */
    PageData<AgentChatSessionDTO> getSessionListByAgentId(Map<String, Object> params);

    /**
     * Get chat record list by session ID
     *
     * @param agentId   Agent ID
     * @param sessionId Session ID
     * @return Chat record list
     */
    List<AgentChatHistoryDTO> getChatHistoryBySessionId(String agentId, String sessionId);

    /**
     * Delete chat record by agent ID
     *
     * @param agentId     Agent ID
     * @param deleteAudio Whether delete audio
     * @param deleteText  Whether delete text
     */
    void deleteByAgentId(String agentId, Boolean deleteAudio, Boolean deleteText);

    /**
     * Get recent 50 user chat record data by agent ID (with audio data)
     *
     * @param agentId Agent ID
     * @return Chat record list (only has user)
     */
    List<AgentChatHistoryUserVO> getRecentlyFiftyByAgentId(String agentId);

    /**
     * Get chat content by audio data ID
     *
     * @param audioId Audio ID
     * @return Chat content
     */
    String getContentByAudioId(String audioId);


    /**
     * Query whether this audio ID belongs to this agent
     *
     * @param audioId Audio ID
     * @param agentId Agent ID
     * @return T: belongs F: does not belong
     */
    boolean isAudioOwnedByAgent(String audioId,String agentId);
}
