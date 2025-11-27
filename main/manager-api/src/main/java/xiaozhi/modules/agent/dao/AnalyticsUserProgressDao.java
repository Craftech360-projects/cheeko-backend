package xiaozhi.modules.agent.dao;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import xiaozhi.modules.agent.entity.AnalyticsUserProgressEntity;

/**
 * {@link AnalyticsUserProgressEntity} Analytics User Progress Dao
 *
 * @author claude
 * @version 1.0, 2025/11/21
 * @since 1.0.0
 */
@Mapper
public interface AnalyticsUserProgressDao extends BaseMapper<AnalyticsUserProgressEntity> {
}
