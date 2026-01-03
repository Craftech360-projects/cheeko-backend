package cheeko.modules.security.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Login Form
 */
@Data
@Schema(description = "Login Form")
public class LoginDTO implements Serializable {

    @Schema(description = "Mobile Number")
    @NotBlank(message = "{sysuser.username.require}")
    private String username;

    @Schema(description = "Password")
    @NotBlank(message = "{sysuser.password.require}")
    private String password;

    @Schema(description = "Verification Code")
    @NotBlank(message = "{sysuser.captcha.require}")
    private String captcha;

    @Schema(description = "Mobile Verification Code")
    private String mobileCaptcha;

    @Schema(description = "Unique Identifier")
    @NotBlank(message = "{sysuser.uuid.require}")
    private String captchaId;

}