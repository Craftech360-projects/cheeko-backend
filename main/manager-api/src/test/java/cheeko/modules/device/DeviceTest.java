package cheeko.modules.device;

import java.util.HashMap;
import java.util.UUID;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import cheeko.common.redis.RedisUtils;
import cheeko.modules.sys.dto.SysUserDTO;
import cheeko.modules.sys.service.SysUserService;

@SpringBootTest
@ActiveProfiles("dev")
@DisplayName("Device Test")
public class DeviceTest {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DeviceTest.class);

    @Autowired
    private RedisUtils redisUtils;
    @Autowired
    private SysUserService sysUserService;

    @Test
    public void testSaveUser() {
        SysUserDTO userDTO = new SysUserDTO();
        userDTO.setUsername("test");
        userDTO.setPassword(UUID.randomUUID().toString());
        sysUserService.save(userDTO);
    }

    @Test
    @DisplayName("Test Write Device Information")
    public void testWriteDeviceInfo() {
        log.info("Start testing WriteDeviceInformation...");
        // Mock device MAC address
        String macAddress = "00:11:22:33:44:66";
        // Mock device validation code
        String deviceCode = "123456";

        HashMap<String, Object> map = new HashMap<>();
        map.put("mac_address", macAddress);
        map.put("activation_code", deviceCode);
        map.put("board", "Hardware Model");
        map.put("app_version", "0.3.13");

        String safeDeviceId = macAddress.replace(":", "_").toLowerCase();
        String cacheDeviceKey = String.format("ota:activation:data:%s", safeDeviceId);
        redisUtils.set(cacheDeviceKey, map, 300);

        String redisKey = "ota:activation:code:" + deviceCode;
        log.info("Redis Key: {}", redisKey);

        // Write device information to Redis
        redisUtils.set(redisKey, macAddress, 300);
        log.info("Device information has been written to Redis");

        // Validate whether write was successful
        String savedMacAddress = (String) redisUtils.get(redisKey);
        log.info("MAC address read from Redis: {}", savedMacAddress);

        // Use assertion to validate
        Assertions.assertNotNull(savedMacAddress, "MAC address read from Redis should not be empty");
        Assertions.assertEquals(macAddress, savedMacAddress, "Saved MAC address does not match original MAC address");

        log.info("Test completed");
    }
}