package cheeko.modules.security.service.impl;

import java.util.Date;

import org.springframework.stereotype.Service;

import cn.hutool.core.date.DateUtil;
import lombok.AllArgsConstructor;
import cheeko.common.exception.ErrorCode;
import cheeko.common.exception.RenException;
import cheeko.common.page.TokenDTO;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.common.utils.HttpContextUtils;
import cheeko.common.utils.Result;
import cheeko.modules.security.dao.SysUserTokenDao;
import cheeko.modules.security.entity.SysUserTokenEntity;
import cheeko.modules.security.oauth2.TokenGenerator;
import cheeko.modules.security.service.SysUserTokenService;
import cheeko.modules.sys.dto.PasswordDTO;
import cheeko.modules.sys.dto.SysUserDTO;
import cheeko.modules.sys.service.SysUserService;

@AllArgsConstructor
@Service
public class SysUserTokenServiceImpl extends BaseServiceImpl<SysUserTokenDao, SysUserTokenEntity>
        implements SysUserTokenService {

    private final SysUserService sysUserService;
    /**
     * 7天后Expired
     */
    private final static int EXPIRE = 3600 * 24 * 7;

    @Override
    public Result<TokenDTO> createToken(Long userId) {
        // Usertoken
        String token;

        // CurrentTime
        Date now = new Date();
        // ExpiredTime
        Date expireTime = new Date(now.getTime() + EXPIRE * 1000);

        // 判断WhetherGenerate过token
        SysUserTokenEntity tokenEntity = baseDao.getByUserId(userId);
        if (tokenEntity == null) {
            // Generate一个token
            token = TokenGenerator.generateValue();

            tokenEntity = new SysUserTokenEntity();
            tokenEntity.setUserId(userId);
            tokenEntity.setToken(token);
            tokenEntity.setUpdateDate(now);
            tokenEntity.setExpireDate(expireTime);

            // Savetoken
            this.insert(tokenEntity);
        } else {
            // 判断tokenWhetherExpired
            if (tokenEntity.getExpireDate().getTime() < System.currentTimeMillis()) {
                // tokenExpired，重新Generatetoken
                token = TokenGenerator.generateValue();
            } else {
                token = tokenEntity.getToken();
            }

            tokenEntity.setToken(token);
            tokenEntity.setUpdateDate(now);
            tokenEntity.setExpireDate(expireTime);

            // Updatetoken
            this.updateById(tokenEntity);
        }

        String clientHash = HttpContextUtils.getClientCode();

        TokenDTO tokenDTO = new TokenDTO();
        tokenDTO.setToken(token);
        tokenDTO.setExpire(EXPIRE);
        tokenDTO.setClientHash(clientHash);
        return new Result<TokenDTO>().ok(tokenDTO);
    }

    @Override
    public SysUserDTO getUserByToken(String token) {
        SysUserTokenEntity userToken = baseDao.getByToken(token);
        if (null == userToken) {
            throw new RenException(ErrorCode.TOKEN_INVALID);
        }

        Date now = new Date();
        if (userToken.getExpireDate().before(now)) {
            throw new RenException(ErrorCode.UNAUTHORIZED);
        }

        SysUserDTO userDTO = sysUserService.getByUserId(userToken.getUserId());
        userDTO.setPassword("");
        return userDTO;
    }

    @Override
    public void logout(Long userId) {
        Date expireDate = DateUtil.offsetMinute(new Date(), -1);
        baseDao.logout(userId, expireDate);
    }

    @Override
    public void changePassword(Long userId, PasswordDTO passwordDTO) {
        // UpdatePassword
        sysUserService.changePassword(userId, passwordDTO);

        // 使 token 失效，后Required重新Login
        Date expireDate = DateUtil.offsetMinute(new Date(), -1);
        baseDao.logout(userId, expireDate);
    }
}