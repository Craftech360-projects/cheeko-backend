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
 * RFID Series Entity
 * Maps contiguous RFID UID ranges to questions
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("rfid_series")
@Schema(description = "RFID Series/Range Entity")
public class RfidSeriesEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Start of UID range (normalized hex string)")
    private String startUid;

    @Schema(description = "End of UID range (normalized hex string)")
    private String endUid;

    @Schema(description = "FK to rfid_question table")
    private Long questionId;

    @Schema(description = "FK to rfid_pack table")
    private Long packId;

    @Schema(description = "Priority if UID matches multiple series (higher wins)")
    private Integer priority;

    @Schema(description = "Internal notes")
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
