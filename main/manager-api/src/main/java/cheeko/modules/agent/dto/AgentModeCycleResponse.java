package cheeko.modules.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * Agent mode cycle response DTO
 * Used when cycling agent modes via button press
 */
@Data
@Schema(description = "Agent mode cycle response")
public class AgentModeCycleResponse implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Success status")
    private boolean success;

    @Schema(description = "Agent ID")
    private String agentId;

    @Schema(description = "Previous mode name")
    private String oldModeName;

    @Schema(description = "New mode name")
    private String newModeName;

    @Schema(description = "Current mode index (0-based)")
    private Integer modeIndex;

    @Schema(description = "Total number of available modes")
    private Integer totalModes;

    @Schema(description = "Success/error message")
    private String message;

    @Schema(description = "New system prompt (for LiveKit update)")
    private String newSystemPrompt;
}
