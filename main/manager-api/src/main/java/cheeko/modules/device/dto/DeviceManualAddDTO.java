package cheeko.modules.device.dto;

import lombok.Data;

@Data
public class DeviceManualAddDTO {
    private String agentId;
    private String board;        // Device model
    private String appVersion;   // Firmware version
    private String macAddress;   // MAC address
} 