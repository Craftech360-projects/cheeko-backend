package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.HabitEntity;

/**
 * Habit DAO
 */
@Mapper
public interface HabitDao extends BaseDao<HabitEntity> {

    /**
     * Get habit by habit code
     * @param habitCode Habit code
     * @return Habit entity
     */
    @Select("SELECT * FROM habit WHERE habit_code = #{habitCode}")
    HabitEntity getByHabitCode(@Param("habitCode") String habitCode);

    /**
     * Get all habits for a pack
     * @param packId Pack ID
     * @return List of habits
     */
    @Select("SELECT * FROM habit WHERE pack_id = #{packId} AND active = 1 ORDER BY sequence")
    List<HabitEntity> getByPackId(@Param("packId") Long packId);

    /**
     * Get all active habits
     * @return List of active habits
     */
    @Select("SELECT * FROM habit WHERE active = 1 ORDER BY sequence")
    List<HabitEntity> getAllActive();
}
