package cheeko.common.xss;

import java.util.Collections;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Data;

/**
 * XSS Configuration Properties
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Data
@ConfigurationProperties(prefix = "renren.xss")
public class XssProperties {
    /**
     * Whether to enable XSS filtering
     */
    private boolean enabled;
    /**
     * List of excluded URLs
     */
    private List<String> excludeUrls = Collections.emptyList();
}
