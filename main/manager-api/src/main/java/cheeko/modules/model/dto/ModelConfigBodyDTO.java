package cheeko.modules.model.dto;

import java.io.Serial;

import cn.hutool.json.JSONObject;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@Schema(description = "Model provider/vendor")
public class ModelConfigBodyDTO {

    @Serial
    private static final long serialVersionUID = 1L;

    // @Schema(description = "ModelType(Memory/ASR/VAD/LLM/TTS)")
    // private String modelType;
    //
    @Schema(description = "Model code (e.g. AliLLM, DoubaoTTS)")
    private String modelCode;

    @Schema(description = "ModelName")
    private String modelName;

    @Schema(description = "Whether default configuration (0: No, 1: Yes)")
    private Integer isDefault;

    @Schema(description = "WhetherEnable")
    private Integer isEnabled;

    @Schema(description = "Model configuration (JSON format)")
    private JSONObject configJson;

    @Schema(description = "Official documentation link")
    private String docLink;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "Sort Order")
    private Integer sort;
}
