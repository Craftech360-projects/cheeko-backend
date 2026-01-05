package cheeko.modules.rfid.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.rfid.dto.RfidPackDTO;
import cheeko.modules.rfid.entity.RfidPackEntity;

/**
 * RFID Pack Service
 */
public interface RfidPackService extends CrudService<RfidPackEntity, RfidPackDTO> {

    /**
     * Get pack by pack code
     * @param packCode Pack code
     * @return Pack DTO
     */
    RfidPackDTO getByPackCode(String packCode);

    /**
     * Get all active packs
     * @return List of active packs
     */
    List<RfidPackDTO> getAllActive();

    /**
     * Get packs suitable for a given age
     * @param age Child's age
     * @return List of suitable packs
     */
    List<RfidPackDTO> getByAge(Integer age);
}
