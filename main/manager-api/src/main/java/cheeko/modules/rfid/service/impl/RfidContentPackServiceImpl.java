package cheeko.modules.rfid.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.service.impl.CrudServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.rfid.dao.ContentItemDao;
import cheeko.modules.rfid.dao.RfidCardMappingDao;
import cheeko.modules.rfid.dao.RfidContentPackDao;
import cheeko.modules.rfid.dao.RfidSeriesDao;
import cheeko.modules.rfid.dto.ContentDownloadDTO;
import cheeko.modules.rfid.dto.ContentItemDTO;
import cheeko.modules.rfid.dto.RfidContentLookupDTO;
import cheeko.modules.rfid.dto.RfidContentPackDTO;
import cheeko.modules.rfid.dto.RhymeDownloadDTO;
import cheeko.modules.rfid.dto.RhymeItemDTO;
import cheeko.modules.rfid.entity.ContentItemEntity;
import cheeko.modules.rfid.entity.RfidCardMappingEntity;
import cheeko.modules.rfid.entity.RfidContentPackEntity;
import cheeko.modules.rfid.entity.RfidQuestionEntity;
import cheeko.modules.rfid.service.RfidContentPackService;
import cheeko.modules.rfid.util.MdParserUtil;

/**
 * RFID Content Pack Service Implementation
 * Unified service for all content types (habits, rhymes, stories, etc.)
 */
