package cheeko.modules.sys.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import cheeko.common.dao.BaseDao;
import cheeko.modules.sys.entity.KidProfileEntity;

/**
 * Kid Profile DAO
 */
@Mapper
public interface KidProfileDao extends BaseDao<KidProfileEntity> {

    /**
     * Get all kids by user ID (parent)
     * @param userId User ID
     * @return List of kid profiles
     */
    List<KidProfileEntity> getByUserId(@Param("userId") Long userId);

    /**
     * Get kid by ID and user ID (for security check)
     * @param id Kid ID
     * @param userId User ID
     * @return Kid profile entity
     */
    KidProfileEntity getByIdAndUserId(@Param("id") Long id, @Param("userId") Long userId);
}
