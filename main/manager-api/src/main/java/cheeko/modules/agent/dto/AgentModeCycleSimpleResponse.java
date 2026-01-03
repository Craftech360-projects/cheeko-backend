package cheeko.modules.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * Simplified agent mode cycle response for firmware
 * Contains only essential information
 */
@Data
@Schema(description = "Simplified agent mode cycle response")
public class AgentModeCycleSimpleResponse implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Success status")
    private boolean success;

    @Schema(description = "Agent ID")
    private String agentId;

    @Schema(description = "Old mode name")
    private String oldModeName;

    @Schema(description = "New mode name")
    private String newModeName;
}
