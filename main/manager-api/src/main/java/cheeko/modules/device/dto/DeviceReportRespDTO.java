package cheeko.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.Getter;
import lombok.Setter;

@Data
@Schema(description = "Device OTA version check response body, includes activation code requirements")
public class DeviceReportRespDTO {
    @Schema(description = "ServiceServerTime")
    private ServerTime server_time;

    @Schema(description = "ActivateCode")
    private Activation activation;

    @Schema(description = "ErrorInformation")
    private String error;

    @Schema(description = "FirmwareVersionInformation")
    private Firmware firmware;
    
    @Schema(description = "WebSocketConfiguration")
    private Websocket websocket;
    
    @Schema(description = "MQTTConfiguration")
    private Mqtt mqtt;

    @Getter
    @Setter
    public static class Firmware {
        @Schema(description = "Version number")
        private String version;
        @Schema(description = "DownloadAddress")
        private String url;
        @Schema(description = "Whether force update: 0-No, 1-Yes")
        private Integer force;
    }

    public static DeviceReportRespDTO createError(String message) {
        DeviceReportRespDTO resp = new DeviceReportRespDTO();
        resp.setError(message);
        return resp;
    }

    @Setter
    @Getter
    public static class Activation {
        @Schema(description = "ActivateCode")
        private String code;

        @Schema(description = "ActivateCodeInformation: ActivateAddress")
        private String message;

        @Schema(description = "Challenge code")
        private String challenge;
    }

    @Getter
    @Setter
    public static class ServerTime {
        @Schema(description = "Timestamp")
        private Long timestamp;

        @Schema(description = "Timezone")
        private String timeZone;

        @Schema(description = "Timezone offset, unit in minutes")
        private Integer timezone_offset;
    }
    
    @Getter
    @Setter
    public static class Websocket {
        @Schema(description = "WebSocketServiceServerAddress")
        private String url;
    }
    
    @Getter
    @Setter
    public static class Mqtt {
        @Schema(description = "MQTTServiceServerAddress")
        private String broker;
        
        @Schema(description = "MQTTServiceServerPort")
        private Integer port;
        
        @Schema(description = "MQTT server endpoint")
        private String endpoint;
        
        @Schema(description = "MQTTClientID")
        private String client_id;
        
        @Schema(description = "MQTTUsername")
        private String username;
        
        @Schema(description = "MQTTPassword")
        private String password;
        
        @Schema(description = "Publish topic")
        private String publish_topic;
        
        @Schema(description = "Subscribe topic")
        private String subscribe_topic;
    }
}
