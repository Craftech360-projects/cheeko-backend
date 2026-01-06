package cheeko.modules.security.config;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.shiro.mgt.SecurityManager;
import org.apache.shiro.session.mgt.SessionManager;
import org.apache.shiro.spring.LifecycleBeanPostProcessor;
import org.apache.shiro.spring.security.interceptor.AuthorizationAttributeSourceAdvisor;
import org.apache.shiro.spring.web.ShiroFilterFactoryBean;
import org.apache.shiro.web.config.ShiroFilterConfiguration;
import org.apache.shiro.web.mgt.DefaultWebSecurityManager;
import org.apache.shiro.web.session.mgt.DefaultWebSessionManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import jakarta.servlet.Filter;
import cheeko.modules.security.dual.DualAuthFilter;
import cheeko.modules.security.oauth2.Oauth2Filter;
import cheeko.modules.security.oauth2.Oauth2Realm;
import cheeko.modules.security.secret.ServerSecretFilter;
import cheeko.modules.sys.service.SysParamsService;

/**
 * Shiros ConfigurationFile
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Configuration
public class ShiroConfig {

    @Bean
    public DefaultWebSessionManager sessionManager() {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        sessionManager.setSessionValidationSchedulerEnabled(false);
        sessionManager.setSessionIdUrlRewritingEnabled(false);

        return sessionManager;
    }

    @Bean("securityManager")
    public SecurityManager securityManager(Oauth2Realm oAuth2Realm, SessionManager sessionManager) {
        DefaultWebSecurityManager securityManager = new DefaultWebSecurityManager();
        securityManager.setRealm(oAuth2Realm);
        securityManager.setSessionManager(sessionManager);
        securityManager.setRememberMeManager(null);
        return securityManager;
    }

    @Bean("shiroFilter")
    public ShiroFilterFactoryBean shirFilter(SecurityManager securityManager, SysParamsService sysParamsService) {
        ShiroFilterConfiguration config = new ShiroFilterConfiguration();
        config.setFilterOncePerRequest(true);

        ShiroFilterFactoryBean shiroFilter = new ShiroFilterFactoryBean();
        shiroFilter.setSecurityManager(securityManager);
        shiroFilter.setShiroFilterConfiguration(config);

        Map<String, Filter> filters = new HashMap<>();
        // oauthFilter
        filters.put("oauth2", new Oauth2Filter());
        // ServiceSecret KeyFilter
        filters.put("server", new ServerSecretFilter(sysParamsService));
        // Dual Authentication Filter (supports Service Secret Key and OAuth2)
        filters.put("dual", new DualAuthFilter(sysParamsService));
        shiroFilter.setFilters(filters);

        // Add Shiro's built-in filter server
        /*
         * anon: No authentication required, can access
         * authc: Must be authenticated before access
         * user: Must have "remember me" function enabled to access
         * perms: Must have permission for a specific resource to access
         * role: Must have a specific role permission to access
         */
        Map<String, String> filterMap = new LinkedHashMap<>();
        filterMap.put("/ota/**", "anon");
        filterMap.put("/otaMag/download/**", "anon");
        filterMap.put("/webjars/**", "anon");
        filterMap.put("/druid/**", "anon");
        filterMap.put("/v3/api-docs/**", "anon");
        filterMap.put("/doc.html", "anon");
        filterMap.put("/favicon.ico", "anon");
        filterMap.put("/user/captcha", "anon");
        filterMap.put("/user/smsVerification", "anon");
        filterMap.put("/user/login", "anon");
        filterMap.put("/user/pub-config", "anon");
        filterMap.put("/user/register", "anon");
        filterMap.put("/user/retrieve-password", "anon");
        filterMap.put("/user/update-password", "anon");
        filterMap.put("/user/delete-account", "anon");
        // Use server service filter for config path
        filterMap.put("/config/**", "server");
        filterMap.put("/agent/chat-history/report", "server");
        filterMap.put("/agent/chat-history/session", "server");
        filterMap.put("/agent/saveMemory/**", "server");
        filterMap.put("/agent/prompt/**", "server");
        // Analytics endpoints use dual auth (server secret OR OAuth2)
        // This allows both backend services and frontend users to access
        filterMap.put("/analytics/**", "dual");
        filterMap.put("/usage/tokens", "anon"); // Allow anonymous POST for token usage recording (called from LiveKit server)
        // Note: /usage/analytics/** will use oauth2 (requires login) for dashboard access
        filterMap.put("/agent/device/**/cycle-mode", "anon"); // Allow firmware direct access (legacy)
        filterMap.put("/agent/device/**/cycle-character", "anon"); // Allow firmware direct access (cycle)
        filterMap.put("/agent/device/**/set-character", "anon"); // Allow firmware direct access (set specific)
        filterMap.put("/agent/device/**/current-character", "anon"); // Allow firmware direct access (get current)
        filterMap.put("/device/**/cycle-mode", "anon"); // Allow firmware direct access (device mode cycle)
        filterMap.put("/device/**/mode", "anon"); // Allow anonymous access to query device mode
        filterMap.put("/device/**/device-mode", "anon"); // Allow anonymous access to query device PTT mode (auto/manual)
        filterMap.put("/agent/device/*/agent-id", "server");
        filterMap.put("/agent/update-mode", "server");
        filterMap.put("/agent/play/**", "anon");
        filterMap.put("/content/items/**", "anon");
        filterMap.put("/device/**/playlist/**", "anon"); // Allow anonymous access to playlist APIs
        filterMap.put("/admin/rfid/card/lookup/**", "anon"); // Allow ESP32 device access to RFID question lookup
        filterMap.put("/admin/rfid/series/lookup/**", "anon"); // Allow ESP32 device access to RFID series lookup
        filterMap.put("/admin/rfid/pack/active", "anon"); // Allow public access to active packs
        filterMap.put("/admin/rfid/pack/age/**", "anon"); // Allow public access to age-based packs
        filterMap.put("/**", "oauth2");
        shiroFilter.setFilterChainDefinitionMap(filterMap);

        return shiroFilter;
    }

    @Bean("lifecycleBeanPostProcessor")
    public LifecycleBeanPostProcessor lifecycleBeanPostProcessor() {
        return new LifecycleBeanPostProcessor();
    }

    @Bean
    public AuthorizationAttributeSourceAdvisor authorizationAttributeSourceAdvisor(SecurityManager securityManager) {
        AuthorizationAttributeSourceAdvisor advisor = new AuthorizationAttributeSourceAdvisor();
        advisor.setSecurityManager(securityManager);
        return advisor;
    }
}
