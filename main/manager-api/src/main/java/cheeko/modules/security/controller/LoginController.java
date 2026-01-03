package cheeko.modules.security.controller;

import java.io.IOException;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.exception.ErrorCode;
import cheeko.common.exception.RenException;
import cheeko.common.page.TokenDTO;
import cheeko.common.user.UserDetail;
import cheeko.common.utils.Result;
import cheeko.common.validator.AssertUtils;
import cheeko.common.validator.ValidatorUtils;
import cheeko.modules.security.dto.LoginDTO;
import cheeko.modules.security.dto.SmsVerificationDTO;
import cheeko.modules.security.password.PasswordUtils;
import cheeko.modules.security.service.CaptchaService;
import cheeko.modules.security.service.SysUserTokenService;
import cheeko.modules.security.user.SecurityUser;
import cheeko.modules.sys.dto.DeleteAccountDTO;
import cheeko.modules.sys.dto.PasswordDTO;
import cheeko.modules.sys.dto.RetrievePasswordDTO;
import cheeko.modules.sys.dto.SysUserDTO;
import cheeko.modules.sys.dto.UpdatePasswordDTO;
import cheeko.modules.sys.service.SysDictDataService;
import cheeko.modules.sys.service.SysParamsService;
import cheeko.modules.sys.service.SysUserService;
import cheeko.modules.sys.vo.SysDictDataItem;

/**
 * Login Controller
 */
@Slf4j
@AllArgsConstructor
@RestController
@RequestMapping("/user")
@Tag(name = "Login Management")
public class LoginController {
    private final SysUserService sysUserService;
    private final SysUserTokenService sysUserTokenService;
    private final CaptchaService captchaService;
    private final SysParamsService sysParamsService;
    private final SysDictDataService sysDictDataService;

    @GetMapping("/captcha")
    @Operation(summary = "Captcha")
    public void captcha(HttpServletResponse response, String uuid) throws IOException {
        // UUID cannot be empty
        AssertUtils.isBlank(uuid, ErrorCode.IDENTIFIER_NOT_NULL);
        // Generate captcha
        captchaService.create(response, uuid);
    }

    @PostMapping("/smsVerification")
    @Operation(summary = "SMS verification code")
    public Result<Void> smsVerification(@RequestBody SmsVerificationDTO dto) {
        // Validate captcha
        boolean validate = captchaService.validate(dto.getCaptchaId(), dto.getCaptcha(), true);
        if (!validate) {
            throw new RenException("Invalid captcha");
        }
        Boolean isMobileRegister = sysParamsService
                .getValueObject(Constant.SysMSMParam.SERVER_ENABLE_MOBILE_REGISTER.getValue(), Boolean.class);
        if (!isMobileRegister) {
            throw new RenException("Mobile registration is not enabled, SMS verification is unavailable");
        }
        // Send SMS verification code
        captchaService.sendSMSValidateCode(dto.getPhone());
        return new Result<>();
    }

    @PostMapping("/login")
    @Operation(summary = "Login")
    public Result<TokenDTO> login(@RequestBody LoginDTO login) {
        // Validate captcha
        boolean validate = captchaService.validate(login.getCaptchaId(), login.getCaptcha(), true);
        if (!validate) {
            throw new RenException("Invalid captcha, please try again");
        }
        // Get user by username
        SysUserDTO userDTO = sysUserService.getByUsername(login.getUsername());
        // Check if user exists
        if (userDTO == null) {
            throw new RenException("Invalid username or password");
        }
        // Check if password is correct
        if (!PasswordUtils.matches(login.getPassword(), userDTO.getPassword())) {
            throw new RenException("Invalid username or password");
        }
        return sysUserTokenService.createToken(userDTO.getId());
    }

