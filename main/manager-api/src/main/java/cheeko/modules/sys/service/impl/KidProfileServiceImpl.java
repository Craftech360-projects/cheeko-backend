package cheeko.modules.sys.service.impl;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import lombok.AllArgsConstructor;
import cheeko.common.exception.RenException;
import cheeko.common.service.impl.CrudServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.sys.dao.KidProfileDao;
import cheeko.modules.sys.dto.KidProfileDTO;
import cheeko.modules.sys.dto.KidProfileCreateDTO;
import cheeko.modules.sys.dto.KidProfileUpdateDTO;
import cheeko.modules.sys.entity.KidProfileEntity;
import cheeko.modules.sys.service.KidProfileService;

/**
 * Kid Profile Service Implementation
 */
@AllArgsConstructor
@Service
public class KidProfileServiceImpl extends CrudServiceImpl<KidProfileDao, KidProfileEntity, KidProfileDTO>
        implements KidProfileService {

    private final KidProfileDao kidProfileDao;

    @Override
    public QueryWrapper<KidProfileEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<KidProfileEntity> wrapper = new QueryWrapper<>();
        return wrapper;
    }

    @Override
    public List<KidProfileDTO> getByUserId(Long userId) {
        List<KidProfileEntity> entities = kidProfileDao.getByUserId(userId);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, KidProfileDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public KidProfileDTO getByIdAndUserId(Long id, Long userId) {
        KidProfileEntity entity = kidProfileDao.getByIdAndUserId(id, userId);
        return ConvertUtils.sourceToTarget(entity, KidProfileDTO.class);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public KidProfileDTO createKid(KidProfileCreateDTO dto, Long userId) {
        // Convert DTO to Entity
        KidProfileEntity entity = ConvertUtils.sourceToTarget(dto, KidProfileEntity.class);
        entity.setUserId(userId);
        entity.setCreator(userId);
        entity.setCreateDate(new Date());
        entity.setUpdater(userId);
        entity.setUpdateDate(new Date());

        // Save entity
        kidProfileDao.insert(entity);

        return ConvertUtils.sourceToTarget(entity, KidProfileDTO.class);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public KidProfileDTO updateKid(Long id, KidProfileUpdateDTO dto, Long userId) {
        // Get existing kid profile (with security check)
        KidProfileEntity entity = kidProfileDao.getByIdAndUserId(id, userId);
        if (entity == null) {
            throw new RenException("Kid profile not found or access denied");
        }

        // Update fields if provided
        if (dto.getName() != null) {
            entity.setName(dto.getName());
        }
        if (dto.getDateOfBirth() != null) {
            entity.setDateOfBirth(dto.getDateOfBirth());
        }
        if (dto.getGender() != null) {
            entity.setGender(dto.getGender());
        }
        if (dto.getInterests() != null) {
            entity.setInterests(dto.getInterests());
        }
        if (dto.getAvatarUrl() != null) {
            entity.setAvatarUrl(dto.getAvatarUrl());
        }

        entity.setUpdater(userId);
        entity.setUpdateDate(new Date());

        // Update entity
        this.updateById(entity);

        return ConvertUtils.sourceToTarget(entity, KidProfileDTO.class);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteKid(Long id, Long userId) {
        // Verify ownership before deletion
        KidProfileEntity entity = kidProfileDao.getByIdAndUserId(id, userId);
        if (entity == null) {
            throw new RenException("Kid profile not found or access denied");
        }

        // Delete the kid profile
        int deleted = kidProfileDao.deleteById(id);
        return deleted > 0;
    }
}
