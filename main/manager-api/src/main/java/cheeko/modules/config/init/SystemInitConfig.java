package cheeko.modules.config.init;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.DependsOn;

import jakarta.annotation.PostConstruct;
import cheeko.common.constant.Constant;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.modules.config.service.ConfigService;
import cheeko.modules.sys.service.SysParamsService;

@Configuration
public class SystemInitConfig {

    @Autowired
    private SysParamsService sysParamsService;

    @Autowired
    private ConfigService configService;

    @Autowired
    private RedisUtils redisUtils;

    @PostConstruct
    public void init() {
        // Check version number
        String redisVersion = (String) redisUtils.get(RedisKeys.getVersionKey());
        if (!Constant.VERSION.equals(redisVersion)) {
            // If version mismatch, clear Redis
            redisUtils.emptyAll();
            // Store new version number
            redisUtils.set(RedisKeys.getVersionKey(), Constant.VERSION);
        }

        sysParamsService.initServerSecret();
        configService.getConfig(false);
    }
}