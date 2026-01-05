package cheeko.modules.rfid.service.impl;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import lombok.AllArgsConstructor;
import cheeko.common.service.impl.CrudServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.rfid.dao.RfidPackDao;
import cheeko.modules.rfid.dto.RfidPackDTO;
import cheeko.modules.rfid.entity.RfidPackEntity;
import cheeko.modules.rfid.service.RfidPackService;

/**
 * RFID Pack Service Implementation
 */
@AllArgsConstructor
@Service
public class RfidPackServiceImpl extends CrudServiceImpl<RfidPackDao, RfidPackEntity, RfidPackDTO>
        implements RfidPackService {

    private final RfidPackDao rfidPackDao;

    @Override
    public QueryWrapper<RfidPackEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<RfidPackEntity> wrapper = new QueryWrapper<>();

        String packCode = (String) params.get("packCode");
        if (StringUtils.isNotBlank(packCode)) {
            wrapper.like("pack_code", packCode);
        }

        String name = (String) params.get("name");
        if (StringUtils.isNotBlank(name)) {
            wrapper.like("name", name);
        }

        String active = (String) params.get("active");
        if (StringUtils.isNotBlank(active)) {
            wrapper.eq("active", "true".equalsIgnoreCase(active) || "1".equals(active));
        }

        wrapper.orderByAsc("name");

        return wrapper;
    }

    @Override
    public RfidPackDTO getByPackCode(String packCode) {
        RfidPackEntity entity = rfidPackDao.getByPackCode(packCode);
        return ConvertUtils.sourceToTarget(entity, RfidPackDTO.class);
    }

    @Override
    public List<RfidPackDTO> getAllActive() {
        List<RfidPackEntity> entities = rfidPackDao.getAllActive();
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidPackDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidPackDTO> getByAge(Integer age) {
        List<RfidPackEntity> entities = rfidPackDao.getByAge(age);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidPackDTO.class))
                .collect(Collectors.toList());
    }
}
