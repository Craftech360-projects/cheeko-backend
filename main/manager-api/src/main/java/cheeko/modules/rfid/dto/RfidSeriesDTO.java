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
 * RFID Series DTO
 */
@Data
@Schema(description = "RFID Series/Range")
public class RfidSeriesDTO implements Serializable {

    @Schema(description = "ID")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Start of UID range (normalized hex string)")
    @NotBlank(message = "Start UID is required", groups = DefaultGroup.class)
    private String startUid;

    @Schema(description = "End of UID range (normalized hex string)")
    @NotBlank(message = "End UID is required", groups = DefaultGroup.class)
    private String endUid;

    @Schema(description = "FK to rfid_question table")
    @NotNull(message = "Question ID is required", groups = DefaultGroup.class)
    private Long questionId;

    @Schema(description = "FK to rfid_pack table")
    private Long packId;

    @Schema(description = "Priority if UID matches multiple series (higher wins)")
    @Min(value = 0, message = "Priority must be non-negative", groups = DefaultGroup.class)
    private Integer priority;

    @Schema(description = "Internal notes")
    private String notes;

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
