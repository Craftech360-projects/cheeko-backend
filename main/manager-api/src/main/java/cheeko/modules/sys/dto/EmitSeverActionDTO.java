package cheeko.modules.sys.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import cheeko.modules.sys.enums.ServerActionEnum;

/**
 * Send to python server operation DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmitSeverActionDTO
{
    @Schema(description = "Target WebSocket address")
    @NotEmpty(message = "Target WebSocket address cannot be empty")
    private String targetWs;

    @Schema(description = "Specified operation")
    @NotNull(message = "Operation cannot be empty")
    private ServerActionEnum action;
}
