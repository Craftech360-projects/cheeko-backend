package cheeko.modules.agent.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import cheeko.modules.agent.entity.AgentPluginMapping;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import java.util.List;

/**
* @description Database operation mapper for table【ai_agent_plugin_mapping(Agent and plugin unique mapping table)】
* @createDate 2025-05-25 22:33:17
* @Entity cheeko.modules.agent.entity.AgentPluginMapping
*/
@Mapper
public interface AgentPluginMappingMapper extends BaseMapper<AgentPluginMapping> {
    List<AgentPluginMapping> selectPluginsByAgentId(@Param("agentId") String agentId);
}




