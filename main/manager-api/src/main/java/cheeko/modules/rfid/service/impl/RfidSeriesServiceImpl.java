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
import cheeko.modules.rfid.dao.RfidSeriesDao;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.dto.RfidSeriesDTO;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.entity.RfidSeriesEntity;
import cheeko.modules.rfid.service.RfidSeriesService;

/**
 * RFID Series Service Implementation
 */
@AllArgsConstructor
@Service
public class RfidSeriesServiceImpl extends CrudServiceImpl<RfidSeriesDao, RfidSeriesEntity, RfidSeriesDTO>
        implements RfidSeriesService {

    private final RfidSeriesDao rfidSeriesDao;

    @Override
    public QueryWrapper<RfidSeriesEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<RfidSeriesEntity> wrapper = new QueryWrapper<>();

        String packId = (String) params.get("packId");
        if (StringUtils.isNotBlank(packId)) {
            wrapper.eq("pack_id", Long.parseLong(packId));
        }

        String questionId = (String) params.get("questionId");
        if (StringUtils.isNotBlank(questionId)) {
            wrapper.eq("question_id", Long.parseLong(questionId));
        }

        String active = (String) params.get("active");
        if (StringUtils.isNotBlank(active)) {
            wrapper.eq("active", "true".equalsIgnoreCase(active) || "1".equals(active));
        }

        wrapper.orderByDesc("priority").orderByAsc("start_uid");

        return wrapper;
    }

    @Override
    public List<RfidSeriesDTO> findSeriesContainingUid(String uid) {
        // Normalize UID to uppercase for consistent comparison
        String normalizedUid = uid.toUpperCase().replaceAll("[^0-9A-F]", "");
        List<RfidSeriesEntity> entities = rfidSeriesDao.findSeriesContainingUid(normalizedUid);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidSeriesDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public RfidQuestionDTO getQuestionByUidRange(String uid) {
        // Normalize UID to uppercase for consistent comparison
        String normalizedUid = uid.toUpperCase().replaceAll("[^0-9A-F]", "");
        RfidQuestionEntity entity = rfidSeriesDao.getQuestionByUidRange(normalizedUid);
        return ConvertUtils.sourceToTarget(entity, RfidQuestionDTO.class);
    }

    @Override
    public List<RfidSeriesDTO> getByPackId(Long packId) {
        List<RfidSeriesEntity> entities = rfidSeriesDao.getByPackId(packId);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidSeriesDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidSeriesDTO> getByQuestionId(Long questionId) {
        List<RfidSeriesEntity> entities = rfidSeriesDao.getByQuestionId(questionId);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidSeriesDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidSeriesDTO> getAllActive() {
        List<RfidSeriesEntity> entities = rfidSeriesDao.getAllActive();
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidSeriesDTO.class))
                .collect(Collectors.toList());
    }
}
