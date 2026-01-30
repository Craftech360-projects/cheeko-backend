package cheeko.modules.rfid.service;

import cheeko.modules.rfid.dto.HabitDownloadDTO;

/**
 * Habit Service Interface
 * @deprecated Use RfidContentPackService.getContentDownloadManifest instead
 */
@Deprecated
public interface HabitService {

    /**
     * Get download manifest for a habit linked to an RFID card
     * @param rfidUid RFID card UID
     * @param currentVersion Current version on device (for cache check)
     * @param currentHash Current hash on device (for cache check)
     * @return Download manifest DTO, or null if not found
     * @deprecated Use RfidContentPackService.getContentDownloadManifest instead
     */
    @Deprecated
    HabitDownloadDTO getDownloadManifest(String rfidUid, String currentVersion, String currentHash);
}
