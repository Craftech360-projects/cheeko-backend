package cheeko.modules.timbre.dao;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.timbre.entity.TimbreEntity;

/**
 * TimbrePersistence LayerDefinition
 * 
 * @author zjy
 * @since 2025-3-21
 */
@Mapper
public interface TimbreDao extends BaseMapper<TimbreEntity> {
}