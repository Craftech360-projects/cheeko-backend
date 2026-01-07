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
 * RFID Content Pack Entity
 * Stores markdown content for read-only TTS playback (RAG system)
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("rfid_content_pack")
@Schema(description = "RFID Content Pack Entity for RAG System")
public class RfidContentPackEntity extends BaseEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Unique pack identifier (e.g., RHYMES_EN_01)")
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
