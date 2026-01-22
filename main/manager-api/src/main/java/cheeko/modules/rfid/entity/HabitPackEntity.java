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
 * Habit Pack Entity
 * Organizes habits into content packs
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("habit_pack")
@Schema(description = "Habit Pack Entity")
public class HabitPackEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Unique pack identifier (e.g., HABITS_EN_01)")
    private String packCode;

    @Schema(description = "Display name")
    private String name;

    @Schema(description = "Pack description")
    private String description;

    @Schema(description = "Total number of habits in pack")
    private Integer totalHabits;

    @Schema(description = "Language code (e.g., en, hi)")
    private String language;

    @Schema(description = "Content version")
    private String version;

    @Schema(description = "Content hash for cache validation")
    private String contentHash;

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
