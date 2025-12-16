package xiaozhi.modules.device.controller;

import java.util.List;

import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.user.UserDetail;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.device.dto.AccessoryBindDTO;
import xiaozhi.modules.device.dto.AccessoryResponseDTO;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.entity.ToyAccessoryEntity;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.device.service.ToyAccessoryService;
import xiaozhi.modules.security.user.SecurityUser;

@Tag(name = "Toy Accessories")
@AllArgsConstructor
@RestController
@RequestMapping("/device")
@Slf4j
public class ToyAccessoryController {

    private final ToyAccessoryService accessoryService;
    private final DeviceService deviceService;

    /**
     * Bind accessory to toy (QR code scan from mobile app)
     * POST /device/{toyMac}/accessory
     */
    @PostMapping("/{toyMac}/accessory")
    @Operation(summary = "Bind accessory to toy (QR code scan)")
    @RequiresPermissions("sys:role:normal")
    public Result<AccessoryResponseDTO> bindAccessory(
            @PathVariable String toyMac,
            @RequestBody @Valid AccessoryBindDTO dto) {

        log.info("Binding accessory: toyMac={}, accessoryMac={}, type={}",
                toyMac, dto.getAccessoryMac(), dto.getAccessoryType());

        UserDetail user = SecurityUser.getUser();

        // Normalize toy MAC
        String normalizedToyMac = toyMac.replace(":", "").replace("-", "").toLowerCase();

        // Verify user owns this toy
        DeviceEntity toy = deviceService.getDeviceByMacAddress(normalizedToyMac);
        if (toy == null) {
            return new Result<AccessoryResponseDTO>().error("Toy not found: " + toyMac);
        }

        if (!toy.getUserId().equals(user.getId())) {
            return new Result<AccessoryResponseDTO>().error("You don't own this toy");
        }

        try {
            // Bind accessory
            ToyAccessoryEntity accessory = accessoryService.bindAccessory(
                    user.getId(), normalizedToyMac, dto);

            // Build response
            AccessoryResponseDTO response = new AccessoryResponseDTO();
            response.setId(accessory.getId());
            response.setUserId(accessory.getUserId());
            response.setToyMac(accessory.getToyMac());
            response.setAccessoryMac(accessory.getAccessoryMac());
            response.setAccessoryType(accessory.getAccessoryType());

            log.info("Accessory bound successfully: {}", response);
            return new Result<AccessoryResponseDTO>().ok(response);

        } catch (Exception e) {
            log.error("Failed to bind accessory: {}", e.getMessage());
            return new Result<AccessoryResponseDTO>().error(e.getMessage());
        }
    }

    /**
     * Get specific accessory by toy MAC and type
     * GET /device/{toyMac}/accessory/{type}
     * Used by MQTT Gateway to look up car MAC from toy MAC
     */
    @GetMapping("/{toyMac}/accessory/{type}")
    @Operation(summary = "Get accessory by toy MAC and type (for MQTT Gateway)")
    public Result<AccessoryResponseDTO> getAccessory(
            @PathVariable String toyMac,
            @PathVariable String type) {

        log.info("Getting accessory: toyMac={}, type={}", toyMac, type);

        // Normalize toy MAC
        String normalizedToyMac = toyMac.replace(":", "").replace("-", "").toLowerCase();

        ToyAccessoryEntity accessory = accessoryService.getAccessoryByToyMacAndType(normalizedToyMac, type);

        if (accessory == null) {
            log.warn("No {} accessory found for toy {}", type, toyMac);
            return new Result<AccessoryResponseDTO>().error("No " + type + " accessory bound to this toy");
        }

        AccessoryResponseDTO response = new AccessoryResponseDTO();
        response.setId(accessory.getId());
        response.setUserId(accessory.getUserId());
        response.setToyMac(accessory.getToyMac());
        response.setAccessoryMac(accessory.getAccessoryMac());
        response.setAccessoryType(accessory.getAccessoryType());

        log.info("Found accessory: {}", response);
        return new Result<AccessoryResponseDTO>().ok(response);
    }

    /**
     * Get all accessories for a toy
     * GET /device/{toyMac}/accessories
     */
    @GetMapping("/{toyMac}/accessories")
    @Operation(summary = "Get all accessories for a toy")
    @RequiresPermissions("sys:role:normal")
    public Result<List<ToyAccessoryEntity>> getAccessories(@PathVariable String toyMac) {

        log.info("Getting all accessories for toy: {}", toyMac);

        // Normalize toy MAC
        String normalizedToyMac = toyMac.replace(":", "").replace("-", "").toLowerCase();

        List<ToyAccessoryEntity> accessories = accessoryService.getAccessoriesByToyMac(normalizedToyMac);

        return new Result<List<ToyAccessoryEntity>>().ok(accessories);
    }

    /**
     * Unbind accessory from toy
     * DELETE /device/{toyMac}/accessory/{accessoryMac}
     */
    @DeleteMapping("/{toyMac}/accessory/{accessoryMac}")
    @Operation(summary = "Unbind accessory from toy")
    @RequiresPermissions("sys:role:normal")
    public Result<Void> unbindAccessory(
            @PathVariable String toyMac,
            @PathVariable String accessoryMac) {

        log.info("Unbinding accessory: toyMac={}, accessoryMac={}", toyMac, accessoryMac);

        UserDetail user = SecurityUser.getUser();

        try {
            accessoryService.unbindAccessory(user.getId(), accessoryMac);
            log.info("Accessory unbound successfully");
            return new Result<Void>().ok(null);

        } catch (Exception e) {
            log.error("Failed to unbind accessory: {}", e.getMessage());
            return new Result<Void>().error(e.getMessage());
        }
    }
}
