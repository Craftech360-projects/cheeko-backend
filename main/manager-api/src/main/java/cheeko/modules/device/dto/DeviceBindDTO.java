package cheeko.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * DeviceBinds DTO
 * 
 * @author zjy
 * @since 2025-3-28
 */
@Data
@AllArgsConstructor
@Schema(description = "DeviceConnectionHeaderInformation")
public class DeviceBindDTO {

    @Schema(description = "macAddress")
    private String macAddress;

    @Schema(description = "Belongs to user ID")
    private Long userId;

    @Schema(description = "Agentid")
    private String agentId;

}