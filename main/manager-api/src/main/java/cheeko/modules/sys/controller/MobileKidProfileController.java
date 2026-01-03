package cheeko.modules.sys.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.exception.RenException;
import cheeko.common.utils.Result;
import cheeko.common.validator.ValidatorUtils;
import cheeko.modules.security.user.SecurityUser;
import cheeko.modules.sys.dto.KidProfileDTO;
import cheeko.modules.sys.dto.KidProfileCreateDTO;
import cheeko.modules.sys.dto.KidProfileUpdateDTO;
import cheeko.modules.sys.service.KidProfileService;

/**
 * Mobile Kid Profile Controller
 * Handles kid profile operations for mobile app
 */
@AllArgsConstructor
@RestController
@RequestMapping("/api/mobile/kids")
@Tag(name = "Mobile Kid Profile Management")
@Slf4j
public class MobileKidProfileController {

    private final KidProfileService kidProfileService;

    @GetMapping("/list")
    @Operation(summary = "Get all kids for current user")
    public Result<Map<String, Object>> getKids() {
        try {
            Long userId = SecurityUser.getUserId();
            List<KidProfileDTO> kids = kidProfileService.getByUserId(userId);

            Map<String, Object> result = new HashMap<>();
            result.put("kids", kids);

            return new Result<Map<String, Object>>().ok(result);
        } catch (Exception e) {
            log.error("Error getting kids", e);
            return new Result<Map<String, Object>>().error("Failed to get kids");
        }
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get kid by ID")
    public Result<Map<String, Object>> getKid(@PathVariable Long id) {
        try {
            Long userId = SecurityUser.getUserId();
            KidProfileDTO kid = kidProfileService.getByIdAndUserId(id, userId);

            if (kid == null) {
                return new Result<Map<String, Object>>().error("Kid profile not found");
            }

            Map<String, Object> result = new HashMap<>();
            result.put("kid", kid);

            return new Result<Map<String, Object>>().ok(result);
        } catch (Exception e) {
            log.error("Error getting kid", e);
            return new Result<Map<String, Object>>().error("Failed to get kid");
        }
    }

    @PostMapping("/create")
    @Operation(summary = "Create kid profile")
    public Result<Map<String, Object>> createKid(@RequestBody KidProfileCreateDTO dto) {
        try {
            // Validate input
            ValidatorUtils.validateEntity(dto);

            Long userId = SecurityUser.getUserId();
            KidProfileDTO kid = kidProfileService.createKid(dto, userId);

            Map<String, Object> result = new HashMap<>();
            result.put("kid", kid);

            log.info("Kid profile created successfully for user: {}", userId);
            return new Result<Map<String, Object>>().ok(result);
        } catch (RenException e) {
            log.error("Error creating kid: {}", e.getMessage());
            return new Result<Map<String, Object>>().error(e.getMsg());
        } catch (Exception e) {
            log.error("Error creating kid", e);
            return new Result<Map<String, Object>>().error("Failed to create kid profile");
        }
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update kid profile")
    public Result<Map<String, Object>> updateKid(@PathVariable Long id, @RequestBody KidProfileUpdateDTO dto) {
        try {
            Long userId = SecurityUser.getUserId();
            KidProfileDTO kid = kidProfileService.updateKid(id, dto, userId);

            Map<String, Object> result = new HashMap<>();
            result.put("kid", kid);

            log.info("Kid profile updated successfully: {}", id);
            return new Result<Map<String, Object>>().ok(result);
        } catch (RenException e) {
            log.error("Error updating kid: {}", e.getMessage());
            return new Result<Map<String, Object>>().error(e.getMsg());
        } catch (Exception e) {
            log.error("Error updating kid", e);
            return new Result<Map<String, Object>>().error("Failed to update kid profile");
        }
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete kid profile")
    public Result<Void> deleteKid(@PathVariable Long id) {
        try {
            Long userId = SecurityUser.getUserId();
            boolean success = kidProfileService.deleteKid(id, userId);

            if (success) {
                log.info("Kid profile deleted successfully: {}", id);
                return new Result<Void>().ok(null);
            } else {
                return new Result<Void>().error("Failed to delete kid profile");
            }
        } catch (RenException e) {
            log.error("Error deleting kid: {}", e.getMessage());
            return new Result<Void>().error(e.getMsg());
        } catch (Exception e) {
            log.error("Error deleting kid", e);
            return new Result<Void>().error("Failed to delete kid profile");
        }
    }
}
