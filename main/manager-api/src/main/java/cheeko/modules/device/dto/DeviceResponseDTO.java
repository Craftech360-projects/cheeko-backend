package cheeko.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "Device Response")
public class DeviceResponseDTO {
    @Schema(description = "Device ID")
    private String id;

    @Schema(description = "MAC Address")
    private String macAddress;

    @Schema(description = "Agent ID")
    private String agentId;

    @Schema(description = "Device Alias/Name")
    private String alias;

    @Schema(description = "Board/Hardware Model")
    private String board;

    @Schema(description = "Kid ID (if assigned)")
    private Long kidId;

    @Schema(description = "App/Firmware Version")
    private String appVersion;
}
