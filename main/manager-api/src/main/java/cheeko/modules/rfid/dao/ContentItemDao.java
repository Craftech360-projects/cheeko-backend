package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.ContentItemEntity;

/**
 * Unified Content Item DAO
 * Works with all content types (rhymes, habits, etc.)
 */
@Mapper
public interface ContentItemDao extends BaseDao<ContentItemEntity> {

    /**
     * Get all items for a content pack
     * @param contentPackId Content pack ID
     * @return List of items ordered by item number
     */
    @Select("SELECT * FROM content_item WHERE content_pack_id = #{contentPackId} AND active = 1 ORDER BY item_number")
    List<ContentItemEntity> getByContentPackId(@Param("contentPackId") Long contentPackId);

    /**
     * Get a specific item
     * @param contentPackId Content pack ID
     * @param itemNumber Item number
     * @return Item entity
     */
    @Select("SELECT * FROM content_item WHERE content_pack_id = #{contentPackId} AND item_number = #{itemNumber}")
    ContentItemEntity getItem(@Param("contentPackId") Long contentPackId, @Param("itemNumber") Integer itemNumber);

    /**
     * Get total size of all audio for a content pack
     * @param contentPackId Content pack ID
     * @return Total size in bytes
     */
    @Select("SELECT COALESCE(SUM(audio_size_bytes), 0) FROM content_item WHERE content_pack_id = #{contentPackId} AND active = 1")
    Long getTotalAudioSize(@Param("contentPackId") Long contentPackId);

    /**
     * Get total size of all images for a content pack (habits)
     * @param contentPackId Content pack ID
     * @return Total size in bytes (estimated from images_json)
     */
    @Select("SELECT COUNT(*) FROM content_item WHERE content_pack_id = #{contentPackId} AND active = 1 AND images_json IS NOT NULL")
    Integer countItemsWithImages(@Param("contentPackId") Long contentPackId);
}
