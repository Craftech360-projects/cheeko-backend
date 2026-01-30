package cheeko.modules.rfid.entity;

import java.util.Date;
import java.util.List;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * RFID Card Mapping Entity
 * Links physical RFID UIDs to question templates
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName(value = "rfid_card_mapping", autoResultMap = true)
@Schema(description = "RFID Card to Question Mapping Entity")
public class RfidCardMappingEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "RFID card UID (hex string format)")
    private String rfidUid;

    @Schema(description = "FK to rfid_question table (legacy single question)")
    private Long questionId;

    @Schema(description = "JSON array of question IDs for multi-question support")
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Long> questionIds;

    @Schema(description = "Product/pack/SKU identifier (e.g., BLINKIT_ANIMALS_PACK_1)")
    private String packCode;

    @Schema(description = "FK to rfid_pack table")
    private Long packId;

    @Schema(description = "FK to rfid_content_pack table - unified for all content types (habits, rhymes, etc.)")
    private Long contentPackId;

    @Schema(description = "Internal notes or description")
    private String notes;

    @Schema(description = "Active status: 0=Disabled, 1=Enabled")
    private Boolean active;

    @Schema(description = "Creator user ID")
    @TableField(fill = FieldFill.INSERT)
    private Long creator;

    @Schema(description = "Creation date")
    @TableField(fill = FieldFill.INSERT)
    private Date createDate;

    @Schema(description = "Last updater user ID")
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updater;

    @Schema(description = "Last update date")
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Date updateDate;
}
