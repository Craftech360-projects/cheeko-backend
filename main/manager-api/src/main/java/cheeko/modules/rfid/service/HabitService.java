package cheeko.modules.rfid.service;

import cheeko.modules.rfid.dto.HabitDownloadDTO;
import cheeko.modules.rfid.entity.HabitEntity;

/**
 * Habit Service Interface
 */
public interface HabitService {

    /**
     * Get habit by ID
     * @param habitId Habit ID
     * @return Habit entity
     */
    HabitEntity getById(Long habitId);

    /**
     * Get habit by habit code
     * @param habitCode Habit code (e.g., brush-teeth)
     * @return Habit entity
     */
    HabitEntity getByHabitCode(String habitCode);

    /**
     * Get download manifest for a habit linked to an RFID card
     * @param rfidUid RFID card UID
     * @param currentVersion Current version on device (for cache check)
     * @param currentHash Current hash on device (for cache check)
     * @return Download manifest DTO, or null if not found
     */
    HabitDownloadDTO getDownloadManifest(String rfidUid, String currentVersion, String currentHash);

    /**
     * Get download manifest by habit ID directly
     * @param habitId Habit ID
     * @param rfidUid Optional RFID UID to include in response
     * @return Download manifest DTO
     */
    HabitDownloadDTO getDownloadManifestByHabitId(Long habitId, String rfidUid);
}
