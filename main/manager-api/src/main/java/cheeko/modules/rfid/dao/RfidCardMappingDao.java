package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.RfidCardMappingEntity;
import cheeko.modules.rfid.entity.RfidQuestionEntity;

/**
 * RFID Card Mapping DAO
 */
@Mapper
public interface RfidCardMappingDao extends BaseDao<RfidCardMappingEntity> {

    /**
     * Get mapping by RFID UID
     * @param rfidUid RFID card UID
     * @return Card mapping entity
     */
    @Select("SELECT * FROM rfid_card_mapping WHERE rfid_uid = #{rfidUid}")
    RfidCardMappingEntity getByRfidUid(@Param("rfidUid") String rfidUid);

    /**
     * Get question for RFID card (joins with rfid_question table)
     * @param rfidUid RFID card UID
     * @return Question entity if card is active and mapped
     */
    @Select("SELECT q.* FROM rfid_card_mapping m " +
            "INNER JOIN rfid_question q ON m.question_id = q.id " +
            "WHERE m.rfid_uid = #{rfidUid} AND m.active = 1 AND q.active = 1")
    RfidQuestionEntity getQuestionByRfidUid(@Param("rfidUid") String rfidUid);

    /**
     * Get question for RFID card by sequence (uses question_ids JSON array)
     * @param rfidUid RFID card UID
     * @param sequence Sequence number (1-based index into question_ids array)
     * @return Question entity if card is active and sequence is valid
     */
    @Select("SELECT q.* FROM rfid_card_mapping m " +
            "INNER JOIN rfid_question q ON q.id = JSON_EXTRACT(m.question_ids, CONCAT('$[', #{sequence} - 1, ']')) " +
            "WHERE m.rfid_uid = #{rfidUid} AND m.active = 1 AND q.active = 1 " +
            "AND m.question_ids IS NOT NULL " +
            "AND JSON_LENGTH(m.question_ids) >= #{sequence}")
    RfidQuestionEntity getQuestionByRfidUidAndSequence(@Param("rfidUid") String rfidUid, @Param("sequence") Integer sequence);

    /**
     * Get all mappings by pack code
     * @param packCode Pack/SKU code
     * @return List of card mappings
     */
    @Select("SELECT * FROM rfid_card_mapping WHERE pack_code = #{packCode} ORDER BY rfid_uid")
    List<RfidCardMappingEntity> getByPackCode(@Param("packCode") String packCode);

    /**
     * Get all mappings for a question
     * @param questionId Question ID
     * @return List of card mappings
     */
    @Select("SELECT * FROM rfid_card_mapping WHERE question_id = #{questionId} ORDER BY rfid_uid")
    List<RfidCardMappingEntity> getByQuestionId(@Param("questionId") Long questionId);
}
