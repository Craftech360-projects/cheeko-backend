package xiaozhi.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "Accessory response")
public class AccessoryResponseDTO {

    @Schema(description = "Accessory ID")
    private Long id;

    @Schema(description = "User ID (owner)")
    private Long userId;

    @Schema(description = "Parent toy MAC address")
    private String toyMac;

    @Schema(description = "Accessory MAC address")
    private String accessoryMac;

    @Schema(description = "Accessory type (car, lamp, etc.)")
    private String accessoryType;
}
