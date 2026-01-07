package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import lombok.Data;
import cheeko.common.utils.DateUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;

/**
 * RFID Content Pack DTO
 */
@Data
@Schema(description = "RFID Content Pack for RAG System")
public class RfidContentPackDTO implements Serializable {

    @Schema(description = "ID")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Unique pack identifier (e.g., RHYMES_EN_01)")
    @NotBlank(message = "Pack code is required", groups = DefaultGroup.class)
    private String packCode;

    @Schema(description = "Display name (e.g., Classic Nursery Rhymes)")
    private String name;

    @Schema(description = "Pack description")
    private String description;

    @Schema(description = "Content type: read_only (TTS only) or prompt (send to LLM)")
    private String contentType;

    @Schema(description = "Full markdown content with numbered sections")
    private String contentMd;

    @Schema(description = "Total number of items in the pack")
    private Integer totalItems;

    @Schema(description = "Language code (en, hi, etc.)")
    private String language;

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
