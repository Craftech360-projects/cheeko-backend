package cheeko.modules.rfid.service.impl;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.service.impl.CrudServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.rfid.dao.RfidCardMappingDao;
import cheeko.modules.rfid.dao.RfidContentPackDao;
import cheeko.modules.rfid.dao.RfidSeriesDao;
import cheeko.modules.rfid.dto.RfidContentLookupDTO;
import cheeko.modules.rfid.dto.RfidContentPackDTO;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.entity.RfidContentPackEntity;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.service.RfidContentPackService;
import cheeko.modules.rfid.util.MdParserUtil;

/**
 * RFID Content Pack Service Implementation
 */
@Slf4j
@AllArgsConstructor
@Service
public class RfidContentPackServiceImpl extends CrudServiceImpl<RfidContentPackDao, RfidContentPackEntity, RfidContentPackDTO>
        implements RfidContentPackService {

    private final RfidContentPackDao rfidContentPackDao;
    private final RfidCardMappingDao rfidCardMappingDao;
    private final RfidSeriesDao rfidSeriesDao;

    @Override
    public QueryWrapper<RfidContentPackEntity> getWrapper(Map<String, Object> params) {
        QueryWrapper<RfidContentPackEntity> wrapper = new QueryWrapper<>();

        String packCode = (String) params.get("packCode");
        if (StringUtils.isNotBlank(packCode)) {
            wrapper.like("pack_code", packCode);
        }

        String name = (String) params.get("name");
        if (StringUtils.isNotBlank(name)) {
            wrapper.like("name", name);
        }

        String contentType = (String) params.get("contentType");
        if (StringUtils.isNotBlank(contentType)) {
            wrapper.eq("content_type", contentType);
        }

        String language = (String) params.get("language");
        if (StringUtils.isNotBlank(language)) {
            wrapper.eq("language", language);
        }

        String active = (String) params.get("active");
        if (StringUtils.isNotBlank(active)) {
            wrapper.eq("active", "true".equalsIgnoreCase(active) || "1".equals(active));
        }

        wrapper.orderByAsc("name");

        return wrapper;
    }

    @Override
    public RfidContentPackDTO getByPackCode(String packCode) {
        RfidContentPackEntity entity = rfidContentPackDao.getByPackCode(packCode);
        return ConvertUtils.sourceToTarget(entity, RfidContentPackDTO.class);
    }

    @Override
    public List<RfidContentPackDTO> getAllActive() {
        List<RfidContentPackEntity> entities = rfidContentPackDao.getAllActive();
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidContentPackDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidContentPackDTO> getByContentType(String contentType) {
        List<RfidContentPackEntity> entities = rfidContentPackDao.getByContentType(contentType);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidContentPackDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public List<RfidContentPackDTO> getByLanguage(String language) {
        List<RfidContentPackEntity> entities = rfidContentPackDao.getByLanguage(language);
        return entities.stream()
                .map(entity -> ConvertUtils.sourceToTarget(entity, RfidContentPackDTO.class))
                .collect(Collectors.toList());
    }

    @Override
    public RfidContentLookupDTO lookupContentByRfidUid(String rfidUid, Integer sequence) {
        log.info("Looking up content for RFID UID: {}, sequence: {}", rfidUid, sequence);

        RfidContentLookupDTO result = new RfidContentLookupDTO();
        result.setRfidUid(rfidUid);
        result.setSequence(sequence);

        // Step 1: Try to find content pack via card mapping
        RfidContentPackEntity contentPack = rfidContentPackDao.getByRfidUid(rfidUid);

        if (contentPack != null && StringUtils.isNotBlank(contentPack.getContentMd())) {
            log.info("Found content pack {} for RFID UID {}", contentPack.getPackCode(), rfidUid);

            result.setContentType(contentPack.getContentType());
            result.setPackCode(contentPack.getPackCode());
            result.setLanguage(contentPack.getLanguage());

            // Parse markdown to extract content by sequence
            if (sequence != null && sequence > 0) {
                MdParserUtil.ContentItem item = MdParserUtil.extractBySequence(
                        contentPack.getContentMd(), sequence);

                if (item != null) {
                    result.setTitle(item.getTitle());
                    result.setContentText(item.getContent());
                    log.info("Extracted content for sequence {}: {}", sequence, item.getTitle());
                } else {
                    log.warn("Sequence {} not found in content pack {}", sequence, contentPack.getPackCode());
                    // Return pack info but no content if sequence not found
                }
            } else {
                log.warn("No sequence provided, returning pack info only");
            }

            return result;
        }

        // Step 2: Fallback to legacy rfid_question lookup (backward compatibility)
        log.info("No content pack found for UID {}, falling back to legacy question lookup", rfidUid);

        RfidQuestionEntity questionEntity = null;

        // Try to get question by sequence if sequence is provided and question_ids exists
        if (sequence != null && sequence > 0) {
            log.info("Attempting to get question by sequence {} for UID {}", sequence, rfidUid);
            questionEntity = rfidCardMappingDao.getQuestionByRfidUidAndSequence(rfidUid, sequence);
            
            if (questionEntity != null) {
                log.info("Found question by sequence {}: {}", sequence, questionEntity.getTitle());
            } else {
                log.warn("No question found for sequence {} for UID {}, falling back to single question", sequence, rfidUid);
            }
        }

        // Fallback to single question if sequence lookup failed or no sequence provided
        if (questionEntity == null) {
            questionEntity = rfidCardMappingDao.getQuestionByRfidUid(rfidUid);
        }

        // Try series range match if exact match fails
        if (questionEntity == null) {
            String normalizedUid = rfidUid.toUpperCase().replaceAll("[^0-9A-F]", "");
            questionEntity = rfidSeriesDao.getQuestionByUidRange(normalizedUid);
        }

        if (questionEntity != null) {
            result.setContentType("prompt"); // Legacy mode - send to LLM
            result.setTitle(questionEntity.getTitle());
            result.setPromptText(questionEntity.getPromptText());
            result.setLanguage(questionEntity.getLanguage());
            log.info("Found legacy question for UID {}: {}", rfidUid, questionEntity.getTitle());
        } else {
            log.warn("No content or question found for RFID UID {}", rfidUid);
        }

        return result;
    }
}
