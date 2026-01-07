package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.RfidContentPackEntity;

/**
 * RFID Content Pack DAO
 */
@Mapper
public interface RfidContentPackDao extends BaseDao<RfidContentPackEntity> {

    /**
     * Get content pack by pack code
     * @param packCode Pack code
     * @return Content pack entity
     */
    @Select("SELECT * FROM rfid_content_pack WHERE pack_code = #{packCode}")
    RfidContentPackEntity getByPackCode(@Param("packCode") String packCode);

    /**
     * Get all active content packs
     * @return List of active content packs
     */
    @Select("SELECT * FROM rfid_content_pack WHERE active = 1 ORDER BY name")
    List<RfidContentPackEntity> getAllActive();

    /**
     * Get content packs by content type
     * @param contentType Content type (read_only or prompt)
     * @return List of content packs
     */
    @Select("SELECT * FROM rfid_content_pack WHERE active = 1 AND content_type = #{contentType} ORDER BY name")
    List<RfidContentPackEntity> getByContentType(@Param("contentType") String contentType);

    /**
     * Get content packs by language
     * @param language Language code
     * @return List of content packs
     */
    @Select("SELECT * FROM rfid_content_pack WHERE active = 1 AND language = #{language} ORDER BY name")
    List<RfidContentPackEntity> getByLanguage(@Param("language") String language);

    /**
     * Get content pack by card mapping's content_pack_id
     * @param rfidUid RFID card UID
     * @return Content pack entity
     */
    @Select("SELECT cp.* FROM rfid_content_pack cp " +
            "INNER JOIN rfid_card_mapping m ON cp.id = m.content_pack_id " +
            "WHERE m.rfid_uid = #{rfidUid} AND m.active = 1 AND cp.active = 1")
    RfidContentPackEntity getByRfidUid(@Param("rfidUid") String rfidUid);
}
