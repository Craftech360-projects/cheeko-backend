package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.HabitPackEntity;

/**
 * Habit Pack DAO
 */
@Mapper
public interface HabitPackDao extends BaseDao<HabitPackEntity> {

    /**
     * Get pack by pack code
     * @param packCode Pack code
     * @return Pack entity
     */
    @Select("SELECT * FROM habit_pack WHERE pack_code = #{packCode}")
    HabitPackEntity getByPackCode(@Param("packCode") String packCode);

    /**
     * Get all active packs
     * @return List of active packs
     */
    @Select("SELECT * FROM habit_pack WHERE active = 1 ORDER BY name")
    List<HabitPackEntity> getAllActive();

    /**
     * Get packs by language
     * @param language Language code
     * @return List of packs
     */
    @Select("SELECT * FROM habit_pack WHERE active = 1 AND language = #{language} ORDER BY name")
    List<HabitPackEntity> getByLanguage(@Param("language") String language);
}
