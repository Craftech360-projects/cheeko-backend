package cheeko.modules.sys.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * Kid profile entity for children linked to devices
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("kid_profile")
@Schema(description = "Kid Profile Entity")
public class KidProfileEntity extends BaseEntity {

    @Schema(description = "User ID (parent)")
    private Long userId;

    @Schema(description = "Child name")
    private String name;

    @Schema(description = "Date of birth")
    private Date dateOfBirth;

    @Schema(description = "Gender (male/female/other)")
    private String gender;

    @Schema(description = "Interests (JSON array)")
    private String interests;

    @Schema(description = "Avatar URL")
    private String avatarUrl;

    @Schema(description = "Primary language for AI conversations")
    private String primaryLanguage;

    @Schema(description = "Parent-provided context about child personality, traits, likes, dislikes, challenges")
    private String additionalNotes;

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
