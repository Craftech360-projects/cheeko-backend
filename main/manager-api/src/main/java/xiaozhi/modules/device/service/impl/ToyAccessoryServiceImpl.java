package xiaozhi.modules.device.service.impl;

import java.util.Date;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.exception.RenException;
import xiaozhi.common.service.impl.BaseServiceImpl;
import xiaozhi.modules.device.dao.ToyAccessoryDao;
import xiaozhi.modules.device.dto.AccessoryBindDTO;
import xiaozhi.modules.device.entity.ToyAccessoryEntity;
import xiaozhi.modules.device.service.ToyAccessoryService;

@Slf4j
@Service
@AllArgsConstructor
public class ToyAccessoryServiceImpl extends BaseServiceImpl<ToyAccessoryDao, ToyAccessoryEntity>
        implements ToyAccessoryService {

    private final ToyAccessoryDao toyAccessoryDao;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public ToyAccessoryEntity bindAccessory(Long userId, String toyMac, AccessoryBindDTO dto) {
        log.info("Binding accessory: userId={}, toyMac={}, accessoryMac={}, type={}",
                userId, toyMac, dto.getAccessoryMac(), dto.getAccessoryType());

        // Normalize MAC addresses (remove colons, lowercase)
        String normalizedToyMac = normalizeMac(toyMac);
        String normalizedAccessoryMac = normalizeMac(dto.getAccessoryMac());

        // Check if accessory is already bound
        ToyAccessoryEntity existing = toyAccessoryDao.getByAccessoryMac(normalizedAccessoryMac);
        if (existing != null) {
            if (existing.getToyMac().equals(normalizedToyMac)) {
                log.info("Accessory already bound to this toy, returning existing");
                return existing;
            } else {
                throw new RenException("This accessory is already bound to another toy");
            }
        }

        // Check if toy already has this type of accessory
        ToyAccessoryEntity existingType = toyAccessoryDao.getByToyMacAndType(normalizedToyMac, dto.getAccessoryType());
        if (existingType != null) {
            log.info("Toy already has a {} accessory, replacing old one", dto.getAccessoryType());
            // Remove old binding
            toyAccessoryDao.deleteById(existingType.getId());
        }

        // Create new binding
        ToyAccessoryEntity accessory = new ToyAccessoryEntity();
        accessory.setUserId(userId);
        accessory.setToyMac(normalizedToyMac);
        accessory.setAccessoryMac(normalizedAccessoryMac);
        accessory.setAccessoryType(dto.getAccessoryType() != null ? dto.getAccessoryType() : "car");
        accessory.setCreatedAt(new Date());

        toyAccessoryDao.insert(accessory);

        log.info("Accessory bound successfully: id={}", accessory.getId());
        return accessory;
    }

    @Override
    public ToyAccessoryEntity getAccessoryByToyMacAndType(String toyMac, String accessoryType) {
        String normalizedMac = normalizeMac(toyMac);
        return toyAccessoryDao.getByToyMacAndType(normalizedMac, accessoryType);
    }

    @Override
    public List<ToyAccessoryEntity> getAccessoriesByToyMac(String toyMac) {
        String normalizedMac = normalizeMac(toyMac);
        return toyAccessoryDao.getByToyMac(normalizedMac);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void unbindAccessory(Long userId, String accessoryMac) {
        String normalizedMac = normalizeMac(accessoryMac);

        ToyAccessoryEntity accessory = toyAccessoryDao.getByAccessoryMac(normalizedMac);
        if (accessory == null) {
            throw new RenException("Accessory not found");
        }

        // Verify ownership
        if (!accessory.getUserId().equals(userId)) {
            throw new RenException("You don't own this accessory");
        }

        toyAccessoryDao.deleteById(accessory.getId());
        log.info("Accessory unbound: accessoryMac={}", normalizedMac);
    }

    @Override
    public boolean isAccessoryBound(String accessoryMac) {
        String normalizedMac = normalizeMac(accessoryMac);
        return toyAccessoryDao.getByAccessoryMac(normalizedMac) != null;
    }

    /**
     * Normalize MAC address: remove colons/dashes, lowercase
     */
    private String normalizeMac(String mac) {
        if (mac == null) {
            return null;
        }
        return mac.replace(":", "").replace("-", "").toLowerCase();
    }
}
