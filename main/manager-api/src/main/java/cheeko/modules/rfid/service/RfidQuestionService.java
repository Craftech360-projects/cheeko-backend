package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.entity.RfidQuestionEntity;

/**
 * RFID Question Service
 */
public interface RfidQuestionService extends CrudService<RfidQuestionEntity, RfidQuestionDTO> {

    /**
     * Get question by code
     * @param code Question code
     * @return Question DTO
     */
    RfidQuestionDTO getByCode(String code);

    /**
     * Get all active questions by category
     * @param category Category name
     * @return List of questions
     */
    List<RfidQuestionDTO> getActiveByCategory(String category);

    /**
     * Get all active questions by language
     * @param language Language code
     * @return List of questions
     */
    List<RfidQuestionDTO> getActiveByLanguage(String language);
}
