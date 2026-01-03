package cheeko.modules.device.controller;

import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.swagger.v3.oas.annotations.Hidden;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.modules.device.dto.DeviceReportReqDTO;
import cheeko.modules.device.dto.DeviceReportRespDTO;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.service.DeviceService;
import cheeko.modules.sys.service.SysParamsService;

@Tag(name = "Device Management", description = "OTA 相关Interface")
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/ota/")
public class OTAController {
    private final DeviceService deviceService;
    private final SysParamsService sysParamsService;

    @Operation(summary = "OTAVersion和DeviceActivateStatusCheck")
    @PostMapping
    public ResponseEntity<String> checkOTAVersion(
            @RequestBody DeviceReportReqDTO deviceReportReqDTO,
            @Parameter(name = "Device-Id", description = "Device唯一Identifier", required = true, in = ParameterIn.HEADER) @RequestHeader("Device-Id") String deviceId,
            @Parameter(name = "Client-Id", description = "ClientIdentifier", required = false, in = ParameterIn.HEADER) @RequestHeader(value = "Client-Id", required = false) String clientId) {
        if (StringUtils.isBlank(deviceId)) {
            return createResponse(DeviceReportRespDTO.createError("Device ID is required"));
        }
        if (StringUtils.isBlank(clientId)) {
            clientId = deviceId;
        }
        boolean macAddressValid = isMacAddressValid(deviceId);
        // DeviceId和MacAddress应Is一致s , And必须RequiredapplicationField
        if (!macAddressValid) {
            return createResponse(DeviceReportRespDTO.createError("Invalid device ID"));
        }
        return createResponse(deviceService.checkDeviceActive(deviceId, clientId, deviceReportReqDTO));
    }

    @Operation(summary = "Device快速CheckActivateStatus")
    @PostMapping("activate")
    public ResponseEntity<String> activateDevice(
            @Parameter(name = "Device-Id", description = "Device唯一Identifier", required = true, in = ParameterIn.HEADER) @RequestHeader("Device-Id") String deviceId,
            @Parameter(name = "Client-Id", description = "ClientIdentifier", required = false, in = ParameterIn.HEADER) @RequestHeader(value = "Client-Id", required = false) String clientId) {
        if (StringUtils.isBlank(deviceId)) {
            return ResponseEntity.status(202).build();
        }
        DeviceEntity device = deviceService.getDeviceByMacAddress(deviceId);
        if (device == null) {
            return ResponseEntity.status(202).build();
        }
        return ResponseEntity.ok("success");
    }

    @GetMapping
    @Hidden
    public ResponseEntity<String> getOTA() {
        String wsUrl = sysParamsService.getValue(Constant.SERVER_WEBSOCKET, true);
        if (StringUtils.isBlank(wsUrl) || wsUrl.equals("null")) {
            return ResponseEntity.ok("OTAInterface不Normal，缺少websocketAddress，请Login智控台，在Parameter Management找到【server.websocket】Configuration");
        }
        String otaUrl = sysParamsService.getValue(Constant.SERVER_OTA, true);
        if (StringUtils.isBlank(otaUrl) || otaUrl.equals("null")) {
            return ResponseEntity.ok("OTAInterface不Normal，缺少otaAddress，请Login智控台，在Parameter Management找到【server.ota】Configuration");
        }
        return ResponseEntity.ok("OTAInterfaceRunNormal，websocket集群Quantity：" + wsUrl.split(";").length);
    }

    @SneakyThrows
    private ResponseEntity<String> createResponse(DeviceReportRespDTO deviceReportRespDTO) {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        String json = objectMapper.writeValueAsString(deviceReportRespDTO);

        log.info("📤 Full OTA Response JSON:\n{}", json);

        byte[] jsonBytes = json.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity
                .ok()
                .contentType(MediaType.APPLICATION_JSON)
                .contentLength(jsonBytes.length)
                .body(json);
    }

    /**
     * 简单判断macAddressWhetherValid（Non严格）
     * 
     * @param macAddress
     * @return
     */
    private boolean isMacAddressValid(String macAddress) {
        if (StringUtils.isBlank(macAddress)) {
            return false;
        }
        // MACAddress通常As12位十六进制Number，Can包含冒号Or连字符分隔符
        String macPattern = "^([0-9A-Za-z]{2}[:-]){5}([0-9A-Za-z]{2})$";
        return macAddress.matches(macPattern);
    }
}
