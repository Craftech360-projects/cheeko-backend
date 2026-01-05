package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.entity.RfidSeriesEntity;

/**
 * RFID Series DAO
 */
@Mapper
public interface RfidSeriesDao extends BaseDao<RfidSeriesEntity> {

    /**
     * Find series that contains the given UID (for range matching)
     * UIDs are compared as hex strings lexicographically
     * @param uid RFID UID to check
     * @return List of matching series ordered by priority (highest first)
     */
    @Select("SELECT * FROM rfid_series " +
            "WHERE active = 1 " +
            "AND start_uid <= #{uid} AND end_uid >= #{uid} " +
            "ORDER BY priority DESC, id ASC")
    List<RfidSeriesEntity> findSeriesContainingUid(@Param("uid") String uid);

    /**
     * Get question for UID by series range match (highest priority wins)
     * @param uid RFID UID to check
     * @return Question entity if found
     */
    @Select("SELECT q.* FROM rfid_series s " +
            "INNER JOIN rfid_question q ON s.question_id = q.id " +
            "WHERE s.active = 1 AND q.active = 1 " +
            "AND s.start_uid <= #{uid} AND s.end_uid >= #{uid} " +
            "ORDER BY s.priority DESC, s.id ASC " +
            "LIMIT 1")
    RfidQuestionEntity getQuestionByUidRange(@Param("uid") String uid);

    /**
     * Get all series by pack ID
     * @param packId Pack ID
     * @return List of series
     */
    @Select("SELECT * FROM rfid_series WHERE pack_id = #{packId} ORDER BY start_uid")
    List<RfidSeriesEntity> getByPackId(@Param("packId") Long packId);

    /**
     * Get all series by question ID
     * @param questionId Question ID
     * @return List of series
     */
    @Select("SELECT * FROM rfid_series WHERE question_id = #{questionId} ORDER BY start_uid")
    List<RfidSeriesEntity> getByQuestionId(@Param("questionId") Long questionId);

    /**
     * Get all active series
     * @return List of active series
     */
    @Select("SELECT * FROM rfid_series WHERE active = 1 ORDER BY priority DESC, start_uid")
    List<RfidSeriesEntity> getAllActive();
}
