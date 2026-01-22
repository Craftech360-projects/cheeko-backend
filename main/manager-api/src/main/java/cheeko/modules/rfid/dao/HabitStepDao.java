package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.HabitStepEntity;

/**
 * Habit Step DAO
 */
@Mapper
public interface HabitStepDao extends BaseDao<HabitStepEntity> {

    /**
     * Get all steps for a habit
     * @param habitId Habit ID
     * @return List of steps ordered by step number
     */
    @Select("SELECT * FROM habit_step WHERE habit_id = #{habitId} AND active = 1 ORDER BY step_number")
    List<HabitStepEntity> getByHabitId(@Param("habitId") Long habitId);

    /**
     * Get a specific step
     * @param habitId Habit ID
     * @param stepNumber Step number
     * @return Step entity
     */
    @Select("SELECT * FROM habit_step WHERE habit_id = #{habitId} AND step_number = #{stepNumber}")
    HabitStepEntity getStep(@Param("habitId") Long habitId, @Param("stepNumber") Integer stepNumber);

    /**
     * Get total size of all media for a habit
     * @param habitId Habit ID
     * @return Total size in bytes
     */
    @Select("SELECT COALESCE(SUM(audio_size_bytes), 0) FROM habit_step WHERE habit_id = #{habitId} AND active = 1")
    Long getTotalAudioSize(@Param("habitId") Long habitId);
}
