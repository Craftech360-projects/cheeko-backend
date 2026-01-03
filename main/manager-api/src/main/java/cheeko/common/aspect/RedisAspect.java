package cheeko.common.aspect;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;
import cheeko.common.exception.ErrorCode;
import cheeko.common.exception.RenException;

/**
 * Redis Aspect Handler Class
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Slf4j
@Aspect
@Component
public class RedisAspect {
    /**
     * WhetherEnableredisCache trueEnable falseClose
     */
    @Value("${renren.redis.open}")
    private boolean open;

    @Around("execution(* cheeko.common.redis.RedisUtils.*(..))")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        Object result = null;
        if (open) {
            try {
                result = point.proceed();
            } catch (Exception e) {
                log.error("redis error", e);
                throw new RenException(ErrorCode.REDIS_ERROR);
            }
        }
        return result;
    }
}
