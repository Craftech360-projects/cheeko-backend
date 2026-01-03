package cheeko.modules.device.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * Assign Kid to Device DTO
 */
@Data
@Schema(description = "Assign Kid to Device Request")
public class AssignKidToDeviceDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Kid Profile ID", required = true)
    @NotNull(message = "Kid ID cannot be null")
    private Long kidId;
}
