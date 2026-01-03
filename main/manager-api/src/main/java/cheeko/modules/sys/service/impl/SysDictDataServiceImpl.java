package cheeko.modules.sys.service.impl;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;

import lombok.AllArgsConstructor;
import cheeko.common.exception.RenException;
import cheeko.common.page.PageData;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.sys.dao.SysDictDataDao;
import cheeko.modules.sys.dao.SysUserDao;
import cheeko.modules.sys.dto.SysDictDataDTO;
import cheeko.modules.sys.entity.SysDictDataEntity;
import cheeko.modules.sys.entity.SysUserEntity;
import cheeko.modules.sys.service.SysDictDataService;
import cheeko.modules.sys.vo.SysDictDataItem;
import cheeko.modules.sys.vo.SysDictDataVO;

/**
 * Dictionary Data
 */
@Service
@AllArgsConstructor
public class SysDictDataServiceImpl extends BaseServiceImpl<SysDictDataDao, SysDictDataEntity>
        implements SysDictDataService {
    private final SysUserDao sysUserDao;
    private final RedisUtils redisUtils;

    @Override
    public PageData<SysDictDataVO> page(Map<String, Object> params) {
        IPage<SysDictDataEntity> page = baseDao.selectPage(getPage(params, "sort", true), getWrapper(params));

        PageData<SysDictDataVO> pageData = getPageData(page, SysDictDataVO.class);

        setUserName(pageData.getList());

        return pageData;
    }

    private QueryWrapper<SysDictDataEntity> getWrapper(Map<String, Object> params) {
        String dictTypeId = (String) params.get("dictTypeId");
        String dictLabel = (String) params.get("dictLabel");
        String dictValue = (String) params.get("dictValue");

        QueryWrapper<SysDictDataEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("dict_type_id", Long.parseLong(dictTypeId));
        wrapper.like(StringUtils.isNotBlank(dictLabel), "dict_label", dictLabel);
        wrapper.like(StringUtils.isNotBlank(dictValue), "dict_value", dictValue);

        return wrapper;
    }

    @Override
    public SysDictDataVO get(Long id) {
        SysDictDataEntity entity = baseDao.selectById(id);

        return ConvertUtils.sourceToTarget(entity, SysDictDataVO.class);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void save(SysDictDataDTO dto) {
        // Same dictionary type labels cannot be the same
        checkDictValueUnique(dto.getDictTypeId(), dto.getDictValue(), null);

        SysDictDataEntity entity = ConvertUtils.sourceToTarget(dto, SysDictDataEntity.class);

        insert(entity);
        // Delete Redis cache
        String dictType = baseDao.getTypeByTypeId(dto.getDictTypeId());
        redisUtils.delete(RedisKeys.getDictDataByTypeKey(dictType));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void update(SysDictDataDTO dto) {
        // Same dictionary type labels cannot be the same
        checkDictValueUnique(dto.getDictTypeId(), dto.getDictValue(), String.valueOf(dto.getId()));

        SysDictDataEntity entity = ConvertUtils.sourceToTarget(dto, SysDictDataEntity.class);

        updateById(entity);
        // Delete Redis cache
        String dictType = baseDao.getTypeByTypeId(dto.getDictTypeId());
        redisUtils.delete(RedisKeys.getDictDataByTypeKey(dictType));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete(Long[] ids) {
        for (Long id : ids) {
            SysDictDataEntity entity = baseDao.selectById(id);
            // Delete Redis cache
            String dictType = baseDao.getTypeByTypeId(entity.getDictTypeId());
            redisUtils.delete(RedisKeys.getDictDataByTypeKey(dictType));
            // Delete
            deleteById(id);
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteByTypeId(Long dictTypeId) {
        LambdaQueryWrapper<SysDictDataEntity> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SysDictDataEntity::getDictTypeId, dictTypeId);
        baseDao.delete(wrapper);
    }

    /**
     * Set username
     *
     * @param sysDictDataList Dictionary type collection
     */
    private void setUserName(List<SysDictDataVO> sysDictDataList) {
        // Collect all user IDs
        Set<Long> userIds = sysDictDataList.stream().flatMap(vo -> Stream.of(vo.getCreator(), vo.getUpdater()))
                .filter(Objects::nonNull).collect(Collectors.toSet());

        // Set updater and creator names
        if (!userIds.isEmpty()) {
            List<SysUserEntity> sysUserEntities = sysUserDao.selectBatchIds(userIds);
            // Convert List to Map<Long, String>
            Map<Long, String> userNameMap = sysUserEntities.stream().collect(Collectors.toMap(SysUserEntity::getId,
                    SysUserEntity::getUsername, (existing, replacement) -> existing));

            sysDictDataList.forEach(vo -> {
                vo.setCreatorName(userNameMap.get(vo.getCreator()));
                vo.setUpdaterName(userNameMap.get(vo.getUpdater()));
            });
        }
    }

    private void checkDictValueUnique(Long dictTypeId, String dictValue, String excludeId) {
        LambdaQueryWrapper<SysDictDataEntity> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SysDictDataEntity::getDictTypeId, dictTypeId).eq(SysDictDataEntity::getDictLabel, dictValue);
        if (StringUtils.isNotBlank(excludeId)) {
            queryWrapper.ne(SysDictDataEntity::getId, excludeId);
        }
        boolean exists = baseDao.exists(queryWrapper);
        if (exists) {
            throw new RenException("Dictionary label already exists");
        }
    }

    @Override
    public List<SysDictDataItem> getDictDataByType(String dictType) {
        if (StringUtils.isBlank(dictType)) {
            return null;
        }

        // First get cache from Redis
        String key = RedisKeys.getDictDataByTypeKey(dictType);
        List<SysDictDataItem> cachedData = (List<SysDictDataItem>) redisUtils.get(key);
        if (cachedData != null) {
            return cachedData;
        }

        // If not in cache, then get from database
        List<SysDictDataItem> data = baseDao.getDictDataByType(dictType);

        // Store in Redis cache
        if (data != null) {
            redisUtils.set(key, data);
        }

        return data;
    }
}