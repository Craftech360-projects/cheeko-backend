package cheeko.modules.timbre.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * TimbreTableEntityClass
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("ai_tts_voice")
@Schema(description = "TimbreInformation")
public class TimbreEntity {

    @Schema(description = "id")
    private String id;

    @Schema(description = "Language")
    private String languages;

    @Schema(description = "TimbreName")
    private String name;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "ReferenceAudioPath")
    private String referenceAudio;

    @Schema(description = "ReferenceText")
    private String referenceText;

    @Schema(description = "Sort Order")
    private long sort;

    @Schema(description = "Corresponding TTS ModelPrimary Key")
    private String ttsModelId;

    @Schema(description = "TimbreCode")
    private String ttsVoice;

    @Schema(description = "AudioPlaybackAddress")
    private String voiceDemo;

    @Schema(description = "Updater")
    @TableField(fill = FieldFill.UPDATE)
    private Long updater;

    @Schema(description = "Update Time")
    @TableField(fill = FieldFill.UPDATE)
    private Date updateDate;

    @Schema(description = "Creator")
    @TableField(fill = FieldFill.INSERT)
    private Long creator;

    @Schema(description = "Create Time")
    @TableField(fill = FieldFill.INSERT)
    private Date createDate;

}