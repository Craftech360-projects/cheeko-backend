package xiaozhi.modules.device.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * Update Device Control Mode DTO
 */
@Data
@Schema(description = "Update Device Control Mode Request")
public class UpdateDeviceModeDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Device MAC Address", required = true)
    @NotBlank(message = "MAC address cannot be empty")
    private String macAddress;

    @Schema(description = "Device control mode (manual/auto)", required = true)
    @NotBlank(message = "Device mode cannot be empty")
    @Pattern(regexp = "^(manual|auto)$", message = "Device mode must be 'manual' or 'auto'")
    private String deviceMode;
}
