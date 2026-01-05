package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.RfidCardMappingDTO;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.entity.RfidCardMappingEntity;

/**
 * RFID Card Mapping Service
 */
public interface RfidCardMappingService extends CrudService<RfidCardMappingEntity, RfidCardMappingDTO> {

    /**
     * Get mapping by RFID UID
     * @param rfidUid RFID card UID
     * @return Card mapping DTO
     */
    RfidCardMappingDTO getByRfidUid(String rfidUid);

    /**
     * Get question for RFID card (main lookup for device tap)
     * @param rfidUid RFID card UID
     * @return Question DTO if card is active and mapped
     */
    RfidQuestionDTO getQuestionByRfidUid(String rfidUid);

    /**
     * Get all mappings by pack code
     * @param packCode Pack/SKU code
     * @return List of card mappings
     */
    List<RfidCardMappingDTO> getByPackCode(String packCode);

    /**
     * Get all mappings for a question
     * @param questionId Question ID
     * @return List of card mappings
     */
    List<RfidCardMappingDTO> getByQuestionId(Long questionId);
}