    @PostMapping("/register")
    @Operation(summary = "Register")
    public Result<TokenDTO> register(@RequestBody LoginDTO login) {

        if (!sysUserService.getAllowUserRegister()) {
            throw new RenException("User registration is currently not allowed");
        }
        // Check if mobile registration is enabled
        Boolean isMobileRegister = sysParamsService
                .getValueObject(Constant.SysMSMParam.SERVER_ENABLE_MOBILE_REGISTER.getValue(), Boolean.class);
        boolean validate;
        if (isMobileRegister) {
            // Validate if username is a phone number
            boolean validPhone = ValidatorUtils.isValidPhone(login.getUsername());
            if (!validPhone) {
                throw new RenException("Username must be a phone number");
            }
            // Validate SMS verification code
            validate = captchaService.validateSMSValidateCode(login.getUsername(), login.getMobileCaptcha(), false);
            if (!validate) {
                throw new RenException("Invalid SMS verification code, please try again");
            }
        } else {
            // Validate captcha
            validate = captchaService.validate(login.getCaptchaId(), login.getCaptcha(), true);
            if (!validate) {
                throw new RenException("Invalid captcha, please try again");
            }
        }

        // Get user by username
        SysUserDTO userDTO = sysUserService.getByUsername(login.getUsername());
        if (userDTO != null) {
            throw new RenException("This phone number is already registered");
        }
        userDTO = new SysUserDTO();
        userDTO.setUsername(login.getUsername());
        userDTO.setPassword(login.getPassword());
        sysUserService.save(userDTO);

        // Get the saved user to get the ID for token creation
        SysUserDTO savedUser = sysUserService.getByUsername(login.getUsername());
        if (savedUser == null) {
            throw new RenException("Registration failed, please try again");
        }

        // Create and return token for the newly registered user
        return sysUserTokenService.createToken(savedUser.getId());
    }

    @GetMapping("/info")
    @Operation(summary = "Get user information")
    public Result<UserDetail> info() {
        UserDetail user = SecurityUser.getUser();
        Result<UserDetail> result = new Result<>();
        result.setData(user);
        return result;
    }

    @PutMapping("/change-password")
    @Operation(summary = "Change user password")
    public Result<?> changePassword(@RequestBody PasswordDTO passwordDTO) {
        // Validate not null
        ValidatorUtils.validateEntity(passwordDTO);
        Long userId = SecurityUser.getUserId();
        sysUserTokenService.changePassword(userId, passwordDTO);
        return new Result<>();
    }

