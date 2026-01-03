package cheeko.modules.agent.entity;

import java.io.Serializable;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Agent and plugin unique mapping table
 * 
 * @TableName ai_agent_plugin_mapping
 */
@Data
@TableName(value = "ai_agent_plugin_mapping")
@Schema(description = "Agent and plugin unique mapping table")
public class AgentPluginMapping implements Serializable {
    /**
     * Primary Key
     */
    @TableId(type = IdType.ASSIGN_ID)
    @Schema(description = "Mapping information primary key ID")
    private Long id;

    /**
     * AgentID
     */
    @Schema(description = "AgentID")
    private String agentId;

    /**
     * PluginID
     */
    @Schema(description = "PluginID")
    private String pluginId;

    /**
     * Plugin parameter (JSON) format
     */
    @Schema(description = "Plugin parameter (JSON) format")
    private String paramInfo;

    // Redundant field, used for convenience when querying plugin by ID, to query plugin's provider_code, see DAO layer XML file
    @TableField(exist = false)
    @Schema(description = "Plugin provider_code, corresponds to table ai_model_provider")
    private String providerCode;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;
}