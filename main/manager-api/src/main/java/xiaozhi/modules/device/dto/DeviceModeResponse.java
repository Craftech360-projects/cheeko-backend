package xiaozhi.modules.device.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Device Control Mode Update Response
 */
@Data
@Schema(description = "Device Control Mode Update Response")
public class DeviceModeResponse implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Device MAC Address")
    private String macAddress;

    @Schema(description = "New device control mode")
    private String deviceMode;

    @Schema(description = "Previous device control mode")
    private String previousMode;

    @Schema(description = "Update success flag")
    private boolean success;
}
