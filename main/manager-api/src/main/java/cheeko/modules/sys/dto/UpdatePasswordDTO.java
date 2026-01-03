package cheeko.modules.sys.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Update Password DTO (does not require old password)
 */
@Data
@Schema(description = "UpdatePassword")
public class UpdatePasswordDTO implements Serializable {

    @Schema(description = "Username/Mobile Number")
    @NotBlank(message = "{sysuser.username.require}")
    private String username;

    @Schema(description = "New Password")
    @NotBlank(message = "{sysuser.password.require}")
    private String newPassword;

}
