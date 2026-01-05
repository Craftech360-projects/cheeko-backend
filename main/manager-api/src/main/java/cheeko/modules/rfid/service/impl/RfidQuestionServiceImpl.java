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
import cheeko.modules.rfid.dao.RfidQuestionDao;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.service.RfidQuestionService;

/**
 * RFID Question Service Implementation
 */
@AllArgsConstructor
@Service
public class RfidQuestionServiceImpl extends CrudServiceImpl<RfidQuestionDao, RfidQuestionEntity, RfidQuestionDTO>
        implements RfidQuestionService {

    private final RfidQuestionDao rfidQuestionDao;

    @Override
    public QueryWrapper<RfidQuestionEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<RfidQuestionEntity> wrapper = new QueryWrapper<>();

        String code = (String) params.get("code");
        if (StringUtils.isNotBlank(code)) {
            wrapper.like("code", code);
        }

        String category = (String) params.get("category");
        if (StringUtils.isNotBlank(category)) {
            wrapper.eq("category", category);
        }

        String language = (String) params.get("language");
        if (StringUtils.isNotBlank(language)) {
            wrapper.eq("language", language);
        }

        String active = (String) params.get("active");
        if (StringUtils.isNotBlank(active)) {
            wrapper.eq("active", "true".equalsIgnoreCase(active) || "1".equals(active));
        }

        wrapper.orderByAsc("category", "difficulty", "code");

        return wrapper;
    }

    @Override
    public RfidQuestionDTO getByCode(String code) {
        RfidQuestionEntity entity = rfidQuestionDao.getByCode(code);
        return ConvertUtils.sourceToTarget(entity, RfidQuestionDTO.class);
    }

    @Override
    public List<RfidQuestionDTO> getActiveByCategory(String category) {
        List<RfidQuestionEntity> entities = rfidQuestionDao.getActiveByCategory(category);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidQuestionDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidQuestionDTO> getActiveByLanguage(String language) {
        List<RfidQuestionEntity> entities = rfidQuestionDao.getActiveByLanguage(language);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidQuestionDTO.class))
                .collect(Collectors.toList());
    }
}
