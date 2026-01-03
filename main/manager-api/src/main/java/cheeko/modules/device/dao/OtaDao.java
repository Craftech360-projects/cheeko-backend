package cheeko.modules.device.dao;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.device.entity.OtaEntity;

/**
 * OTAFirmwareManagement
 */
@Mapper
public interface OtaDao extends BaseMapper<OtaEntity> {
    
}