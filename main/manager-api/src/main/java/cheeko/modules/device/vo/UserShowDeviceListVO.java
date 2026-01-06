package cheeko.modules.device.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "User display device list VO")
public class UserShowDeviceListVO {

    @Schema(description = "appVersion")
    private String appVersion;

    @Schema(description = "Bound username")
    private String bindUserName;

    @Schema(description = "Device model")
    private String deviceType;

    @Schema(description = "Device unique identifier")
    private String id;

    @Schema(description = "Agent ID")
    private String agentId;

    @Schema(description = "macAddress")
    private String macAddress;

    @Schema(description = "EnableOTA")
    private Integer otaUpgrade;

    @Schema(description = "Recent chat time")
    private String recentChatTime;

}