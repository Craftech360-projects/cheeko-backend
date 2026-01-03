package cheeko.modules.timbre.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * TimbrePaginationParameterDTO
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Data
@Schema(description = "TimbrePaginationParameter")
public class TimbrePageDTO {

    @Schema(description = "Corresponding TTS ModelPrimary Key")
    @NotBlank(message = "{timbre.ttsModelId.require}")
    private String ttsModelId;

    @Schema(description = "TimbreName")
    private String name;

    @Schema(description = "Page number")
    private String page;

    @Schema(description = "Number of items per page")
    private String limit;
}
