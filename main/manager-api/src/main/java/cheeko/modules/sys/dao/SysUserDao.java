package cheeko.modules.sys.dao;

import org.apache.ibatis.annotations.Mapper;

import cheeko.common.dao.BaseDao;
import cheeko.modules.sys.entity.SysUserEntity;

/**
 * System User
 */
@Mapper
public interface SysUserDao extends BaseDao<SysUserEntity> {

}