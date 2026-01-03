package cheeko.modules.security.service.impl;

import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import cheeko.modules.security.dao.SysUserTokenDao;
import cheeko.modules.security.entity.SysUserTokenEntity;
import cheeko.modules.security.service.ShiroService;
import cheeko.modules.sys.dao.SysUserDao;
import cheeko.modules.sys.entity.SysUserEntity;

@AllArgsConstructor
@Service
public class ShiroServiceImpl implements ShiroService {
    private final SysUserDao sysUserDao;
    private final SysUserTokenDao sysUserTokenDao;

    @Override
    public SysUserTokenEntity getByToken(String token) {
        return sysUserTokenDao.getByToken(token);
    }

    @Override
    public SysUserEntity getUser(Long userId) {
        return sysUserDao.selectById(userId);
    }
}