    @PutMapping("/update-password")
    @Operation(summary = "Update user password without old password (no login required)")
    public Result<?> updatePassword(@RequestBody UpdatePasswordDTO updatePasswordDTO) {
        log.info("Password update request initiated for username: {}", updatePasswordDTO.getUsername());

        // Validate DTO
        ValidatorUtils.validateEntity(updatePasswordDTO);
        log.debug("UpdatePasswordDTO validation passed for username: {}", updatePasswordDTO.getUsername());

        try {
            // Get user information by username
            SysUserDTO userDTO = sysUserService.getByUsername(updatePasswordDTO.getUsername());
            if (userDTO == null) {
                log.error("User not found for username: {}", updatePasswordDTO.getUsername());
                throw new RenException("User account does not exist");
            }
            log.info("User found: username={}, userId={}", userDTO.getUsername(), userDTO.getId());

            // Update password directly without verifying old password or login status
            log.debug("Calling changePasswordDirectly for userId: {}, username: {}", userDTO.getId(), userDTO.getUsername());
            sysUserService.changePasswordDirectly(userDTO.getId(), updatePasswordDTO.getNewPassword());

            log.info("Password updated successfully for userId: {}, username: {}", userDTO.getId(), userDTO.getUsername());
            return new Result<>();
        } catch (RenException e) {
            log.error("Password update failed for username: {} - Error: {}", updatePasswordDTO.getUsername(), e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error during password update for username: {}", updatePasswordDTO.getUsername(), e);
            throw new RenException("Password update failed, please try again later");
        }
    }

    @DeleteMapping("/delete-account")
    @Operation(summary = "Delete user account (no login or password verification required)")
    public Result<?> deleteAccount(@RequestBody DeleteAccountDTO deleteAccountDTO) {
        log.info("Account deletion request initiated for username: {}", deleteAccountDTO.getUsername());

        // Validate DTO
        ValidatorUtils.validateEntity(deleteAccountDTO);
        log.debug("DeleteAccountDTO validation passed for username: {}", deleteAccountDTO.getUsername());

        try {
            // Get user information by username
            SysUserDTO userDTO = sysUserService.getByUsername(deleteAccountDTO.getUsername());
            if (userDTO == null) {
                log.error("User not found for username: {}", deleteAccountDTO.getUsername());
                throw new RenException("User account does not exist");
            }
            log.info("User found for deletion: username={}, userId={}", userDTO.getUsername(), userDTO.getId());

            // Delete user account (including associated devices and agents)
            log.info("Deleting user account and associated data for userId: {}, username: {}", userDTO.getId(), userDTO.getUsername());
            sysUserService.deleteById(userDTO.getId());

            log.info("Account deleted successfully for userId: {}, username: {}", userDTO.getId(), userDTO.getUsername());
            return new Result<>();
        } catch (RenException e) {
            log.error("Account deletion failed for username: {} - Error: {}", deleteAccountDTO.getUsername(), e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Unexpected error during account deletion for username: {}", deleteAccountDTO.getUsername(), e);
            throw new RenException("Account deletion failed, please try again later");
        }
    }

    @PutMapping("/retrieve-password")
    @Operation(summary = "Retrieve password")
    public Result<?> retrievePassword(@RequestBody RetrievePasswordDTO dto) {
        // Check if mobile registration is enabled
        Boolean isMobileRegister = sysParamsService
                .getValueObject(Constant.SysMSMParam.SERVER_ENABLE_MOBILE_REGISTER.getValue(), Boolean.class);
        if (!isMobileRegister) {
            throw new RenException("Mobile registration is not enabled, password recovery is unavailable");
        }
        // Validate not null
        ValidatorUtils.validateEntity(dto);
        // Validate if phone number format is correct
        boolean validPhone = ValidatorUtils.isValidPhone(dto.getPhone());
        if (!validPhone) {
            throw new RenException("Invalid phone number format");
        }

        // Get user by phone number
        SysUserDTO userDTO = sysUserService.getByUsername(dto.getPhone());
        if (userDTO == null) {
            throw new RenException("This phone number is not registered");
        }
        // Validate SMS verification code
        boolean validate = captchaService.validateSMSValidateCode(dto.getPhone(), dto.getCode(), false);
        // Check if validation passed
        if (!validate) {
            throw new RenException("Invalid SMS verification code");
        }

        sysUserService.changePasswordDirectly(userDTO.getId(), dto.getPassword());
        return new Result<>();
    }

    @GetMapping("/pub-config")
    @Operation(summary = "Public configuration")
    public Result<Map<String, Object>> pubConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("enableMobileRegister", sysParamsService
                .getValueObject(Constant.SysMSMParam.SERVER_ENABLE_MOBILE_REGISTER.getValue(), Boolean.class));
        config.put("version", Constant.VERSION);
        config.put("year", "©" + Calendar.getInstance().get(Calendar.YEAR));
        config.put("allowUserRegister", sysUserService.getAllowUserRegister());
        List<SysDictDataItem> list = sysDictDataService.getDictDataByType(Constant.DictType.MOBILE_AREA.getValue());
        config.put("mobileAreaList", list);
        config.put("beianIcpNum", sysParamsService.getValue(Constant.SysBaseParam.BEIAN_ICP_NUM.getValue(), true));
        config.put("beianGaNum", sysParamsService.getValue(Constant.SysBaseParam.BEIAN_GA_NUM.getValue(), true));
        config.put("name", sysParamsService.getValue(Constant.SysBaseParam.SERVER_NAME.getValue(), true));

        return new Result<Map<String, Object>>().ok(config);
    }
}