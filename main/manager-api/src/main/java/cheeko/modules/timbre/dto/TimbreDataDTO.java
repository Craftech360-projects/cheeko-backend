package cheeko.modules.timbre.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * TimbreTableDataDTO
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
@Schema(description = "TimbreTableInformation")
public class TimbreDataDTO {

    @Schema(description = "Language")
    @NotBlank(message = "{timbre.languages.require}")
    private String languages;

    @Schema(description = "TimbreName")
    @NotBlank(message = "{timbre.name.require}")
    private String name;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "ReferenceAudioPath")
    private String referenceAudio;

    @Schema(description = "ReferenceText")
    private String referenceText;

    @Schema(description = "Sort Order")
    @Min(value = 0, message = "{sort.number}")
    private long sort;

    @Schema(description = "Corresponding TTS ModelPrimary Key")
    @NotBlank(message = "{timbre.ttsModelId.require}")
    private String ttsModelId;

    @Schema(description = "TimbreCode")
    @NotBlank(message = "{timbre.ttsVoice.require}")
    private String ttsVoice;

    @Schema(description = "AudioPlaybackAddress")
    private String voiceDemo;
}