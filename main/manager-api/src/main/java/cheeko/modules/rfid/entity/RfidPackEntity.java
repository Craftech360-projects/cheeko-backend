package cheeko.modules.rfid.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * RFID Pack Entity
 * Organizes RFID cards into product packs/SKUs
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("rfid_pack")
@Schema(description = "RFID Pack Entity")
public class RfidPackEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Unique pack identifier (e.g., BLINKIT_ANIMALS_PACK_1)")
    private String packCode;

    @Schema(description = "Display name")
    private String name;

    @Schema(description = "Pack description")
    private String description;

    @Schema(description = "Minimum recommended age")
    private Integer ageMin;

    @Schema(description = "Maximum recommended age")
    private Integer ageMax;

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
