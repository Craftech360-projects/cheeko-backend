package cheeko.modules.device.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import lombok.Data;

/**
 * QueryAllDevices DTO
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
@Schema(description = "QueryAllDevices DTO")
public class DevicePageUserDTO {

    @Schema(description = "Device keywords")
    private String keywords;

    @Schema(description = "Page number")
    @Min(value = 0, message = "{page.number}")
    private String page;

    @Schema(description = "Number of rows to display")
    @Min(value = 0, message = "{limit.number}")
    private String limit;
}
