package cheeko.modules.sys.dto;

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
 * Dictionary Data
 */
@Data
@Schema(description = "Dictionary Data")
public class SysDictDataDTO implements Serializable {

    @Schema(description = "id")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Dictionary Type ID")
    @NotNull(message = "{sysdict.type.require}", groups = DefaultGroup.class)
    private Long dictTypeId;

    @Schema(description = "Dictionary Label")
    @NotBlank(message = "{sysdict.label.require}", groups = DefaultGroup.class)
    private String dictLabel;

    @Schema(description = "Dictionary Value")
    private String dictValue;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "Sort Order")
    @Min(value = 0, message = "{sort.number}", groups = DefaultGroup.class)
    private Integer sort;

    @Schema(description = "Create Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date createDate;

    @Schema(description = "Update Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date updateDate;
}