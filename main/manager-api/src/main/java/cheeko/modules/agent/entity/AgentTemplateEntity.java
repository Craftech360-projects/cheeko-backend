package cheeko.modules.agent.entity;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/**
 * AgentConfigurationTemplateTable
 * 
 * @TableName ai_agent_template
 */
@TableName(value = "ai_agent_template")
@Data
public class AgentTemplateEntity implements Serializable {
    /**
     * Agent unique identifier
     */
    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * AgentCode
     */
    private String agentCode;

    /**
     * AgentName
     */
    private String agentName;

    /**
     * VoiceRecognitionModelIdentifier
     */
    private String asrModelId;

    /**
     * Voice activity detection identifier
     */
    private String vadModelId;

    /**
     * LargeLanguageModelIdentifier
     */
    private String llmModelId;

    /**
     * VLLMModelIdentifier
     */
    private String vllmModelId;

    /**
     * Voice synthesis model identifier
     */
    private String ttsModelId;

    /**
     * TimbreIdentifier
     */
    private String ttsVoiceId;

    /**
     * Memory model identifier
     */
    private String memModelId;

    /**
     * IntentModelIdentifier
     */
    private String intentModelId;

    /**
     * Chat record configuration (0: Do not record, 1: Only record text, 2: Record text and voice)
     */
    private Integer chatHistoryConf;

    /**
     * Role setting parameters
     */
    private String systemPrompt;

    /**
     * Summary memory
     */
    private String summaryMemory;
    /**
     * LanguageCode
     */
    private String langCode;

    /**
     * Interaction language
     */
    private String language;

    /**
     * Sort order weight
     */
    private Integer sort;

    /**
     * Whether display in application (0: Do not display, 1: Display)
     */
    private Integer isVisible;

    /**
     * Creator ID
     */
    private Long creator;

    /**
     * Create Time
     */
    private Date createdAt;

    /**
     * Updater ID
     */
    private Long updater;

    /**
     * Update Time
     */
    private Date updatedAt;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;
}