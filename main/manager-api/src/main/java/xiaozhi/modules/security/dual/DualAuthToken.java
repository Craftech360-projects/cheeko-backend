package xiaozhi.modules.security.dual;

import org.apache.shiro.authc.AuthenticationToken;

/**
 * Dual authentication token that can represent both OAuth2 and server secret tokens
 */
public class DualAuthToken implements AuthenticationToken {
    private String token;

    public DualAuthToken(String token) {
        this.token = token;
    }

    @Override
    public String getPrincipal() {
        return token;
    }

    @Override
    public String getCredentials() {
        return token;
    }

    public String getToken() {
        return token;
    }
}