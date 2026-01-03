package cheeko.common.page;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * TokenInformation
 *
 * @author Jack
 */
@Data
@Schema(description = "TokenInformation")
public class TokenDTO implements Serializable {

    @Schema(description = "Password")
    private String token;

    @Schema(description = "ExpiredTime")
    private int expire;

    @Schema(description = "Client fingerprint")
    private String clientHash;
}
