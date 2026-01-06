package cheeko.modules.device.controller;

import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.beans.BeanUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import cheeko.common.exception.ErrorCode;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.user.UserDetail;
import cheeko.common.utils.Result;
import cheeko.modules.device.dto.DeviceRegisterDTO;
import cheeko.modules.device.dto.DeviceUnBindDTO;
import cheeko.modules.device.dto.DeviceUpdateDTO;
import cheeko.modules.device.dto.DeviceManualAddDTO;
import cheeko.modules.device.dto.AssignKidToDeviceDTO;
import cheeko.modules.device.dto.AssignKidByMacDTO;
import cheeko.modules.device.dto.DeviceResponseDTO;
import cheeko.modules.device.dto.ModeCycleResponse;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.service.DeviceService;
import cheeko.modules.security.user.SecurityUser;
import lombok.extern.slf4j.Slf4j;

@Tag(name = "Device Management")
@AllArgsConstructor
@RestController
@RequestMapping("/device")
@Slf4j
public class DeviceController {
    private final DeviceService deviceService;

    private final RedisUtils redisUtils;

    @PostMapping("/bind/{agentId}/{deviceCode}")
    @Operation(summary = "BindDevice")
    @RequiresPermissions("sys:role:normal")
    public Result<DeviceResponseDTO> bindDevice(@PathVariable String agentId, @PathVariable String deviceCode) {
        DeviceEntity device = deviceService.deviceActivation(agentId, deviceCode);

        // Build response with device details
        DeviceResponseDTO response = new DeviceResponseDTO();
        response.setId(device.getId());
        response.setMacAddress(device.getMacAddress());
        response.setAgentId(device.getAgentId());
        response.setAlias(device.getAlias());
        response.setBoard(device.getBoard());
        response.setKidId(device.getKidId());
        response.setAppVersion(device.getAppVersion());

        return new Result<DeviceResponseDTO>().ok(response);
    }

    @PostMapping("/register")
    @Operation(summary = "RegisterDevice")
    public Result<String> registerDevice(@RequestBody DeviceRegisterDTO deviceRegisterDTO) {
        String macAddress = deviceRegisterDTO.getMacAddress();
        if (StringUtils.isBlank(macAddress)) {
            return new Result<String>().error(ErrorCode.NOT_NULL, "macAddressCannot beEmpty");
        }
        // Generate6-digitValidateCode
        String code = String.valueOf(Math.random()).substring(2, 8);
        String key = RedisKeys.getDeviceCaptchaKey(code);
        String existsMac = null;
        do {
            existsMac = (String) redisUtils.get(key);
        } while (StringUtils.isNotBlank(existsMac));

        redisUtils.set(key, macAddress);
        return new Result<String>().ok(code);
    }

    @GetMapping("/bind/{agentId}")
    @Operation(summary = "GetHaveBindDevice")
    @RequiresPermissions("sys:role:normal")
    public Result<List<DeviceEntity>> getUserDevices(@PathVariable String agentId) {
        UserDetail user = SecurityUser.getUser();
        List<DeviceEntity> devices;
        
        // Check if user is super admin
        if (user.getSuperAdmin() != null && user.getSuperAdmin() == 1) {
            // Admin can see all devices for any agent
            devices = deviceService.getDevicesByAgentId(agentId);
        } else {
            // Regular user can only see their own devices
            devices = deviceService.getUserDevices(user.getId(), agentId);
        }
        
        return new Result<List<DeviceEntity>>().ok(devices);
    }

    @PostMapping("/unbind")
    @Operation(summary = "Unbind device - Regular users can unbind their own devices, Super admins can unbind any device")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> unbindDevice(@RequestBody DeviceUnBindDTO unDeviveBind) {
        UserDetail user = SecurityUser.getUser();

        // Validate device ID
        if (StringUtils.isBlank(unDeviveBind.getDeviceId())) {
            return new Result<Void>().error("Device ID cannot be empty");
        }

        // Pre-check device existence for better error messages
        DeviceEntity device = deviceService.selectById(unDeviveBind.getDeviceId());
        if (device == null) {
            return new Result<Void>().error("Device not found");
        }

        boolean isSuperAdmin = (user.getSuperAdmin() != null && user.getSuperAdmin() == 1);

        // Check ownership if not super admin
        if (!isSuperAdmin && !device.getUserId().equals(user.getId())) {
            return new Result<Void>().error("You don't have permission to unbind this device");
        }

        // Perform the unbind operation
        deviceService.unbindDevice(user.getId(), unDeviveBind.getDeviceId());

        return new Result<Void>().ok(null);
    }

    @PutMapping("/update/{id}")
    @Operation(summary = "UpdateDeviceInformation")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> updateDeviceInfo(@PathVariable String id, @Valid @RequestBody DeviceUpdateDTO deviceUpdateDTO) {
        DeviceEntity entity = deviceService.selectById(id);
        if (entity == null) {
            return new Result<Void>().error("Device does not exist");
        }
        UserDetail user = SecurityUser.getUser();
        if (!entity.getUserId().equals(user.getId())) {
            return new Result<Void>().error("Device does not exist");
        }
        BeanUtils.copyProperties(deviceUpdateDTO, entity);
        deviceService.updateById(entity);
        return new Result<Void>();
    }

