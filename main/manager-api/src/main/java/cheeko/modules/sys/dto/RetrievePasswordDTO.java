package cheeko.modules.sys.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.io.Serializable;

/**
 * Retrieve Password DTO
 */
@Data
@Schema(description = "Retrieve Password")
public class RetrievePasswordDTO implements Serializable {

    @Schema(description = "Mobile Number")
    @NotBlank(message = "{sysuser.password.require}")
    private String phone;

    @Schema(description = "Verification Code")
    @NotBlank(message = "{sysuser.password.require}")
    private String code;

    @Schema(description = "New Password")
    @NotBlank(message = "{sysuser.password.require}")
    private String password;



}