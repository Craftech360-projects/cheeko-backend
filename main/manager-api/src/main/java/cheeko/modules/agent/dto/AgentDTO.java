package cheeko.modules.agent.dto;

import java.util.Date;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Agent data transfer object
 * Used to transfer agent-related data between service layer and controller layer
 */
@Data
@Schema(description = "AgentObject")
public class AgentDTO {
    @Schema(description = "AgentCode", example = "AGT_1234567890")
    private String id;

    @Schema(description = "Agent name", example = "Customer service assistant")
    private String agentName;

    @Schema(description = "Voice synthesis model name", example = "tts_model_01")
    private String ttsModelName;

    @Schema(description = "TimbreName", example = "voice_01")
    private String ttsVoiceName;

    @Schema(description = "LargeLanguageModelName", example = "llm_model_01")
    private String llmModelName;

    @Schema(description = "Vision model name", example = "vllm_model_01")
    private String vllmModelName;

    @Schema(description = "Memory model ID", example = "mem_model_01")
    private String memModelId;

    @Schema(description = "Role setting parameters", example = "You are a professional customer service assistant, responsible for answering user questions and providing help")
    private String systemPrompt;

    @Schema(description = "Summary memory", example = "Build a growable dynamic memory network, retain key information within limited space, and intelligently maintain information evolution trajectory\n" +
            "Summarize important user information from conversation records to provide more personalized service in future conversations", required = false)
    private String summaryMemory;

    @Schema(description = "LastConnectionTime", example = "2024-03-20 10:00:00")
    private Date lastConnectedAt;

    @Schema(description = "Device count", example = "10")
    private Integer deviceCount;

    @Schema(description = "DeviceMACAddressList", example = "AA:BB:CC:DD:EE:FF,11:22:33:44:55:66")
    private String deviceMacAddresses;

    // Admin dedicated field - Agent owner information
    @Schema(description = "Owner username", example = "john_doe")
    private String ownerUsername;

    @Schema(description = "Create Time", example = "2024-03-20 10:00:00")
    private Date createDate;
}