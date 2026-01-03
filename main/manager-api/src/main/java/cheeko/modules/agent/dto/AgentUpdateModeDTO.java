package cheeko.modules.agent.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Agent mode update DTO
 * Used to update agent configuration by template name
 */
@Data
@Schema(description = "Agent mode update object")
public class AgentUpdateModeDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "AgentID", example = "abc123def456", required = true)
    @NotBlank(message = "Agent ID cannot be empty")
    private String agentId;

    @Schema(description = "Template mode name", example = "Cheeko", required = true)
    @NotBlank(message = "Mode name cannot be empty")
    private String modeName;
}
