package xiaozhi.modules.agent.dao;

import org.apache.ibatis.annotations.Mapper;

import xiaozhi.common.dao.BaseDao;
import xiaozhi.modules.agent.entity.AnalyticsStreakEntity;

/**
 * Analytics Streak DAO
 */
@Mapper
public interface AnalyticsStreakDao extends BaseDao<AnalyticsStreakEntity> {
}
