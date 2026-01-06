package cheeko.modules.agent.service.biz;

import cheeko.modules.agent.dto.AgentChatHistoryReportDTO;
import cheeko.modules.agent.dto.AgentChatHistorySessionDTO;

/**
 * Agent Chat History Business Logic Layer
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
public interface AgentChatHistoryBizService {

    /**
     * Chat report method
     *
     * @param agentChatHistoryReportDTO Input object containing chat report information,
     *                                  e.g., device MAC address, file type, content, etc.
     * @return Upload result, true indicates success, false indicates failure
     */
    Boolean report(AgentChatHistoryReportDTO agentChatHistoryReportDTO);

    /**
     * LiveKit Agent session batch upload
     * Saves entire session chat history at once when room closes
     *
     * @param sessionDTO Contains all messages from the session
     * @return true if successful, false if failed
     */
    Boolean reportSession(AgentChatHistorySessionDTO sessionDTO);
}
