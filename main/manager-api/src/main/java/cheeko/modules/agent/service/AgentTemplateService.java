package cheeko.modules.agent.service;

import com.baomidou.mybatisplus.extension.service.IService;

import cheeko.modules.agent.entity.AgentTemplateEntity;

/**
 * @author chenerlei
 * @description Database operation service for table【ai_agent_template(Agent configuration template table)】
 * @createDate 2025-03-22 11:48:18
 */
public interface AgentTemplateService extends IService<AgentTemplateEntity> {

    /**
     * Get default template
     * 
     * @return Default template entity
     */
    AgentTemplateEntity getDefaultTemplate();

    /**
     * Update model ID in default template
     *
     * @param modelType Model type
     * @param modelId   Model ID
     */
    void updateDefaultTemplateModelId(String modelType, String modelId);

    /**
     * Get template by template name
     *
     * @param modeName Template name
     * @return Template entity
     */
    AgentTemplateEntity getTemplateByName(String modeName);
}
