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
 * Unified Content Item Entity
 * Represents a single item (rhyme, habit step, etc.) within a content pack
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("content_item")
@Schema(description = "Unified Content Item Entity")
public class ContentItemEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "FK to rfid_content_pack table")
    private Long contentPackId;

    @Schema(description = "Item number (1-based)")
    private Integer itemNumber;

    @Schema(description = "Item title")
    private String title;

    @Schema(description = "Description or instruction text")
    private String description;

    @Schema(description = "Audio file URL")
    private String audioUrl;

    @Schema(description = "Audio file size in bytes")
    private Long audioSizeBytes;

    @Schema(description = "Audio duration in milliseconds")
    private Integer audioDurationMs;

    @Schema(description = "JSON array of images [{url, sizeBytes, sequence}] - for habits")
    private String imagesJson;

    @Schema(description = "Lyrics/content text - for rhymes")
    private String lyricsText;

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
