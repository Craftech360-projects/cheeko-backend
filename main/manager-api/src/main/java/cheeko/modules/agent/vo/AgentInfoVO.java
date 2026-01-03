package cheeko.modules.agent.vo;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.entity.AgentPluginMapping;

import java.util.List;

/**
 * Agent information return body VO
 * Here directly extends AgentEntity class, subsequently required standardize return fields can copy fields out
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class AgentInfoVO extends AgentEntity
{
    @Schema(description = "Plugin list ID")
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<AgentPluginMapping> functions;
}
