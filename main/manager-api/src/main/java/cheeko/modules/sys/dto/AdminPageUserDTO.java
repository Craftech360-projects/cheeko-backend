package cheeko.modules.sys.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import lombok.Data;

/**
 * AdminPaginationUsers ParameterDTO
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
@Schema(description = "AdminPaginationUsers ParameterDTO")
public class AdminPageUserDTO {

    @Schema(description = "Mobile Number")
    private String mobile;

    @Schema(description = "Page number")
    @Min(value = 0, message = "{sort.number}")
    private String page;

    @Schema(description = "Number of rows to display")
    @Min(value = 0, message = "{sort.number}")
    private String limit;
}