@Slf4j
@AllArgsConstructor
@Service
public class RfidContentPackServiceImpl extends CrudServiceImpl<RfidContentPackDao, RfidContentPackEntity, RfidContentPackDTO>
        implements RfidContentPackService {

    private final RfidContentPackDao rfidContentPackDao;
    private final RfidCardMappingDao rfidCardMappingDao;
    private final RfidSeriesDao rfidSeriesDao;
    private final ContentItemDao contentItemDao;
    private final ObjectMapper objectMapper = new ObjectMapper();

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

                // Check for cached audio URL
                String cachedAudioUrl = getCachedAudioUrl(contentPack.getCachedAudioUrls(), sequence);
                if (cachedAudioUrl != null) {
                    result.setCachedAudioUrl(cachedAudioUrl);
                    result.setCached(true);
                    log.info("Found cached audio for sequence {}: {}", sequence, cachedAudioUrl);
                } else {
                    result.setCached(false);
                    log.info("No cached audio for sequence {}", sequence);
                }
            } else {
                log.warn("No sequence provided, returning pack info only");
                result.setCached(false);
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

    @Override
    @Transactional
    public boolean updateCachedAudioUrl(String packCode, Integer sequence, String audioUrl) {
        log.info("Updating cached audio URL for pack {}, sequence {}: {}", packCode, sequence, audioUrl);

        try {
            // Get pack by packCode
            RfidContentPackEntity contentPack = rfidContentPackDao.getByPackCode(packCode);
            if (contentPack == null) {
                log.error("Content pack not found: {}", packCode);
                return false;
            }

            // Parse existing cachedAudioUrls JSON (or create new)
            Map<String, String> cachedUrls = new HashMap<>();
            if (StringUtils.isNotBlank(contentPack.getCachedAudioUrls())) {
                try {
                    cachedUrls = objectMapper.readValue(
                            contentPack.getCachedAudioUrls(),
                            new TypeReference<Map<String, String>>() {}
                    );
                } catch (Exception e) {
                    log.warn("Failed to parse existing cached URLs, starting fresh: {}", e.getMessage());
                }
            }

            // Add/update entry for sequence
            cachedUrls.put(String.valueOf(sequence), audioUrl);

            // Save back to DB
            String updatedJson = objectMapper.writeValueAsString(cachedUrls);
            contentPack.setCachedAudioUrls(updatedJson);
            rfidContentPackDao.updateById(contentPack);

            log.info("Successfully updated cached audio URL for pack {}, sequence {}", packCode, sequence);
            return true;

        } catch (Exception e) {
            log.error("Failed to update cached audio URL: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Extract cached audio URL for a specific sequence from JSON
     */
    private String getCachedAudioUrl(String cachedAudioUrlsJson, Integer sequence) {
        if (StringUtils.isBlank(cachedAudioUrlsJson) || sequence == null) {
            return null;
        }

        try {
            Map<String, String> cachedUrls = objectMapper.readValue(
                    cachedAudioUrlsJson,
                    new TypeReference<Map<String, String>>() {}
            );
            return cachedUrls.get(String.valueOf(sequence));
        } catch (Exception e) {
            log.warn("Failed to parse cached audio URLs: {}", e.getMessage());
            return null;
        }
    }

    @Override
    @Deprecated
    public RhymeDownloadDTO getDownloadManifest(String rfidUid) {
        // Delegate to unified method and convert
        ContentDownloadDTO unified = getContentDownloadManifest(rfidUid);
        if (unified == null) {
            return null;
        }

        // Convert to legacy RhymeDownloadDTO for backward compatibility
        RhymeDownloadDTO dto = new RhymeDownloadDTO();
        dto.setRfidUid(unified.getRfidUid());
        dto.setContentType(unified.getContentType());
        dto.setPackCode(unified.getPackCode());
        dto.setPackName(unified.getPackName());
        dto.setVersion(unified.getVersion());
        dto.setContentHash(unified.getContentHash());
        dto.setTotalItems(unified.getTotalItems());
        dto.setLanguage(unified.getLanguage());

        // Convert items
        List<RhymeItemDTO> itemDtos = new ArrayList<>();
        if (unified.getItems() != null) {
            for (ContentItemDTO item : unified.getItems()) {
                RhymeItemDTO itemDto = new RhymeItemDTO();
                itemDto.setItemNumber(item.getItemNumber());
                itemDto.setTitle(item.getTitle());
                itemDto.setLyricsText(item.getLyricsText());
                if (item.getAudio() != null) {
                    RhymeItemDTO.AudioInfo audio = new RhymeItemDTO.AudioInfo();
                    audio.setUrl(item.getAudio().getUrl());
                    audio.setSizeBytes(item.getAudio().getSizeBytes());
                    audio.setDurationMs(item.getAudio().getDurationMs());
                    itemDto.setAudio(audio);
                }
                itemDtos.add(itemDto);
            }
        }
        dto.setItems(itemDtos);

        return dto;
    }

    @Override
    public ContentDownloadDTO getContentDownloadManifest(String rfidUid) {
        if (rfidUid == null || rfidUid.trim().isEmpty()) {
            log.warn("getContentDownloadManifest called with empty rfidUid");
            return null;
        }

        // Look up the RFID card mapping
        RfidCardMappingEntity mapping = rfidCardMappingDao.getByRfidUid(rfidUid.trim());
        if (mapping == null) {
            log.info("No RFID mapping found for UID: {}", rfidUid);
            return null;
        }

        // Check if this card is linked to a content pack
        Long contentPackId = mapping.getContentPackId();
        if (contentPackId == null) {
            log.info("RFID card {} is not linked to a content pack", rfidUid);
            return null;
        }

        return getContentDownloadManifestByPackId(contentPackId, rfidUid);
    }

    @Override
    public ContentDownloadDTO getContentDownloadManifestByPackId(Long contentPackId, String rfidUid) {
        // Get the content pack
        RfidContentPackEntity contentPack = rfidContentPackDao.selectById(contentPackId);
        if (contentPack == null || !Boolean.TRUE.equals(contentPack.getActive())) {
            log.info("Content pack not found or inactive: {}", contentPackId);
            return null;
        }

        // Get all items for this content pack (unified table)
        List<ContentItemEntity> items = contentItemDao.getByContentPackId(contentPackId);

        // Convert items to DTOs
        List<ContentItemDTO> itemDtos = new ArrayList<>();
        for (ContentItemEntity item : items) {
            ContentItemDTO itemDto = convertContentItemToDto(item);
            itemDtos.add(itemDto);
        }

        // Build the response
        ContentDownloadDTO dto = new ContentDownloadDTO();
        dto.setRfidUid(rfidUid);
        dto.setContentType(contentPack.getContentType());
        dto.setPackCode(contentPack.getPackCode());
        dto.setPackName(contentPack.getName());
        dto.setDescription(contentPack.getDescription());
        dto.setVersion(contentPack.getVersion() != null ? contentPack.getVersion() : "1.0.0");
        dto.setContentHash(contentPack.getContentHash());
        dto.setTotalItems(contentPack.getTotalItems() != null ? contentPack.getTotalItems() : items.size());
        dto.setLanguage(contentPack.getLanguage());
        dto.setItems(itemDtos);

        log.info("Returning {} download manifest for RFID {} with {} items",
                contentPack.getContentType(), rfidUid, itemDtos.size());
        return dto;
    }

    /**
     * Convert a content item entity to unified DTO
     */
    private ContentItemDTO convertContentItemToDto(ContentItemEntity item) {
        ContentItemDTO dto = new ContentItemDTO();
        dto.setItemNumber(item.getItemNumber());
        dto.setTitle(item.getTitle());
        dto.setDescription(item.getDescription());
        dto.setLyricsText(item.getLyricsText());

        // Audio info
        if (item.getAudioUrl() != null) {
            ContentItemDTO.AudioInfo audio = new ContentItemDTO.AudioInfo();
            audio.setUrl(item.getAudioUrl());
            audio.setSizeBytes(item.getAudioSizeBytes());
            audio.setDurationMs(item.getAudioDurationMs());
            dto.setAudio(audio);
        }

        // Parse images JSON (for habits)
        if (item.getImagesJson() != null && !item.getImagesJson().isEmpty()) {
            try {
                List<ContentItemDTO.ImageInfo> images = objectMapper.readValue(
                    item.getImagesJson(),
                    new TypeReference<List<ContentItemDTO.ImageInfo>>() {}
                );
                dto.setImages(images);
            } catch (Exception e) {
                log.error("Failed to parse images JSON for item {}: {}", item.getId(), e.getMessage());
                dto.setImages(new ArrayList<>());
            }
        }

        return dto;
    }
}
