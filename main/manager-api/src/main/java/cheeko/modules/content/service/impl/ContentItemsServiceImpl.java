package cheeko.modules.content.service.impl;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.page.PageData;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.content.dao.ContentItemsDao;
import cheeko.modules.content.dto.ContentItemsDTO;
import cheeko.modules.content.dto.ContentItemsSearchDTO;
import cheeko.modules.content.entity.ContentItemsEntity;
import cheeko.modules.content.service.ContentItemsService;

/**
 * Content Items Service Implementation
 */
@Service
@AllArgsConstructor
@Slf4j
public class ContentItemsServiceImpl implements ContentItemsService {

    private final ContentItemsDao contentItemsDao;

    @Override
    public String createContentItem(ContentItemsDTO dto) {
        ContentItemsEntity entity = convertToEntity(dto);
        entity.setId(UUID.randomUUID().toString());
        entity.setCreatedAt(new Date());
        entity.setUpdatedAt(new Date());

        int result = contentItemsDao.insert(entity);
        return result > 0 ? entity.getId() : null;
    }

    @Override
    public Integer batchCreateContentItems(List<ContentItemsDTO> dtos) {
        if (dtos == null || dtos.isEmpty()) {
            return 0;
        }

        List<ContentItemsEntity> entities = dtos.stream()
                .map(dto -> {
                    ContentItemsEntity entity = convertToEntity(dto);
                    entity.setId(UUID.randomUUID().toString());
                    entity.setCreatedAt(new Date());
                    entity.setUpdatedAt(new Date());
                    return entity;
                })
                .collect(Collectors.toList());

        return contentItemsDao.batchInsert(entities);
    }

    @Override
    public PageData<ContentItemsDTO> getContentItemsList(ContentItemsSearchDTO searchDTO) {
        Map<String, Object> params = new HashMap<>();
        params.put("contentType", searchDTO.getContentType());
        params.put("category", searchDTO.getCategory());
        params.put("search", searchDTO.getQuery());
        params.put("offset", (searchDTO.getPage() - 1) * searchDTO.getLimit());
        params.put("limit", searchDTO.getLimit());
        params.put("sortBy", searchDTO.getSortBy());
        params.put("sortDirection", searchDTO.getSortDirection());

        List<ContentItemsEntity> entities = contentItemsDao.getContentItemsList(params);
        int total = contentItemsDao.getContentItemsCount(params);

        List<ContentItemsDTO> dtoList = entities.stream()
                .map(this::convertToDTO)
                .collect(Collectors.toList());

        return new PageData<>(dtoList, total);
    }

    @Override
    public ContentItemsDTO getContentItemById(String id) {
        ContentItemsEntity entity = contentItemsDao.selectById(id);
        return entity != null ? convertToDTO(entity) : null;
    }

    @Override
    public List<ContentItemsDTO> getContentItemsByType(String contentType) {
        QueryWrapper<ContentItemsEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("content_type", contentType);

        List<ContentItemsEntity> entities = contentItemsDao.selectList(wrapper);
        return entities.stream()
                .map(this::convertToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<ContentItemsDTO> getContentItemsByCategory(String category) {
        QueryWrapper<ContentItemsEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("category", category);

        List<ContentItemsEntity> entities = contentItemsDao.selectList(wrapper);
        return entities.stream()
                .map(this::convertToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public PageData<ContentItemsDTO> searchContentItems(ContentItemsSearchDTO searchDTO) {
        if (searchDTO.getQuery() == null || searchDTO.getQuery().trim().isEmpty()) {
            return getContentItemsList(searchDTO);
        }

        Map<String, Object> params = new HashMap<>();
        params.put("query", searchDTO.getQuery().trim());
        params.put("contentType", searchDTO.getContentType());
        params.put("offset", (searchDTO.getPage() - 1) * searchDTO.getLimit());
        params.put("limit", searchDTO.getLimit());

        List<ContentItemsEntity> entities = contentItemsDao.searchContentItems(params);
        int total = contentItemsDao.getSearchCount(params);

        List<ContentItemsDTO> dtoList = entities.stream()
                .map(this::convertToDTO)
                .collect(Collectors.toList());

        return new PageData<>(dtoList, total);
    }

    @Override
    public List<String> getCategoriesByType(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            throw new IllegalArgumentException("Content type cannot be empty");
        }
        return contentItemsDao.getCategoriesByType(contentType);
    }

    @Override
    public Map<String, Object> getStatistics() {
        Map<String, Object> stats = new HashMap<>();

        Map<String, Object> musicParams = new HashMap<>();
        musicParams.put("contentType", "music");
        int musicCount = contentItemsDao.getContentItemsCount(musicParams);

        Map<String, Object> storyParams = new HashMap<>();
        storyParams.put("contentType", "story");
        int storyCount = contentItemsDao.getContentItemsCount(storyParams);

        stats.put("totalMusic", musicCount);
        stats.put("totalStories", storyCount);
        stats.put("totalContent", musicCount + storyCount);

        List<String> musicCategories = getCategoriesByType("music");
        List<String> storyCategories = getCategoriesByType("story");

        stats.put("musicCategories", musicCategories);
        stats.put("storyCategories", storyCategories);

        return stats;
    }

    @Override
    public Boolean updateContentItem(String id, ContentItemsDTO dto) {
        ContentItemsEntity entity = convertToEntity(dto);
        entity.setId(id);
        entity.setUpdatedAt(new Date());

        int result = contentItemsDao.updateById(entity);
        return result > 0;
    }

    @Override
    public Boolean partialUpdateContentItem(String id, Map<String, Object> updates) {
        UpdateWrapper<ContentItemsEntity> wrapper = new UpdateWrapper<>();
        wrapper.eq("id", id);

        updates.forEach((key, value) -> {
            if (value != null) {
                wrapper.set(key, value);
            }
        });

        wrapper.set("updated_at", new Date());

        int result = contentItemsDao.update(null, wrapper);
        return result > 0;
    }

    @Override
    public Integer batchUpdateContentItems(List<ContentItemsDTO> dtos) {
        if (dtos == null || dtos.isEmpty()) {
            return 0;
        }

        int updateCount = 0;
        for (ContentItemsDTO dto : dtos) {
            if (dto.getId() != null) {
                ContentItemsEntity entity = convertToEntity(dto);
                entity.setUpdatedAt(new Date());
                updateCount += contentItemsDao.updateById(entity);
            }
        }

        return updateCount;
    }

    @Override
    public Boolean deleteContentItem(String id) {
        int result = contentItemsDao.deleteById(id);
        return result > 0;
    }

    @Override
    public Integer batchDeleteContentItems(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return 0;
        }

        int deleteCount = contentItemsDao.deleteBatchIds(ids);
        return deleteCount;
    }

    private ContentItemsDTO convertToDTO(ContentItemsEntity entity) {
        return ConvertUtils.sourceToTarget(entity, ContentItemsDTO.class);
    }

    private ContentItemsEntity convertToEntity(ContentItemsDTO dto) {
        return ConvertUtils.sourceToTarget(dto, ContentItemsEntity.class);
    }
}
