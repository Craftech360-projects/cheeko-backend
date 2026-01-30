package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.ContentDownloadDTO;
import cheeko.modules.rfid.dto.RfidContentLookupDTO;
import cheeko.modules.rfid.dto.RfidContentPackDTO;
import cheeko.modules.rfid.dto.RhymeDownloadDTO;
import cheeko.modules.rfid.entity.RfidContentPackEntity;

/**
 * RFID Content Pack Service
 * Unified service for all content types (habits, rhymes, stories, etc.)
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

    /**
     * Update cached audio URL for a specific sequence in a content pack
     * @param packCode Pack code
     * @param sequence Sequence number (1-based)
     * @param audioUrl CloudFront URL for the cached audio
     * @return true if update succeeded
     */
    boolean updateCachedAudioUrl(String packCode, Integer sequence, String audioUrl);

    /**
     * Get download manifest for rhyme content pack by RFID UID
     * Similar to HabitService.getDownloadManifest but for rhymes
     * @param rfidUid RFID card UID
     * @return Download manifest with all rhyme items and audio URLs
     * @deprecated Use getContentDownloadManifest instead
     */
    @Deprecated
    RhymeDownloadDTO getDownloadManifest(String rfidUid);

    /**
     * Unified download manifest for any content type (habits, rhymes, etc.)
     * This is the main method for device downloads
     * @param rfidUid RFID card UID
     * @return Unified download manifest with all items and audio URLs, or null if not found
     */
    ContentDownloadDTO getContentDownloadManifest(String rfidUid);

    /**
     * Get download manifest by content pack ID directly
     * @param contentPackId Content pack ID
     * @param rfidUid Optional RFID UID to include in response
     * @return Unified download manifest
     */
    ContentDownloadDTO getContentDownloadManifestByPackId(Long contentPackId, String rfidUid);
}
