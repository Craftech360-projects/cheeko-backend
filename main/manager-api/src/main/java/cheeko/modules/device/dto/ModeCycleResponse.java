package cheeko.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Device mode switching response
 */
@Data
@Schema(description = "Device mode switching response")
public class ModeCycleResponse {

    @Schema(description = "WhetherSuccess")
    private boolean success;

    @Schema(description = "DeviceID")
    private String deviceId;

    @Schema(description = "Old mode")
    private String oldMode;

    @Schema(description = "New mode")
    private String newMode;

    @Schema(description = "Message")
    private String message;
}
