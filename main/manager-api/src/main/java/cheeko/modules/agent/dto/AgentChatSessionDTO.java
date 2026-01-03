package cheeko.modules.agent.dto;

import java.util.Date;

import lombok.Data;

/**
 * AgentSessionListDTO
 */
@Data
public class AgentChatSessionDTO {
    /**
     * SessionID
     */
    private String sessionId;

    /**
     * SessionTime
     */
    private Date createdAt;

    /**
     * ChatCount
     */
    private Integer chatCount;
}