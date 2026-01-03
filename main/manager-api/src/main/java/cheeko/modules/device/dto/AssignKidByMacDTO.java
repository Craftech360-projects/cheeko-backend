package cheeko.modules.device.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * Assign Kid to Device by MAC Address DTO
 */
@Data
@Schema(description = "Assign Kid to Device by MAC Request")
public class AssignKidByMacDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Device MAC Address", required = true)
    @NotBlank(message = "MAC address cannot be empty")
    private String macAddress;

    @Schema(description = "Kid Profile ID", required = true)
    @NotNull(message = "Kid ID cannot be null")
    private Long kidId;
}
