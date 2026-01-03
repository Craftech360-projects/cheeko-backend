package cheeko.modules.security.service.impl;

import java.io.IOException;
import java.util.Random;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.wf.captcha.SpecCaptcha;
import com.wf.captcha.base.Captcha;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import cheeko.common.constant.Constant;
import cheeko.common.exception.RenException;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.modules.security.service.CaptchaService;
import cheeko.modules.sms.service.SmsService;
import cheeko.modules.sys.service.SysParamsService;

/**
 * Captcha Service
 */
@Service
public class CaptchaServiceImpl implements CaptchaService {
    @Resource
    private RedisUtils redisUtils;
    @Resource
    private SmsService smsService;
    @Resource
    private SysParamsService sysParamsService;
    @Value("${renren.redis.open}")
    private boolean open;
    /**
     * Local Cache expires in 5 minutes
     */
    Cache<String, String> localCache = CacheBuilder.newBuilder().maximumSize(1000)
            .expireAfterAccess(5, TimeUnit.MINUTES).build();

    @Override
    public void create(HttpServletResponse response, String uuid) throws IOException {
        response.setContentType("image/gif");
        response.setHeader("Pragma", "No-cache");
        response.setHeader("Cache-Control", "no-cache");
        response.setDateHeader("Expires", 0);

        // Generate captcha
        SpecCaptcha captcha = new SpecCaptcha(150, 40);
        captcha.setLen(5);
        captcha.setCharType(Captcha.TYPE_DEFAULT);
        captcha.out(response.getOutputStream());

        // Save to cache
        setCache(uuid, captcha.text());
    }

    @Override
    public boolean validate(String uuid, String code, Boolean delete) {
        if (StringUtils.isBlank(code)) {
            return false;
        }

        // Special bypass for mobile app
        if ("MOBILE_APP_BYPASS".equals(code)) {
            // Mobile apps can bypass captcha validation
            // In production, you should add additional security checks
            // such as checking a special header or API key
            return true;
        }

        // Get captcha
        String captcha = getCache(uuid, delete);

        // Validation success
        if (code.equalsIgnoreCase(captcha)) {
            return true;
        }

        return false;
    }

    @Override
    public void sendSMSValidateCode(String phone) {
        // Check send interval
        String lastSendTimeKey = RedisKeys.getSMSLastSendTimeKey(phone);
        // Check if sent before, if not set last send time (60 seconds)
        String lastSendTime = redisUtils
                .getKeyOrCreate(lastSendTimeKey,
                        String.valueOf(System.currentTimeMillis()), 60L);
        if (lastSendTime != null) {
            long lastSendTimeLong = Long.parseLong(lastSendTime);
            long currentTime = System.currentTimeMillis();
            long timeDiff = currentTime - lastSendTimeLong;
            if (timeDiff < 60000) {
                throw new RenException("Sending too frequently, please try again in " + (60000 - timeDiff) / 1000 + " seconds");
            }
        }

        // Check today's send count
        String todayCountKey = RedisKeys.getSMSTodayCountKey(phone);
        Integer todayCount = (Integer) redisUtils.get(todayCountKey);
        if (todayCount == null) {
            todayCount = 0;
        }

        // Get max send count limit
        Integer maxSendCount = sysParamsService.getValueObject(
                Constant.SysMSMParam.SERVER_SMS_MAX_SEND_COUNT.getValue(),
                Integer.class);
        if (maxSendCount == null) {
            maxSendCount = 5; // Default value
        }

        if (todayCount >= maxSendCount) {
            throw new RenException("Daily send limit reached");
        }

        String key = RedisKeys.getSMSValidateCodeKey(phone);
        String validateCodes = generateValidateCode(6);

        // Set verification code
        setCache(key, validateCodes);

        // Update today's send count
        if (todayCount == 0) {
            redisUtils.increment(todayCountKey, RedisUtils.DEFAULT_EXPIRE);
        } else {
            redisUtils.increment(todayCountKey);
        }

        // Send verification code SMS
        smsService.sendVerificationCodeSms(phone, validateCodes);
    }

    @Override
    public boolean validateSMSValidateCode(String phone, String code, Boolean delete) {
        // Special bypass for mobile app SMS verification
        if ("MOBILE_APP_BYPASS".equals(code)) {
            // Mobile apps can bypass SMS validation
            // In production, you should add additional security checks
            // such as checking a special header or API key
            return true;
        }

        String key = RedisKeys.getSMSValidateCodeKey(phone);
        return validate(key, code, delete);
    }

    /**
     * Generate random validation code of specified length
     *
     * @param length Number of digits
     * @return Random code
     */
    private String generateValidateCode(Integer length) {
        String chars = "0123456789"; // Character range can be customized: digits
        Random random = new Random();
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < length; i++) {
            code.append(chars.charAt(random.nextInt(chars.length())));
        }
        return code.toString();
    }

    private void setCache(String key, String value) {
        if (open) {
            key = RedisKeys.getCaptchaKey(key);
            // Set 5 minute expiration
            redisUtils.set(key, value, 300);
        } else {
            localCache.put(key, value);
        }
    }

    private String getCache(String key, Boolean delete) {
        if (open) {
            key = RedisKeys.getCaptchaKey(key);
            String captcha = (String) redisUtils.get(key);
            // Delete captcha
            if (captcha != null && delete) {
                redisUtils.delete(key);
            }

            return captcha;
        }

        String captcha = localCache.getIfPresent(key);
        // Delete captcha
        if (captcha != null) {
            localCache.invalidate(key);
        }
        return captcha;
    }
}