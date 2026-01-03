package cheeko.modules.config.dto;

import java.util.Map;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
@Schema(description = "GetAgentModelConfigurationDTO")
public class AgentModelsDTO {

    @NotBlank(message = "DeviceMACAddressCannot beEmpty")
    @Schema(description = "DeviceMACAddress")
    private String macAddress;

    @NotBlank(message = "ClientIDCannot beEmpty")
    @Schema(description = "ClientID")
    private String clientId;

    @NotNull(message = "ClientHaveInstantiates ModelCannot beEmpty")
    @Schema(description = "ClientHaveInstantiates Model")
    private Map<String, String> selectedModule;
}