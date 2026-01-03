package cheeko.modules.sys.vo;

import java.util.Date;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * AdminPaginationDisplayUsers VO
 * @ zjy
 * 
 * @since 2025-3-25
 */
@Data
public class AdminPageUserVO {

    @Schema(description = "DeviceQuantity")
    private String deviceCount;

    @Schema(description = "Mobile Number")
    private String mobile;

    @Schema(description = "Status")
    private Integer status;

    @Schema(description = "Userid")
    private String userid;

    @Schema(description = "RegisterTime")
    private Date createDate;
}
