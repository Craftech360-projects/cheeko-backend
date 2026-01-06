package cheeko.modules.sys.controller;

import java.util.*;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.socket.WebSocketHttpHeaders;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import cheeko.common.annotation.LogOperation;
import cheeko.common.constant.Constant;
import cheeko.common.exception.RenException;
import cheeko.common.utils.Result;
import cheeko.modules.sys.dto.EmitSeverActionDTO;
import cheeko.modules.sys.dto.ServerActionPayloadDTO;
import cheeko.modules.sys.dto.ServerActionResponseDTO;
import cheeko.modules.sys.enums.ServerActionEnum;
import cheeko.modules.sys.service.SysParamsService;
import cheeko.modules.sys.utils.WebSocketClientManager;

/**
 * Server-side management controller
 */
@RestController
@RequestMapping("/admin/server")
@Tag(name = "Server Management")
@AllArgsConstructor
public class ServerSideManageController {
    private final SysParamsService sysParamsService;
    private static final ObjectMapper objectMapper;
    static {
        objectMapper = new ObjectMapper();
        // Ignore fields that exist in JSON string but do not exist in corresponding POJO
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    @Operation(summary = "Get WebSocket server list")
    @GetMapping("/server-list")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<String>> getWsServerList() {
        String wsText = sysParamsService.getValue(Constant.SERVER_WEBSOCKET, true);
        if (StringUtils.isBlank(wsText)) {
            return new Result<List<String>>().ok(Collections.emptyList());
        }
        return new Result<List<String>>().ok(Arrays.asList(wsText.split(";")));
    }

    @Operation(summary = "Notify Python server to update configuration")
    @PostMapping("/emit-action")
    @LogOperation("Notify Python server to update config")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Boolean> emitServerAction(@RequestBody @Valid EmitSeverActionDTO emitSeverActionDTO) {
        if (emitSeverActionDTO.getAction() == null) {
            throw new RenException("Invalid server action");
        }
        String wsText = sysParamsService.getValue(Constant.SERVER_WEBSOCKET, true);
        if (StringUtils.isBlank(wsText)) {
            throw new RenException("Server WebSocket address not configured");
        }
        String targetWs = emitSeverActionDTO.getTargetWs();
        String[] wsList = wsText.split(";");
        // Find target to call
        if (StringUtils.isBlank(targetWs) || !Arrays.asList(wsList).contains(targetWs)) {
            throw new RenException("Target WebSocket address does not exist");
        }
        return new Result<Boolean>().ok(emitServerActionByWs(targetWs, emitSeverActionDTO.getAction()));
    }

    private Boolean emitServerActionByWs(String targetWsUri, ServerActionEnum actionEnum) {
        if (StringUtils.isBlank(targetWsUri) || actionEnum == null) {
            return false;
        }
        String serverSK = sysParamsService.getValue(Constant.SERVER_SECRET, true);
        WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
        headers.add("device-id", UUID.randomUUID().toString());
        headers.add("client-id", UUID.randomUUID().toString());

        try (WebSocketClientManager client = new WebSocketClientManager.Builder()
                .connectTimeout(3, TimeUnit.SECONDS)
                .maxSessionDuration(120, TimeUnit.SECONDS)
                .uri(targetWsUri)
                .headers(headers)
                .build()) {
            // If connection succeeds, send a JSON data packet and wait for server-side response
            client.sendJson(
                    ServerActionPayloadDTO.build(
                            actionEnum,
                            Map.of("secret", serverSK)));
            // Wait for server-side response and continue listening for messages
            client.listener((jsonText) -> {
                if (StringUtils.isBlank(jsonText)) {
                    return false;
                }
                try {
                    ServerActionResponseDTO response = objectMapper.readValue(jsonText, ServerActionResponseDTO.class);
                    Boolean isSuccess = ServerActionResponseDTO.isSuccess(response);
                    return isSuccess;
                } catch (JsonProcessingException e) {
                    return false;
                }
            });
        } catch (Exception e) {
            // Catch all errors, let global exception handler return
            throw new RenException("WebSocket connection failure or connection timeout");
        }
        return true;
    }
}
