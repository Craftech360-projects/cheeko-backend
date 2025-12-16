package xiaozhi.modules.device.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import xiaozhi.modules.device.entity.ToyAccessoryEntity;

@Mapper
public interface ToyAccessoryDao extends BaseMapper<ToyAccessoryEntity> {

    /**
     * Get accessory by toy MAC and type
     *
     * @param toyMac        Parent toy MAC address
     * @param accessoryType Accessory type (car, lamp, etc.)
     * @return Accessory entity or null
     */
    ToyAccessoryEntity getByToyMacAndType(@Param("toyMac") String toyMac,
            @Param("accessoryType") String accessoryType);

    /**
     * Get all accessories for a toy
     *
     * @param toyMac Parent toy MAC address
     * @return List of accessories
     */
    List<ToyAccessoryEntity> getByToyMac(@Param("toyMac") String toyMac);

    /**
     * Get accessory by its MAC address
     *
     * @param accessoryMac Accessory MAC address
     * @return Accessory entity or null
     */
    ToyAccessoryEntity getByAccessoryMac(@Param("accessoryMac") String accessoryMac);
}
