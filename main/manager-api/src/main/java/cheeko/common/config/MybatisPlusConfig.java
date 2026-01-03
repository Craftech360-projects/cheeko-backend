package cheeko.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.BlockAttackInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;

import cheeko.common.interceptor.DataFilterInterceptor;

/**
 * mybatis-plusConfiguration
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor mybatisPlusInterceptor = new MybatisPlusInterceptor();
        // DataPermission
        mybatisPlusInterceptor.addInnerInterceptor(new DataFilterInterceptor());
        // PaginationPlugin
        mybatisPlusInterceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        // Optimistic locking
        mybatisPlusInterceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        // Prevent full table update and delete
        mybatisPlusInterceptor.addInnerInterceptor(new BlockAttackInnerInterceptor());

        return mybatisPlusInterceptor;
    }

}