package cheeko.modules.agent.service.biz;

import cheeko.modules.agent.dto.AgentChatHistoryReportDTO;
import cheeko.modules.agent.dto.AgentChatHistorySessionDTO;

/**
 * AgentChatHistory业务逻辑层
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
public interface AgentChatHistoryBizService {

    /**
     * ChatReportMethod
     *
     * @param agentChatHistoryReportDTO 包含ChatReport所需Informations 输入Object
     *                                  For example：DeviceMACAddress、FileType、Content等
     * @return UploadResult，trueTable示Success，falseTable示Failure
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
