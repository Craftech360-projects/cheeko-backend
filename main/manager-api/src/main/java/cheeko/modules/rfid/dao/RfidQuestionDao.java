package cheeko.modules.rfid.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import cheeko.common.dao.BaseDao;
import cheeko.modules.rfid.entity.RfidQuestionEntity;

/**
 * RFID Question DAO
 */
@Mapper
public interface RfidQuestionDao extends BaseDao<RfidQuestionEntity> {

    /**
     * Get question by code
     * @param code Question code
     * @return Question entity
     */
    @Select("SELECT * FROM rfid_question WHERE code = #{code}")
    RfidQuestionEntity getByCode(@Param("code") String code);

    /**
     * Get all active questions by category
     * @param category Category name
     * @return List of questions
     */
    @Select("SELECT * FROM rfid_question WHERE category = #{category} AND active = 1 ORDER BY difficulty, code")
    List<RfidQuestionEntity> getActiveByCategory(@Param("category") String category);

    /**
     * Get all active questions by language
     * @param language Language code
     * @return List of questions
     */
    @Select("SELECT * FROM rfid_question WHERE language = #{language} AND active = 1 ORDER BY category, difficulty")
    List<RfidQuestionEntity> getActiveByLanguage(@Param("language") String language);
}
