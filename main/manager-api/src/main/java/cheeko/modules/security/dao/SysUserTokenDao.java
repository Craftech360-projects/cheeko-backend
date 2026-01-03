package cheeko.modules.security.dao;

import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import cheeko.common.dao.BaseDao;
import cheeko.modules.security.entity.SysUserTokenEntity;

/**
 * System UserToken
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Mapper
public interface SysUserTokenDao extends BaseDao<SysUserTokenEntity> {

    SysUserTokenEntity getByToken(String token);

    SysUserTokenEntity getByUserId(Long userId);

    void logout(@Param("userId") Long userId, @Param("expireDate") Date expireDate);
}
