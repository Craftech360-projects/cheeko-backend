package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import lombok.Data;
import cheeko.common.utils.DateUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;

/**
 * RFID Pack DTO
 */
@Data
@Schema(description = "RFID Pack")
public class RfidPackDTO implements Serializable {

    @Schema(description = "ID")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Unique pack identifier (e.g., BLINKIT_ANIMALS_PACK_1)")
    @NotBlank(message = "Pack code is required", groups = DefaultGroup.class)
    private String packCode;

    @Schema(description = "Display name")
    @NotBlank(message = "Name is required", groups = DefaultGroup.class)
    private String name;

    @Schema(description = "Pack description")
    private String description;

    @Schema(description = "Minimum recommended age")
    @Min(value = 0, message = "Age must be positive", groups = DefaultGroup.class)
    private Integer ageMin;

    @Schema(description = "Maximum recommended age")
    @Min(value = 0, message = "Age must be positive", groups = DefaultGroup.class)
    private Integer ageMax;

    @Schema(description = "Active status")
    private Boolean active;

    @Schema(description = "Create Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date createDate;

    @Schema(description = "Update Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date updateDate;
}
