package xiaozhi.modules.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

/**
 * LiveKit Agent session chat history batch upload request
 * Used when room closes to upload all messages at once
 */
@Data
@Schema(description = "LiveKit Agent session chat history batch upload")
public class AgentChatHistorySessionDTO {
    @Schema(description = "MAC address", example = "28562f06a290")
    @NotBlank
    private String macAddress;

    @Schema(description = "Session ID (room name)", example = "c109722e-5b1f-465f-8b50-48c2c46e8d77_28562f06a290_conversation")
    @NotBlank
    private String sessionId;

    @Schema(description = "Agent ID", example = "agent-123")
    private String agentId;

    @Schema(description = "List of chat messages")
    private List<ChatMessage> messages;

    @Schema(description = "Total message count", example = "10")
    private Integer messageCount;

    @Schema(description = "Session end timestamp (seconds)", example = "1745657732")
    private Long sessionEnd;

    @Data
    @Schema(description = "Individual chat message")
    public static class ChatMessage {
        @Schema(description = "Message type: 1-user, 2-agent", example = "1")
        private Integer chatType;

        @Schema(description = "Message content", example = "Hello!")
        private String content;

        @Schema(description = "Message timestamp (seconds)", example = "1745657732")
        private Long timestamp;
    }
}
