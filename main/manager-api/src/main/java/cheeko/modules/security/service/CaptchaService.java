package cheeko.modules.security.service;

import java.io.IOException;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Verification Code
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public interface CaptchaService {

    /**
     * Image verification code
     */
    void create(HttpServletResponse response, String uuid) throws IOException;

    /**
     * Verification code validation
     * 
     * @param uuid   uuid
     * @param code   Verification code
     * @param delete Whether to delete verification code
     * @return true: Success false: Failure
     */
    boolean validate(String uuid, String code, Boolean delete);

    /**
     * Send SMS verification code
     * 
     * @param phone Mobile number
     */
    void sendSMSValidateCode(String phone);

    /**
     * Validate SMS verification code
     * 
     * @param phone  Mobile number
     * @param code   Verification code
     * @param delete Whether to delete verification code
     * @return true: Success false: Failure
     */
    boolean validateSMSValidateCode(String phone, String code, Boolean delete);
}