package cheeko.modules.agent.dao;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.agent.entity.AgentTemplateEntity;

/**
 * @author chenerlei
 * @description Database operation mapper for table【ai_agent_template(Agent configuration template table)】
 * @createDate 2025-03-22 11:48:18
 */
@Mapper
public interface AgentTemplateDao extends BaseMapper<AgentTemplateEntity> {

}
