package cheeko.modules.security.service;

import cheeko.modules.security.entity.SysUserTokenEntity;
import cheeko.modules.sys.entity.SysUserEntity;

/**
 * Shiro related interface
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public interface ShiroService {

    SysUserTokenEntity getByToken(String token);

    /**
     * Query user by user ID
     *
     * @param userId
     */
    SysUserEntity getUser(Long userId);

}
