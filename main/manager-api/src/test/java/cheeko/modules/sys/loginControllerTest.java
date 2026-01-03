package cheeko.modules.sys;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import lombok.extern.slf4j.Slf4j;
import cheeko.modules.security.controller.LoginController;
import cheeko.modules.security.dto.LoginDTO;
import cheeko.modules.security.dto.SmsVerificationDTO;
import cheeko.modules.sys.dto.RetrievePasswordDTO;

@Slf4j
@SpringBootTest
@ActiveProfiles("dev")
class loginControllerTest {

    @Autowired
    LoginController loginController;

    @Test
    public void testRegister() {
        LoginDTO loginDTO = new LoginDTO();
        loginDTO.setUsername("Mobile Number");
        loginDTO.setPassword("Password");
        loginDTO.setCaptcha("123456");
        loginController.register(loginDTO);
    }

    @Test
    public void testSmsVerification() {
        try {
            SmsVerificationDTO smsVerificationDTO = new SmsVerificationDTO();
            smsVerificationDTO.setPhone("Mobile Number");
            smsVerificationDTO.setCaptchaId("123456");
            smsVerificationDTO.setCaptcha("123456");
            loginController.smsVerification(smsVerificationDTO);
        } catch (Exception e) {
            System.out.println(e.getMessage());
        }
    }

    @Test
    public void testRetrievePassword() {
        try {
            RetrievePasswordDTO retrievePasswordDTO = new RetrievePasswordDTO();
            retrievePasswordDTO.setCode("123456");
            retrievePasswordDTO.setPhone("Mobile Number");
            retrievePasswordDTO.setPassword("Password");
            loginController.retrievePassword(retrievePasswordDTO);
        } catch (Exception e) {
            System.out.println(e.getMessage());
        }

    }

}