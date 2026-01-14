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
 * RFID Question Template Entity
 * Stores reusable question prompts that can be attached to RFID cards
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("rfid_question")
@Schema(description = "RFID Question Template Entity")
public class RfidQuestionEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Human-readable identifier (e.g., ANIMALS_10, MATH_ADD_1)")
    private String code;

    @Schema(description = "Short title/label (e.g., Name 10 animals)")
    private String title;

    @Schema(description = "Exact text to send to Gemini when RFID is tapped")
    private String promptText;

    @Schema(description = "Language code (en, hi, etc.)")
    private String language;

    @Schema(description = "Category (animals, math, story)")
    private String category;

    @Schema(description = "Difficulty level (1-5)")
    private Integer difficulty;

    @Schema(description = "S3/CloudFront URL for cached AI-generated audio response")
    private String cachedAudioUrl;

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
