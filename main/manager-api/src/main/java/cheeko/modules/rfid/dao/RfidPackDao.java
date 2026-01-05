package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.RfidPackEntity;

/**
 * RFID Pack DAO
 */
@Mapper
public interface RfidPackDao extends BaseDao<RfidPackEntity> {

    /**
     * Get pack by pack code
     * @param packCode Pack code
     * @return Pack entity
     */
    @Select("SELECT * FROM rfid_pack WHERE pack_code = #{packCode}")
    RfidPackEntity getByPackCode(@Param("packCode") String packCode);

    /**
     * Get all active packs
     * @return List of active packs
     */
    @Select("SELECT * FROM rfid_pack WHERE active = 1 ORDER BY name")
    List<RfidPackEntity> getAllActive();

    /**
     * Get packs by age range (where pack's age range overlaps with given age)
     * @param age Child's age
     * @return List of suitable packs
     */
    @Select("SELECT * FROM rfid_pack WHERE active = 1 " +
            "AND (age_min IS NULL OR age_min <= #{age}) " +
            "AND (age_max IS NULL OR age_max >= #{age}) " +
            "ORDER BY name")
    List<RfidPackEntity> getByAge(@Param("age") Integer age);
}
