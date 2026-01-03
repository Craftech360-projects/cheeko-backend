package cheeko.modules.agent.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@TableName("ai_agent")
@Schema(description = "AgentInformation")
public class AgentEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    @Schema(description = "Agent unique identifier")
    private String id;

    @Schema(description = "Belongs to user ID")
    private Long userId;

    @Schema(description = "AgentCode")
    private String agentCode;

    @Schema(description = "AgentName")
    private String agentName;

    @Schema(description = "VoiceRecognitionModelIdentifier")
    private String asrModelId;

    @Schema(description = "Voice activity detection identifier")
    private String vadModelId;

    @Schema(description = "LargeLanguageModelIdentifier")
    private String llmModelId;

    @Schema(description = "VLLMModelIdentifier")
    private String vllmModelId;

    @Schema(description = "Voice synthesis model identifier")
    private String ttsModelId;

    @Schema(description = "TimbreIdentifier")
    private String ttsVoiceId;

    @Schema(description = "Memory model identifier")
    private String memModelId;

    @Schema(description = "IntentModelIdentifier")
    private String intentModelId;

    @Schema(description = "Chat record configuration (0: Do not record, 1: Only record text, 2: Record text and voice)")
    private Integer chatHistoryConf;

    @Schema(description = "Role setting parameters")
    private String systemPrompt;

    @Schema(description = "Summary memory", example = "Build a growable dynamic memory network, retain key information within limited space, and intelligently maintain information evolution trajectory\n" +
            "Summarize important user information from conversation records to provide more personalized service in future conversations", required = false)
    private String summaryMemory;

    @Schema(description = "LanguageCode")
    private String langCode;

    @Schema(description = "Interaction language")
    private String language;

    @Schema(description = "Sort Order")
    private Integer sort;

    @Schema(description = "Creator")
    private Long creator;

    @Schema(description = "Create Time")
    private Date createdAt;

    @Schema(description = "Updater")
    private Long updater;

    @Schema(description = "Update Time")
    private Date updatedAt;
}