    @PostMapping("/manual-add")
    @Operation(summary = "Manually add device")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> manualAddDevice(@RequestBody @Valid DeviceManualAddDTO dto) {
        UserDetail user = SecurityUser.getUser();
        deviceService.manualAddDevice(user.getId(), dto);
        return new Result<>();
    }

    @PutMapping("/assign-kid/{deviceId}")
    @Operation(summary = "Assign kid to device by device ID")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> assignKidToDevice(
            @PathVariable String deviceId,
            @RequestBody @Valid AssignKidToDeviceDTO dto) {
        UserDetail user = SecurityUser.getUser();

        // Get device and verify ownership
        DeviceEntity device = deviceService.selectById(deviceId);
        if (device == null) {
            return new Result<Void>().error("Device not found");
        }

        if (!device.getUserId().equals(user.getId())) {
            return new Result<Void>().error("You don't own this device");
        }

        // Update kid_id
        device.setKidId(dto.getKidId());
        deviceService.updateById(device);

        return new Result<Void>().ok(null);
    }

    @PutMapping("/assign-kid-by-mac")
    @Operation(summary = "Assign kid to device by MAC address")
    @RequiresPermissions("sys:role:normal")
    public Result<DeviceResponseDTO> assignKidByMac(@RequestBody @Valid AssignKidByMacDTO dto) {
        UserDetail user = SecurityUser.getUser();

        // Get device by MAC address
        DeviceEntity device = deviceService.getDeviceByMacAddress(dto.getMacAddress());
        if (device == null) {
            return new Result<DeviceResponseDTO>().error("Device not found for MAC: " + dto.getMacAddress());
        }

        // Verify ownership
        if (!device.getUserId().equals(user.getId())) {
            return new Result<DeviceResponseDTO>().error("You don't own this device");
        }

        // Update kid_id
        device.setKidId(dto.getKidId());
        deviceService.updateById(device);

        // Build response with device details
        DeviceResponseDTO response = new DeviceResponseDTO();
        response.setId(device.getId());
        response.setMacAddress(device.getMacAddress());
        response.setAgentId(device.getAgentId());
        response.setAlias(device.getAlias());
        response.setBoard(device.getBoard());
        response.setKidId(device.getKidId());
        response.setAppVersion(device.getAppVersion());

        return new Result<DeviceResponseDTO>().ok(response);
    }

    @PostMapping("/{macAddress}/cycle-mode")
    @Operation(summary = "Cycle device mode by MAC address (conversation → music → story)")
    public Result<ModeCycleResponse> cycleDeviceMode(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            log.info("🔄 [MODE-CYCLE] Mode cycle requested for device MAC: {}", cleanMac);

            // Call service to cycle mode
            ModeCycleResponse response = deviceService.cycleDeviceMode(cleanMac);

            return new Result<ModeCycleResponse>().ok(response);

        } catch (Exception e) {
            log.error("❌ [MODE-CYCLE] Error cycling mode for MAC {}: {}", macAddress, e.getMessage());
            return new Result<ModeCycleResponse>().error(e.getMessage());
        }
    }

    @GetMapping("/{macAddress}/mode")
    @Operation(summary = "Get device mode by MAC address")
    public Result<String> getDeviceMode(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            log.info("📋 [GET-MODE] Mode query requested for device MAC: {}", cleanMac);

            // Get device
            DeviceEntity device = deviceService.getDeviceByMacAddress(cleanMac);
            if (device == null) {
                log.warn("⚠️ [GET-MODE] Device not found for MAC: {}", cleanMac);
                return new Result<String>().error("Device not found");
            }

            // Get mode, default to conversation if null
            String mode = device.getMode() != null ? device.getMode() : "conversation";
            log.info("✅ [GET-MODE] Device {} mode: {}", cleanMac, mode);

            return new Result<String>().ok(mode);

        } catch (Exception e) {
            log.error("❌ [GET-MODE] Error getting mode for MAC {}: {}", macAddress, e.getMessage());
            return new Result<String>().error(e.getMessage());
        }
    }

    @GetMapping("/{macAddress}/device-mode")
    @Operation(summary = "Get device PTT mode (auto/manual) by MAC address")
    public Result<String> getDevicePttMode(@PathVariable("macAddress") String macAddress) {
        try {
            // Clean MAC address
            String cleanMac = macAddress.replace(":", "").replace("-", "").toLowerCase();

            log.info("📋 [GET-DEVICE-MODE] PTT mode query requested for device MAC: {}", cleanMac);

            // Get device
            DeviceEntity device = deviceService.getDeviceByMacAddress(cleanMac);
            if (device == null) {
                log.warn("⚠️ [GET-DEVICE-MODE] Device not found for MAC: {}", cleanMac);
                return new Result<String>().error("Device not found");
            }

            // Get device_mode, default to manual if null
            String deviceMode = device.getDeviceMode() != null ? device.getDeviceMode() : "manual";
            log.info("✅ [GET-DEVICE-MODE] Device {} PTT mode: {}", cleanMac, deviceMode);

            return new Result<String>().ok(deviceMode);

        } catch (Exception e) {
            log.error("❌ [GET-DEVICE-MODE] Error getting PTT mode for MAC {}: {}", macAddress, e.getMessage());
            return new Result<String>().error(e.getMessage());
        }
    }
}