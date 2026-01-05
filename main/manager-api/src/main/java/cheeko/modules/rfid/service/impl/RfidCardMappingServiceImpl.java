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
import cheeko.modules.rfid.dao.RfidCardMappingDao;
import cheeko.modules.rfid.dao.RfidSeriesDao;
import cheeko.modules.rfid.dto.RfidCardMappingDTO;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.entity.RfidCardMappingEntity;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.service.RfidCardMappingService;

/**
 * RFID Card Mapping Service Implementation
 */
@AllArgsConstructor
@Service
public class RfidCardMappingServiceImpl extends CrudServiceImpl<RfidCardMappingDao, RfidCardMappingEntity, RfidCardMappingDTO>
        implements RfidCardMappingService {

    private final RfidCardMappingDao rfidCardMappingDao;
    private final RfidSeriesDao rfidSeriesDao;

    @Override
    public QueryWrapper<RfidCardMappingEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<RfidCardMappingEntity> wrapper = new QueryWrapper<>();

        String rfidUid = (String) params.get("rfidUid");
        if (StringUtils.isNotBlank(rfidUid)) {
            wrapper.like("rfid_uid", rfidUid);
        }

        String packCode = (String) params.get("packCode");
        if (StringUtils.isNotBlank(packCode)) {
            wrapper.eq("pack_code", packCode);
        }

        String questionId = (String) params.get("questionId");
        if (StringUtils.isNotBlank(questionId)) {
            wrapper.eq("question_id", Long.parseLong(questionId));
        }

        String active = (String) params.get("active");
        if (StringUtils.isNotBlank(active)) {
            wrapper.eq("active", "true".equalsIgnoreCase(active) || "1".equals(active));
        }

        wrapper.orderByAsc("pack_code", "rfid_uid");

        return wrapper;
    }

    @Override
    public RfidCardMappingDTO getByRfidUid(String rfidUid) {
        RfidCardMappingEntity entity = rfidCardMappingDao.getByRfidUid(rfidUid);
        return ConvertUtils.sourceToTarget(entity, RfidCardMappingDTO.class);
    }

    @Override
    public RfidQuestionDTO getQuestionByRfidUid(String rfidUid) {
        // Step 1: Try exact match in rfid_card_mapping
        RfidQuestionEntity entity = rfidCardMappingDao.getQuestionByRfidUid(rfidUid);

        // Step 2: If not found, try series range match
        if (entity == null) {
            // Normalize UID for range comparison
            String normalizedUid = rfidUid.toUpperCase().replaceAll("[^0-9A-F]", "");
            entity = rfidSeriesDao.getQuestionByUidRange(normalizedUid);
        }

        return ConvertUtils.sourceToTarget(entity, RfidQuestionDTO.class);
    }

    @Override
    public List<RfidCardMappingDTO> getByPackCode(String packCode) {
        List<RfidCardMappingEntity> entities = rfidCardMappingDao.getByPackCode(packCode);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidCardMappingDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidCardMappingDTO> getByQuestionId(Long questionId) {
        List<RfidCardMappingEntity> entities = rfidCardMappingDao.getByQuestionId(questionId);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidCardMappingDTO.class))
                .collect(Collectors.toList());
    }
}
