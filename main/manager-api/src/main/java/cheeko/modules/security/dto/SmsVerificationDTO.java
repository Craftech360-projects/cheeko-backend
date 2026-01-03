package cheeko.modules.security.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * SMS Verification Code Request DTO
 */
@Data
@Schema(description = "SMS Verification Code Request")
public class SmsVerificationDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Mobile Number")
    @NotBlank(message = "{sysuser.username.require}")
    private String phone;

    @Schema(description = "Verification Code")
    @NotBlank(message = "{sysuser.captcha.require}")
    private String captcha;

    @Schema(description = "Unique Identifier")
    @NotBlank(message = "{sysuser.uuid.require}")
    private String captchaId;
}