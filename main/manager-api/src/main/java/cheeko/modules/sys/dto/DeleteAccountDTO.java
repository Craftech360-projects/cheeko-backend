package cheeko.modules.sys.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Delete Account DTO
 */
@Data
@Schema(description = "Delete Account")
public class DeleteAccountDTO implements Serializable {

    @Schema(description = "Username/Mobile Number")
    @NotBlank(message = "{sysuser.username.require}")
    private String username;

}
