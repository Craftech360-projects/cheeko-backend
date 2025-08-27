package xiaozhi.modules.security.dual;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.constant.Constant;
import xiaozhi.modules.security.oauth2.Oauth2Filter;
import xiaozhi.modules.sys.service.SysParamsService;

/**
 * Dual authentication filter that accepts both OAuth2 user tokens and server secret tokens
 * Extends OAuth2Filter and adds server secret support
 */
@Slf4j
public class DualAuthFilter extends Oauth2Filter {
    private final SysParamsService sysParamsService;

    public DualAuthFilter(SysParamsService sysParamsService) {
        this.sysParamsService = sysParamsService;
    }

    @Override
    protected boolean isAccessAllowed(ServletRequest request, ServletResponse response, Object mappedValue) {
        // Allow OPTIONS requests
        if (((HttpServletRequest) request).getMethod().equals(RequestMethod.OPTIONS.name())) {
            return true;
        }

        // Check if this is server secret authentication
        String token = getRequestToken((HttpServletRequest) request);
        if (StringUtils.isNotBlank(token)) {
            String serverSecret = getServerSecret();
            if (StringUtils.isNotBlank(serverSecret) && serverSecret.equals(token)) {
                log.debug("Server secret authentication successful for dual auth endpoint");
                return true;
            }
        }

        // Not server secret, delegate to parent OAuth2 handling
        return super.isAccessAllowed(request, response, mappedValue);
    }

    /**
     * Get token from request
     */
    private String getRequestToken(HttpServletRequest httpRequest) {
        String authorization = httpRequest.getHeader("Authorization");
        if (StringUtils.isNotBlank(authorization) && authorization.startsWith("Bearer ")) {
            return authorization.replace("Bearer ", "");
        }
        return null;
    }

    private String getServerSecret() {
        return sysParamsService.getValue(Constant.SERVER_SECRET, true);
    }
}