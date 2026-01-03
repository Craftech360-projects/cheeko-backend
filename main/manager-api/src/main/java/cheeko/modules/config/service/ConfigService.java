package cheeko.modules.config.service;

import java.util.Map;

public interface ConfigService {
    /**
     * GetServiceServerConfiguration
     * 
     * @param isCache WhetherCache
     * @return ConfigurationInformation
     */
    Object getConfig(Boolean isCache);

    /**
     * GetAgentModelConfiguration
     *
     * @param macAddress     MACAddress
     * @param selectedModule ClientHaveInstantiates Model
     * @return ModelConfigurationInformation
     */
    Map<String, Object> getAgentModels(String macAddress, Map<String, String> selectedModule);

    /**
     * GetAgentPrompt
     *
     * @param macAddress MACAddress
     * @return AgentPrompt
     */
    String getAgentPrompt(String macAddress);

    /**
     * Get child profile associated with device
     *
     * @param macAddress MAC Address
     * @return Child profile
     */
    cheeko.modules.config.dto.ChildProfileDTO getChildProfileByMac(String macAddress);

    /**
     * GetAgentTemplateID
     *
     * @param macAddress MACAddress
     * @return TemplateID
     */
    String getAgentTemplateId(String macAddress);

    /**
     * GetTemplateContent（personality）
     *
     * @param templateId TemplateID
     * @return TemplateContent
     */
    String getTemplateContent(String templateId);

    /**
     * Get device location information
     *
     * @param macAddress MAC Address
     * @return Location information (City Name)
     */
    String getDeviceLocation(String macAddress);

    /**
     * Get weather forecast
     *
     * @param location Location (City Name)
     * @return Weather forecast text
     */
    String getWeatherForecast(String location);
}