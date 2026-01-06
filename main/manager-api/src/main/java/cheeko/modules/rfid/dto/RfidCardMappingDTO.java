package cheeko.modules.rfid.dto;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

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
 * RFID Card Mapping DTO
 */
@Data
@Schema(description = "RFID Card to Question Mapping")
public class RfidCardMappingDTO implements Serializable {

    @Schema(description = "ID")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "RFID card UID (hex string format)")
    @NotBlank(message = "RFID UID is required", groups = DefaultGroup.class)
    private String rfidUid;

    @Schema(description = "FK to rfid_question table (legacy single question)")
    private Long questionId;

    @Schema(description = "JSON array of question IDs for multi-question support")
    private List<Long> questionIds;

    @Schema(description = "Product/pack/SKU identifier (e.g., BLINKIT_ANIMALS_PACK_1)")
    private String packCode;

    @Schema(description = "FK to rfid_pack table")
    private Long packId;

    @Schema(description = "Internal notes or description")
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
