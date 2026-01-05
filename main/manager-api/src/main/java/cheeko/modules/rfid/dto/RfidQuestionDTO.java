package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
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
 * RFID Question Template DTO
 */
@Data
@Schema(description = "RFID Question Template")
public class RfidQuestionDTO implements Serializable {

    @Schema(description = "ID")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Human-readable identifier (e.g., ANIMALS_10, MATH_ADD_1)")
    @NotBlank(message = "Code is required", groups = DefaultGroup.class)
    private String code;

    @Schema(description = "Short title/label (e.g., Name 10 animals)")
    @NotBlank(message = "Title is required", groups = DefaultGroup.class)
    private String title;

    @Schema(description = "Exact text to send to Gemini when RFID is tapped")
    @NotBlank(message = "Prompt text is required", groups = DefaultGroup.class)
    private String promptText;

    @Schema(description = "Language code (en, hi, etc.)")
    private String language;

    @Schema(description = "Category (animals, math, story)")
    private String category;

    @Schema(description = "Difficulty level (1-5)")
    @Min(value = 1, message = "Difficulty must be between 1 and 5", groups = DefaultGroup.class)
    @Max(value = 5, message = "Difficulty must be between 1 and 5", groups = DefaultGroup.class)
    private Integer difficulty;

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
