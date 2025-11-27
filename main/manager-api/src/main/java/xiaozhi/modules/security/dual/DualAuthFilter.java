package xiaozhi.modules.security.dual;

import java.io.IOException;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authc.AuthenticationException;
import org.apache.shiro.authc.AuthenticationToken;
import org.apache.shiro.web.filter.authc.AuthenticatingFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.exception.ErrorCode;
import xiaozhi.common.utils.HttpContextUtils;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.security.oauth2.Oauth2Token;
import xiaozhi.modules.sys.service.SysParamsService;

/**
 * Dual Authentication Filter
 * Supports both Server Secret (for backend services) and OAuth2 (for mobile app)
 *
 * Authentication priority:
 * 1. Try Server Secret authentication first (for Python/Node services)
 * 2. If Server Secret fails, try OAuth2 JWT token authentication (for mobile app)
 */
public class DualAuthFilter extends AuthenticatingFilter {

    private static final Logger logger = LoggerFactory.getLogger(DualAuthFilter.class);

    private SysParamsService sysParamsService;

    public DualAuthFilter(SysParamsService sysParamsService) {
        this.sysParamsService = sysParamsService;
    }

    @Override
    protected AuthenticationToken createToken(ServletRequest request, ServletResponse response) throws Exception {
        String token = getRequestToken((HttpServletRequest) request);

        if (StringUtils.isBlank(token)) {
            logger.warn("[DualAuth] Token is empty");
            return null;
        }

        // Only create OAuth2Token here (server secret is validated directly in onAccessDenied)
        logger.debug("[DualAuth] Creating OAuth2 token for realm authentication");
        return new Oauth2Token(token);
    }

    @Override
    protected boolean isAccessAllowed(ServletRequest request, ServletResponse response, Object mappedValue) {
        // Allow OPTIONS requests (CORS preflight)
        if (((HttpServletRequest) request).getMethod().equals(RequestMethod.OPTIONS.name())) {
            return true;
        }

        return false;
    }

    @Override
    protected boolean onAccessDenied(ServletRequest request, ServletResponse response) throws Exception {
        // Get request token
        String token = getRequestToken((HttpServletRequest) request);

        if (StringUtils.isBlank(token)) {
            logger.warn("[DualAuth] Access denied - token is empty");
            sendUnauthorizedResponse(response, "Authentication token is required");
            return false;
        }

        // Check if this is a server secret (validate directly, no realm needed)
        String serverSecret = getServerSecret();
        if (StringUtils.isNotBlank(serverSecret) && serverSecret.equals(token)) {
            logger.debug("[DualAuth] Server secret validated successfully");
            return true; // Allow access - server secret is valid
        }

        // Not a server secret - try OAuth2 authentication via realm
        logger.debug("[DualAuth] Attempting OAuth2 authentication");
        return executeLogin(request, response);
    }

    @Override
    protected boolean onLoginFailure(AuthenticationToken token, AuthenticationException e, ServletRequest request,
            ServletResponse response) {
        logger.error("[DualAuth] OAuth2 authentication failed: {}", e.getMessage());
        sendUnauthorizedResponse(response, "Invalid authentication token");
        return false;
    }

    /**
     * Get token from request headers
     * Supports both "secret" header and "Authorization: Bearer" header
     */
    private String getRequestToken(HttpServletRequest httpRequest) {
        String token = null;

        // First try to get from "secret" header (for backward compatibility)
        token = httpRequest.getHeader("secret");
        if (StringUtils.isNotBlank(token)) {
            return token;
        }

        // Then try "Authorization: Bearer" header (standard)
        String authorization = httpRequest.getHeader(Constant.AUTHORIZATION);
        if (StringUtils.isNotBlank(authorization) && authorization.startsWith("Bearer ")) {
            token = authorization.replace("Bearer ", "");
        }

        return token;
    }

    /**
     * Get configured server secret from database
     */
    private String getServerSecret() {
        return sysParamsService.getValue(Constant.SERVER_SECRET, true);
    }

    /**
     * Send unauthorized error response
     */
    private void sendUnauthorizedResponse(ServletResponse response, String message) {
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        httpResponse.setContentType("application/json;charset=utf-8");
        httpResponse.setHeader("Access-Control-Allow-Credentials", "true");
        httpResponse.setHeader("Access-Control-Allow-Origin", HttpContextUtils.getOrigin());

        try {
            Result<Void> result = new Result<Void>().error(ErrorCode.UNAUTHORIZED, message);
            String json = JsonUtils.toJsonString(result);
            httpResponse.getWriter().print(json);
        } catch (IOException e) {
            logger.error("[DualAuth] Error writing unauthorized response", e);
        }
    }
}
