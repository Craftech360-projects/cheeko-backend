package xiaozhi.modules.device.service;

import java.util.List;

import xiaozhi.common.service.BaseService;
import xiaozhi.modules.device.dto.AccessoryBindDTO;
import xiaozhi.modules.device.entity.ToyAccessoryEntity;

public interface ToyAccessoryService extends BaseService<ToyAccessoryEntity> {

    /**
     * Bind accessory to toy (QR code scan)
     *
     * @param userId User ID (owner)
     * @param toyMac Parent toy MAC address
     * @param dto    Accessory binding data
     * @return Created accessory entity
     */
    ToyAccessoryEntity bindAccessory(Long userId, String toyMac, AccessoryBindDTO dto);

    /**
     * Get accessory by toy MAC and type
     *
     * @param toyMac        Parent toy MAC address
     * @param accessoryType Accessory type (car, lamp, etc.)
     * @return Accessory entity or null
     */
    ToyAccessoryEntity getAccessoryByToyMacAndType(String toyMac, String accessoryType);

    /**
     * Get all accessories for a toy
     *
     * @param toyMac Parent toy MAC address
     * @return List of accessories
     */
    List<ToyAccessoryEntity> getAccessoriesByToyMac(String toyMac);

    /**
     * Unbind accessory
     *
     * @param userId       User ID (for ownership verification)
     * @param accessoryMac Accessory MAC address
     */
    void unbindAccessory(Long userId, String accessoryMac);

    /**
     * Check if accessory MAC is already bound
     *
     * @param accessoryMac Accessory MAC address
     * @return true if already bound
     */
    boolean isAccessoryBound(String accessoryMac);
}
