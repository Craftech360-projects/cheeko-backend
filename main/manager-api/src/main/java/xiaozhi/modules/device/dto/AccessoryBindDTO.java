package xiaozhi.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
@Schema(description = "Accessory binding request (from QR code scan)")
public class AccessoryBindDTO {

    @NotBlank(message = "Accessory MAC address is required")
    @Schema(description = "Accessory MAC address (from QR code)")
    private String accessoryMac;

    @Schema(description = "Accessory type (default: car)")
    private String accessoryType = "car";
}
