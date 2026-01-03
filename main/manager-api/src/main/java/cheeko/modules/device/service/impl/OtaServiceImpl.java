package cheeko.modules.device.service.impl;

import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;

import io.micrometer.common.util.StringUtils;
import cheeko.common.page.PageData;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.modules.device.dao.OtaDao;
import cheeko.modules.device.entity.OtaEntity;
import cheeko.modules.device.service.OtaService;

@Service
public class OtaServiceImpl extends BaseServiceImpl<OtaDao, OtaEntity> implements OtaService {

    @Override
    public PageData<OtaEntity> page(Map<String, Object> params) {
        IPage<OtaEntity> page = baseDao.selectPage(
                getPage(params, "update_date", true),
                getWrapper(params));

        return new PageData<>(page.getRecords(), page.getTotal());
    }

    private QueryWrapper<OtaEntity> getWrapper(Map<String, Object> params) {
        String firmwareName = (String) params.get("firmwareName");

        QueryWrapper<OtaEntity> wrapper = new QueryWrapper<>();
        wrapper.like(StringUtils.isNotBlank(firmwareName), "firmware_name", firmwareName);

        return wrapper;
    }

    @Override
    public void update(OtaEntity entity) {
        // CheckWhetherExist相SameType和Versions Firmware（排ExceptCurrentRecord）
        QueryWrapper<OtaEntity> queryWrapper = new QueryWrapper<OtaEntity>()
                .eq("type", entity.getType())
                .eq("version", entity.getVersion())
                .ne("id", entity.getId()); // 排ExceptCurrentRecord

        if (baseDao.selectCount(queryWrapper) > 0) {
            throw new RuntimeException("HaveExist相SameType和Versions Firmware，请Update后Retry");
        }

        entity.setUpdateDate(new Date());
        baseDao.updateById(entity);
    }

    @Override
    public void delete(String[] ids) {
        baseDao.deleteBatchIds(Arrays.asList(ids));
    }

    @Override
    public boolean save(OtaEntity entity) {
        QueryWrapper<OtaEntity> queryWrapper = new QueryWrapper<OtaEntity>()
                .eq("type", entity.getType());
        // SameClassFirmwareOnly保留Latests 一条
        List<OtaEntity> otaList = baseDao.selectList(queryWrapper);
        if (otaList != null && otaList.size() > 0) {
            OtaEntity otaBefore = otaList.get(0);
            entity.setId(otaBefore.getId());
            baseDao.updateById(entity);
            return true;
        }
        return baseDao.insert(entity) > 0;
    }

    @Override
    public OtaEntity getLatestOta(String type) {
        QueryWrapper<OtaEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("type", type)
                .orderByDesc("update_date")
                .last("LIMIT 1");
        return baseDao.selectOne(wrapper);
    }

    @Override
    public OtaEntity getForceUpdateFirmware(String type) {
        QueryWrapper<OtaEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("type", type)
                .eq("force_update", 1)
                .last("LIMIT 1");
        return baseDao.selectOne(wrapper);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void setForceUpdate(String id, String type, Integer forceUpdate) {
        if (forceUpdate == null || (forceUpdate != 0 && forceUpdate != 1)) {
            throw new RuntimeException("force_update值必须As0Or1");
        }

        // If enabling force update, first disable it for all other firmwares of the same type
        if (forceUpdate == 1) {
            QueryWrapper<OtaEntity> wrapper = new QueryWrapper<>();
            wrapper.eq("type", type)
                    .eq("force_update", 1)
                    .ne("id", id);

            List<OtaEntity> existingForceUpdates = baseDao.selectList(wrapper);
            if (!existingForceUpdates.isEmpty()) {
                // Disable force update for other firmwares
                for (OtaEntity otaEntity : existingForceUpdates) {
                    otaEntity.setForceUpdate(0);
                    baseDao.updateById(otaEntity);
                }
            }
        }

        // Update the target firmware
        OtaEntity entity = baseDao.selectById(id);
        if (entity == null) {
            throw new RuntimeException("Firmware不Exist");
        }
        if (!entity.getType().equals(type)) {
            throw new RuntimeException("FirmwareTypeNot Match");
        }
        entity.setForceUpdate(forceUpdate);
        entity.setUpdateDate(new Date());
        baseDao.updateById(entity);
    }
}