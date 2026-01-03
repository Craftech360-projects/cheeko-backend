package cheeko.modules.agent.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.modules.agent.entity.AgentTemplateEntity;

@Data
@EqualsAndHashCode(callSuper = true)
public class AgentTemplateVO extends AgentTemplateEntity {
    // RoleTimbre
    private String ttsModelName;

    // RoleModel
    private String llmModelName;
}
