package cheeko.modules.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * XiaoZhi device chat report request
 *
 * @author Haotian
 * @version 1.0, 2025/5/8
 */
@Data
@Schema(description = "XiaoZhi device chat report request")
public class AgentChatHistoryReportDTO {
    @Schema(description = "MACAddress", example = "00:11:22:33:44:55")
    @NotBlank
    private String macAddress;
    @Schema(description = "SessionID", example = "79578c31-f1fb-426a-900e-1e934215f05a")
    @NotBlank
    private String sessionId;
    @Schema(description = "MessageType: 1-User, 2-Agent", example = "1")
    @NotNull
    private Byte chatType;
    @Schema(description = "Chat content", example = "Hello")
    @NotBlank
    private String content;
    @Schema(description = "base64Codes opusAudioData", example = "")
    private String audioBase64;
    @Schema(description = "Report time, 10-digit timestamp, default use current time when empty", example = "1745657732")
    private Long reportTime;
}
