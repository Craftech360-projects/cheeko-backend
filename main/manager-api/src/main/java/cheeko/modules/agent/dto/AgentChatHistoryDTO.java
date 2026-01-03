package cheeko.modules.agent.dto;

import java.util.Date;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * AgentChatRecordDTO
 */
@Data
@Schema(description = "AgentChatRecord")
public class AgentChatHistoryDTO {
    @Schema(description = "Create Time")
    private Date createdAt;

    @Schema(description = "MessageType: 1-User, 2-Agent")
    private Byte chatType;

    @Schema(description = "ChatContent")
    private String content;

    @Schema(description = "AudioID")
    private String audioId;

    @Schema(description = "MACAddress")
    private String macAddress;
}