package cheeko.modules.sys.dto;

import java.io.Serializable;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.Pattern;
import lombok.Data;
import cheeko.common.utils.DateUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;

/**
 * Parameter Management
 */
@Data
@Schema(description = "Parameter Management")
public class SysParamsDTO implements Serializable {

    @Schema(description = "id")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Parameter Code")
    @NotBlank(message = "{sysparams.paramcode.require}", groups = DefaultGroup.class)
    private String paramCode;

    @Schema(description = "Parameter Value")
    @NotBlank(message = "{sysparams.paramvalue.require}", groups = DefaultGroup.class)
    private String paramValue;

    @Schema(description = "Value Type")
    @NotBlank(message = "{sysparams.valuetype.require}", groups = DefaultGroup.class)
    @Pattern(regexp = "^(string|number|boolean|array|json)$", message = "{sysparams.valuetype.pattern}", groups = DefaultGroup.class)
    private String valueType;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "Create Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date createDate;

    @Schema(description = "Update Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date updateDate;

}
