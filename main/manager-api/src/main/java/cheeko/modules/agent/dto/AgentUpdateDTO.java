package cheeko.modules.agent.dto;

import java.io.Serializable;
import java.util.HashMap;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

/**
 * AgentUpdateDTO
 * Dedicated for updating agent, id field is required, used to identify the agent to update
 * Other fields are all optional, only update provided fields
 */
@Data
@Schema(description = "AgentUpdateObject")
public class AgentUpdateDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "AgentCode", example = "AGT_1234567890", nullable = true)
    private String agentCode;

    @Schema(description = "Agent name", example = "Customer service assistant", nullable = true)
    private String agentName;

    @Schema(description = "VoiceRecognitionModelIdentifier", example = "asr_model_02", nullable = true)
    private String asrModelId;

    @Schema(description = "Voice activity detection identifier", example = "vad_model_02", nullable = true)
    private String vadModelId;

    @Schema(description = "LargeLanguageModelIdentifier", example = "llm_model_02", nullable = true)
    private String llmModelId;

    @Schema(description = "VLLMModelIdentifier", example = "vllm_model_02", required = false)
    private String vllmModelId;

    @Schema(description = "Voice synthesis model identifier", example = "tts_model_02", required = false)
    private String ttsModelId;

    @Schema(description = "TimbreIdentifier", example = "voice_02", nullable = true)
    private String ttsVoiceId;

    @Schema(description = "Memory model identifier", example = "mem_model_02", nullable = true)
    private String memModelId;

    @Schema(description = "IntentModelIdentifier", example = "intent_model_02", nullable = true)
    private String intentModelId;

    @Schema(description = "PluginFunctionInformation", nullable = true)
    private List<FunctionInfo> functions;

    @Schema(description = "Role setting parameters", example = "You are a professional customer service assistant, responsible for answering user questions and providing help", nullable = true)
    private String systemPrompt;

    @Schema(description = "Summary memory", example = "Build a growable dynamic memory network, retain key information within limited space, and intelligently maintain information evolution trajectory\n"
            + "Summarize important user information from conversation records to provide more personalized service in future conversations", nullable = true)
    private String summaryMemory;

    @Schema(description = "Chat record configuration (0: Do not record, 1: Only record text, 2: Record text and voice)", example = "3", nullable = true)
    private Integer chatHistoryConf;

    @Schema(description = "LanguageCode", example = "zh_CN", nullable = true)
    private String langCode;

    @Schema(description = "Interaction language", example = "Chinese", nullable = true)
    private String language;

    @Schema(description = "Sort Order", example = "1", nullable = true)
    private Integer sort;

    @Data
    @Slf4j
    @Schema(description = "PluginFunctionInformation")
    public static class FunctionInfo implements Serializable {
        private static final ObjectMapper objectMapper = new ObjectMapper();
        
        @Schema(description = "PluginID", example = "plugin_01")
        private String pluginId;

        @Schema(description = "FunctionParameterInformation", nullable = true)
        private HashMap<String, Object> paramInfo;

        /**
         * Custom setter to handle paramInfo as either a JSON string or object
         * This handles cases where frontend sends '{}' as a string instead of an object
         */
        @JsonSetter(value = "paramInfo", nulls = Nulls.SKIP)
        public void setParamInfo(Object value) {
            if (value == null) {
                this.paramInfo = new HashMap<>();
                return;
            }
            
            if (value instanceof String) {
                String strValue = (String) value;
                // Handle empty string or "{}" string
                if (strValue.trim().isEmpty() || strValue.trim().equals("{}")) {
                    this.paramInfo = new HashMap<>();
                } else {
                    try {
                        // Try to parse string as JSON
                        this.paramInfo = objectMapper.readValue(strValue, 
                            new TypeReference<HashMap<String, Object>>() {});
                    } catch (Exception e) {
                        log.warn("Failed to parse paramInfo string '{}', using empty HashMap", strValue, e);
                        this.paramInfo = new HashMap<>();
                    }
                }
            } else if (value instanceof HashMap) {
                this.paramInfo = (HashMap<String, Object>) value;
            } else {
                // Try to convert other types to HashMap
                try {
                    String json = objectMapper.writeValueAsString(value);
                    this.paramInfo = objectMapper.readValue(json, 
                        new TypeReference<HashMap<String, Object>>() {});
                } catch (Exception e) {
                    log.warn("Failed to convert paramInfo value to HashMap, using empty HashMap", e);
                    this.paramInfo = new HashMap<>();
                }
            }
        }

        private static final long serialVersionUID = 1L;
    }
}