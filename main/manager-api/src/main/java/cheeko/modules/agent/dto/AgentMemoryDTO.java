package cheeko.modules.agent.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Agent memory update DTO
 */
@Data
@Schema(description = "Agent memory update object")
public class AgentMemoryDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Summary memory", example = "Build a growable dynamic memory network, retain key information within limited space, and intelligently maintain information evolution trajectory\n" +
            "Summarize important user information from conversation records to provide more personalized service in future conversations", required = false)
    private String summaryMemory;
}