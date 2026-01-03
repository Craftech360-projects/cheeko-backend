package cheeko.modules.agent.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * AgentCreateDTO
 * Dedicated for adding agent, does not include id, agentCode and sort fields, these fields are auto-generated/set default values by system
 */
@Data
@Schema(description = "AgentCreateObject")
public class AgentCreateDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Agent name", example = "Customer service assistant")
    @NotBlank(message = "Agent name cannot be empty")
    private String agentName;
}