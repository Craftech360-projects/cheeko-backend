package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.RfidContentLookupDTO;
import cheeko.modules.rfid.dto.RfidContentPackDTO;
import cheeko.modules.rfid.entity.RfidContentPackEntity;

/**
 * RFID Content Pack Service
 */
public interface RfidContentPackService extends CrudService<RfidContentPackEntity, RfidContentPackDTO> {

    /**
     * Get content pack by pack code
     * @param packCode Pack code
     * @return Content pack DTO
     */
    RfidContentPackDTO getByPackCode(String packCode);

    /**
     * Get all active content packs
     * @return List of active content packs
     */
    List<RfidContentPackDTO> getAllActive();

    /**
     * Get content packs by content type
     * @param contentType Content type (read_only or prompt)
     * @return List of content packs
     */
    List<RfidContentPackDTO> getByContentType(String contentType);

    /**
     * Get content packs by language
     * @param language Language code
     * @return List of content packs
     */
    List<RfidContentPackDTO> getByLanguage(String language);

    /**
     * Lookup content for RFID card with sequence number
     * This is the main method for the RAG system
     * @param rfidUid RFID card UID
     * @param sequence Sequence number (1-based)
     * @return Content lookup DTO with content type and text
     */
    RfidContentLookupDTO lookupContentByRfidUid(String rfidUid, Integer sequence);
}
