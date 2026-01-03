package cheeko.modules.agent.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Agent user personal chat data VO
 */
@Data
public class AgentChatHistoryUserVO {
    @Schema(description = "ChatContent")
    private String content;

    @Schema(description = "AudioID")
    private String audioId;
}
