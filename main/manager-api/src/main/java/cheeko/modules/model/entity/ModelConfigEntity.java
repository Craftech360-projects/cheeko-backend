package cheeko.modules.model.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import cn.hutool.json.JSONObject;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@TableName(value = "ai_model_config", autoResultMap = true)
@Schema(description = "ModelConfigurationTable")
public class ModelConfigEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    @Schema(description = "Primary Key")
    private String id;

    @Schema(description = "ModelType(Memory/ASR/VAD/LLM/TTS)")
    private String modelType;

    @Schema(description = "Model code (e.g. AliLLM, DoubaoTTS)")
    private String modelCode;

    @Schema(description = "ModelName")
    private String modelName;

    @Schema(description = "Whether default configuration (0: No, 1: Yes)")
    private Integer isDefault;

    @Schema(description = "WhetherEnable")
    private Integer isEnabled;

    @TableField(typeHandler = JacksonTypeHandler.class)
    @Schema(description = "Model configuration (JSON format)")
    private JSONObject configJson;

    @Schema(description = "Official documentation link")
    private String docLink;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "Sort Order")
    private Integer sort;

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
