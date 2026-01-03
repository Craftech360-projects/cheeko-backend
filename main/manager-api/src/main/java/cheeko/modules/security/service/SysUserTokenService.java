package cheeko.modules.security.service;

import cheeko.common.page.TokenDTO;
import cheeko.common.service.BaseService;
import cheeko.common.utils.Result;
import cheeko.modules.security.entity.SysUserTokenEntity;
import cheeko.modules.sys.dto.PasswordDTO;
import cheeko.modules.sys.dto.SysUserDTO;

/**
 * UserToken
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public interface SysUserTokenService extends BaseService<SysUserTokenEntity> {

    /**
     * Generatetoken
     *
     * @param userId UserID
     */
    Result<TokenDTO> createToken(Long userId);

    SysUserDTO getUserByToken(String token);

    /**
     * Exit
     *
     * @param userId UserID
     */
    void logout(Long userId);

    /**
     * UpdatePassword
     *
     * @param userId
     * @param passwordDTO
     */
    void changePassword(Long userId, PasswordDTO passwordDTO);

}