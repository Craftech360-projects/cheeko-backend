package cheeko.modules.timbre.vo;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * TimbreDetailsDisplayVO
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
public class TimbreDetailsVO implements Serializable {
    @Schema(description = "Timbreid")
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

}
