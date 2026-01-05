package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.dto.RfidSeriesDTO;
import cheeko.modules.rfid.entity.RfidSeriesEntity;

/**
 * RFID Series Service
 */
public interface RfidSeriesService extends CrudService<RfidSeriesEntity, RfidSeriesDTO> {

    /**
     * Find series that contains the given UID
     * @param uid RFID UID to check
     * @return List of matching series ordered by priority
     */
    List<RfidSeriesDTO> findSeriesContainingUid(String uid);

    /**
     * Get question for UID by series range match
     * @param uid RFID UID to check
     * @return Question DTO if found
     */
    RfidQuestionDTO getQuestionByUidRange(String uid);

    /**
     * Get all series by pack ID
     * @param packId Pack ID
     * @return List of series
     */
    List<RfidSeriesDTO> getByPackId(Long packId);

    /**
     * Get all series by question ID
     * @param questionId Question ID
     * @return List of series
     */
    List<RfidSeriesDTO> getByQuestionId(Long questionId);

    /**
     * Get all active series
     * @return List of active series
     */
    List<RfidSeriesDTO> getAllActive();
}
