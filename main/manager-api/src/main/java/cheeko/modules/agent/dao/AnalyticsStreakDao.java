package cheeko.modules.agent.dao;

import org.apache.ibatis.annotations.Mapper;

import cheeko.common.dao.BaseDao;
import cheeko.modules.agent.entity.AnalyticsStreakEntity;

/**
 * Analytics Streak DAO
 */
@Mapper
public interface AnalyticsStreakDao extends BaseDao<AnalyticsStreakEntity> {
}
