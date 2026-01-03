package cheeko.modules.security.user;

import org.apache.shiro.SecurityUtils;
import org.apache.shiro.subject.Subject;

import cheeko.common.user.UserDetail;

/**
 * ShiroUtility Class
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public class SecurityUser {

    public static Subject getSubject() {
        try {
            return SecurityUtils.getSubject();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * GetUserInformation
     */
    public static UserDetail getUser() {
        Subject subject = getSubject();
        if (subject == null) {
            return new UserDetail();
        }

        UserDetail user = (UserDetail) subject.getPrincipal();
        if (user == null) {
            return new UserDetail();
        }

        return user;
    }

    public static String getToken() {
        return getUser().getToken();
    }

    /**
     * GetUserID
     */
    public static Long getUserId() {
        return getUser().getId();
    }
}