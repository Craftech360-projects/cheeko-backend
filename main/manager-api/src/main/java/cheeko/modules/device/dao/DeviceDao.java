package cheeko.modules.device.dao;

import java.util.Date;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.device.entity.DeviceEntity;

@Mapper
public interface DeviceDao extends BaseMapper<DeviceEntity> {
    /**
     * Get all devices' last connection time for this agent
     * 
     * @param agentId Agent ID
     * @return
     */
    Date getAllLastConnectedAtByAgentId(String agentId);

}