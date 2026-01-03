package cheeko.modules.sys.service;

import java.util.List;

import cheeko.common.service.CrudService;
import cheeko.modules.sys.dto.KidProfileDTO;
import cheeko.modules.sys.dto.KidProfileCreateDTO;
import cheeko.modules.sys.dto.KidProfileUpdateDTO;
import cheeko.modules.sys.entity.KidProfileEntity;

/**
 * Kid Profile Service
 */
public interface KidProfileService extends CrudService<KidProfileEntity, KidProfileDTO> {

    /**
     * Get all kids by user ID (parent)
     * @param userId User ID
     * @return List of kid profiles
     */
    List<KidProfileDTO> getByUserId(Long userId);

    /**
     * Get kid by ID (with user ID security check)
     * @param id Kid ID
     * @param userId User ID
     * @return Kid profile
     */
    KidProfileDTO getByIdAndUserId(Long id, Long userId);

    /**
     * Create kid profile
     * @param dto Create DTO
     * @param userId User ID (parent)
     * @return Created kid profile
     */
    KidProfileDTO createKid(KidProfileCreateDTO dto, Long userId);

    /**
     * Update kid profile
     * @param id Kid ID
     * @param dto Update DTO
     * @param userId User ID (for security check)
     * @return Updated kid profile
     */
    KidProfileDTO updateKid(Long id, KidProfileUpdateDTO dto, Long userId);

    /**
     * Delete kid profile
     * @param id Kid ID
     * @param userId User ID (for security check)
     * @return Success status
     */
    boolean deleteKid(Long id, Long userId);
}
