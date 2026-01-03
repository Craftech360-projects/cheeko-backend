package cheeko.modules.sms.service;

/**
 * SMSServices MethodDefinitionInterface
 *
 * @author zjy
 * @since 2025-05-12
 */
public interface SmsService {

    /**
     * Send verification code SMS
     * @param phone Mobile number
     * @param VerificationCode Verification code
     */
    void sendVerificationCodeSms(String phone, String VerificationCode) ;
}
