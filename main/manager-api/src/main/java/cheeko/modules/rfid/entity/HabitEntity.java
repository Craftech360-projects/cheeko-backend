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
 * Habit Entity
 * Represents an individual habit (e.g., brushing teeth, tying shoelaces)
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("habit")
@Schema(description = "Habit Entity")
public class HabitEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "FK to habit_pack table")
    private Long packId;

    @Schema(description = "Unique habit identifier (e.g., brush-teeth, tie-shoelace)")
    private String habitCode;

    @Schema(description = "Display name")
    private String name;

    @Schema(description = "Habit description")
    private String description;

    @Schema(description = "Order within pack")
    private Integer sequence;

    @Schema(description = "Total number of steps")
    private Integer totalSteps;

    @Schema(description = "Thumbnail image URL")
    private String thumbnailUrl;

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
