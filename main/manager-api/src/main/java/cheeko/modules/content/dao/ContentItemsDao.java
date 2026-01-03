package cheeko.modules.content.dao;

import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.content.entity.ContentItemsEntity;

/**
 * Content Items Data Access Object
 */
@Mapper
public interface ContentItemsDao extends BaseMapper<ContentItemsEntity> {

    List<ContentItemsEntity> getContentItemsList(Map<String, Object> params);

    int getContentItemsCount(Map<String, Object> params);

    List<String> getCategoriesByType(@Param("contentType") String contentType);

    List<ContentItemsEntity> searchContentItems(Map<String, Object> params);

    int getSearchCount(Map<String, Object> params);

    int batchInsert(@Param("list") List<ContentItemsEntity> contentList);
}
