package xiaozhi.modules.device.service.impl;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.apache.commons.lang3.StringUtils;
import org.springframework.aop.framework.AopContext;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;

import cn.hutool.core.util.RandomUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.exception.RenException;
import xiaozhi.common.page.PageData;
import xiaozhi.common.redis.RedisKeys;
import xiaozhi.common.redis.RedisUtils;
import xiaozhi.common.service.impl.BaseServiceImpl;
import xiaozhi.common.user.UserDetail;
import xiaozhi.common.utils.ConvertUtils;
import xiaozhi.common.utils.DateUtils;
import xiaozhi.modules.device.dao.DeviceDao;
import xiaozhi.modules.device.dto.DevicePageUserDTO;
import xiaozhi.modules.device.dto.DeviceReportReqDTO;
import xiaozhi.modules.device.dto.DeviceReportRespDTO;
import xiaozhi.modules.device.dto.ModeCycleResponse;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.entity.OtaEntity;
import xiaozhi.modules.device.service.DeviceService;
import xiaozhi.modules.device.service.OtaService;
import xiaozhi.modules.device.vo.UserShowDeviceListVO;
import xiaozhi.modules.security.user.SecurityUser;
import xiaozhi.modules.sys.service.SysParamsService;
import xiaozhi.modules.sys.service.SysUserUtilService;
import xiaozhi.modules.device.dto.DeviceManualAddDTO;

@Slf4j
@Service
@AllArgsConstructor
public class DeviceServiceImpl extends BaseServiceImpl<DeviceDao, DeviceEntity> implements DeviceService {

    private final DeviceDao deviceDao;
    private final SysUserUtilService sysUserUtilService;
    private final SysParamsService sysParamsService;
    private final RedisUtils redisUtils;
    private final OtaService otaService;

    @Async
    public void updateDeviceConnectionInfo(String agentId, String deviceId, String appVersion) {
        try {
            DeviceEntity device = new DeviceEntity();
            device.setId(deviceId);
            device.setLastConnectedAt(new Date());
            if (StringUtils.isNotBlank(appVersion)) {
                device.setAppVersion(appVersion);
            }
            deviceDao.updateById(device);
            if (StringUtils.isNotBlank(agentId)) {
                redisUtils.set(RedisKeys.getAgentDeviceLastConnectedAtById(agentId), new Date());
            }
        } catch (Exception e) {
            log.error("异步更新设备连接信息失败", e);
        }
    }

    @Override
    public DeviceEntity deviceActivation(String agentId, String activationCode) {
        if (StringUtils.isBlank(activationCode)) {
            throw new RenException("激活码不能为空");
        }
        String deviceKey = "ota:activation:code:" + activationCode;
        Object cacheDeviceId = redisUtils.get(deviceKey);
        if (cacheDeviceId == null) {
            throw new RenException("激活码错误");
        }
        String deviceId = (String) cacheDeviceId;
        String safeDeviceId = deviceId.replace(":", "_").toLowerCase();
        String cacheDeviceKey = String.format("ota:activation:data:%s", safeDeviceId);
        Map<String, Object> cacheMap = (Map<String, Object>) redisUtils.get(cacheDeviceKey);
        if (cacheMap == null) {
            throw new RenException("激活码错误");
        }
        String cachedCode = (String) cacheMap.get("activation_code");
        if (!activationCode.equals(cachedCode)) {
            throw new RenException("激活码错误");
        }
        // 检查设备有没有被激活
        if (selectById(deviceId) != null) {
            throw new RenException("设备已激活");
        }

        String macAddress = (String) cacheMap.get("mac_address");
        String board = (String) cacheMap.get("board");
        String appVersion = (String) cacheMap.get("app_version");
        UserDetail user = SecurityUser.getUser();
        if (user.getId() == null) {
            throw new RenException("用户未登录");
        }

        Date currentTime = new Date();
        DeviceEntity deviceEntity = new DeviceEntity();
        deviceEntity.setId(deviceId);
        deviceEntity.setBoard(board);
        deviceEntity.setAgentId(agentId);
        deviceEntity.setAppVersion(appVersion);
        deviceEntity.setMacAddress(macAddress);
        deviceEntity.setUserId(user.getId());
        deviceEntity.setCreator(user.getId());
        deviceEntity.setAutoUpdate(1);
        deviceEntity.setCreateDate(currentTime);
        deviceEntity.setUpdater(user.getId());
        deviceEntity.setUpdateDate(currentTime);
        deviceEntity.setLastConnectedAt(currentTime);
        deviceDao.insert(deviceEntity);

        // 清理redis缓存
        redisUtils.delete(cacheDeviceKey);
        redisUtils.delete(deviceKey);

        return deviceEntity;
    }

    @Override
    public DeviceReportRespDTO checkDeviceActive(String macAddress, String clientId,
            DeviceReportReqDTO deviceReport) {
        DeviceReportRespDTO response = new DeviceReportRespDTO();
        response.setServer_time(buildServerTime());

        DeviceEntity deviceById = getDeviceByMacAddress(macAddress);

        // 设备未绑定，则返回当前上传的固件信息（不更新）以此兼容旧固件版本
        if (deviceById == null) {
            DeviceReportRespDTO.Firmware firmware = new DeviceReportRespDTO.Firmware();
            firmware.setVersion(deviceReport.getApplication().getVersion());
            firmware.setUrl(Constant.INVALID_FIRMWARE_URL);
            response.setFirmware(firmware);
        } else {
            // 只有在设备已绑定且autoUpdate不为0的情况下才返回固件升级信息
            if (deviceById.getAutoUpdate() != 0) {
                String type = deviceReport.getBoard() == null ? null : deviceReport.getBoard().getType();
                DeviceReportRespDTO.Firmware firmware = buildFirmwareInfo(type,
                        deviceReport.getApplication() == null ? null : deviceReport.getApplication().getVersion());
                response.setFirmware(firmware);
            }
        }

        // 添加WebSocket配置
        DeviceReportRespDTO.Websocket websocket = new DeviceReportRespDTO.Websocket();
        // 从系统参数获取WebSocket URL，如果未配置则使用默认值
        String wsUrl = sysParamsService.getValue(Constant.SERVER_WEBSOCKET, true);
        if (StringUtils.isBlank(wsUrl) || wsUrl.equals("null")) {
            log.error("WebSocket地址未配置，请登录智控台，在参数管理找到【server.websocket】配置");
            wsUrl = "ws://xiaozhi.server.com:8000/xiaozhi/v1/";
            websocket.setUrl(wsUrl);
        } else {
            String[] wsUrls = wsUrl.split("\\;");
            if (wsUrls.length > 0) {
                // 随机选择一个WebSocket URL
                websocket.setUrl(wsUrls[RandomUtil.randomInt(0, wsUrls.length)]);
            } else {
                log.error("WebSocket地址未配置，请登录智控台，在参数管理找到【server.websocket】配置");
                websocket.setUrl("ws://xiaozhi.server.com:8000/xiaozhi/v1/");
            }
        }

        response.setWebsocket(websocket);
        
        // Always include MQTT credentials for all devices (both registered and unregistered)
        DeviceReportRespDTO.Mqtt mqttCredentials = buildMqttCredentials(macAddress);
        if (mqttCredentials != null) {
            response.setMqtt(mqttCredentials);
        }

        if (deviceById != null) {
            // 如果设备存在，则异步更新上次连接时间和版本信息
            String appVersion = deviceReport.getApplication() != null ? deviceReport.getApplication().getVersion()
                    : null;
            // 通过Spring代理调用异步方法
            ((DeviceServiceImpl) AopContext.currentProxy()).updateDeviceConnectionInfo(deviceById.getAgentId(),
                    deviceById.getId(), appVersion);
        } else {
            // 如果设备不存在，则生成激活码
            DeviceReportRespDTO.Activation code = buildActivation(macAddress, deviceReport);
            response.setActivation(code);
        }

        return response;
    }

    @Override
    public List<DeviceEntity> getUserDevices(Long userId, String agentId) {
        QueryWrapper<DeviceEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("user_id", userId);
        wrapper.eq("agent_id", agentId);
        return baseDao.selectList(wrapper);
    }

    @Override
    public List<DeviceEntity> getDevicesByAgentId(String agentId) {
        QueryWrapper<DeviceEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("agent_id", agentId);
        return baseDao.selectList(wrapper);
    }

    @Override
    public void unbindDevice(Long userId, String deviceId) {
        // First, verify the device exists
        DeviceEntity device = baseDao.selectById(deviceId);
        if (device == null) {
            throw new RenException("设备不存在");
        }

        // Get current user to check if super admin
        UserDetail currentUser = SecurityUser.getUser();
        boolean isSuperAdmin = (currentUser.getSuperAdmin() != null &&
                               currentUser.getSuperAdmin() == 1);

        // Build delete query
        UpdateWrapper<DeviceEntity> wrapper = new UpdateWrapper<>();

        if (!isSuperAdmin) {
            // Regular user - must own the device
            wrapper.eq("user_id", userId);
        }
        // Super admin can unbind any device (no user_id restriction)

        wrapper.eq("id", deviceId);

        // Log the unbind action for audit purposes
        log.info("🔓 Device unbind - DeviceId: {}, DeviceOwner: {}, RequestedBy: {} ({}), Action: {}",
                 deviceId,
                 device.getUserId(),
                 currentUser.getId(),
                 isSuperAdmin ? "SuperAdmin" : "User",
                 isSuperAdmin && !device.getUserId().equals(currentUser.getId()) ? "ADMIN_UNBIND" : "SELF_UNBIND");

        baseDao.delete(wrapper);
    }

    @Override
    public void deleteByUserId(Long userId) {
        UpdateWrapper<DeviceEntity> wrapper = new UpdateWrapper<>();
        wrapper.eq("user_id", userId);
        baseDao.delete(wrapper);
    }

    @Override
    public Long selectCountByUserId(Long userId) {
        UpdateWrapper<DeviceEntity> wrapper = new UpdateWrapper<>();
        wrapper.eq("user_id", userId);
        return baseDao.selectCount(wrapper);
    }

    @Override
    public void deleteByAgentId(String agentId) {
        UpdateWrapper<DeviceEntity> wrapper = new UpdateWrapper<>();
        wrapper.eq("agent_id", agentId);
        baseDao.delete(wrapper);
    }

    @Override
    public PageData<UserShowDeviceListVO> page(DevicePageUserDTO dto) {
        Map<String, Object> params = new HashMap<String, Object>();
        params.put(Constant.PAGE, dto.getPage());
        params.put(Constant.LIMIT, dto.getLimit());
        IPage<DeviceEntity> page = baseDao.selectPage(
                getPage(params, "mac_address", true),
                // 定义查询条件
                new QueryWrapper<DeviceEntity>()
                        // 必须设备关键词查找
                        .like(StringUtils.isNotBlank(dto.getKeywords()), "alias", dto.getKeywords()));
        // 循环处理page获取回来的数据，返回需要的字段
        List<UserShowDeviceListVO> list = page.getRecords().stream().map(device -> {
            UserShowDeviceListVO vo = ConvertUtils.sourceToTarget(device, UserShowDeviceListVO.class);
            // 把最后修改的时间，改为简短描述的时间
            vo.setRecentChatTime(DateUtils.getShortTime(device.getUpdateDate()));
            sysUserUtilService.assignUsername(device.getUserId(),
                    vo::setBindUserName);
            vo.setDeviceType(device.getBoard());
            return vo;
        }).toList();
        // 计算页数
        return new PageData<>(list, page.getTotal());
    }

    @Override
    public DeviceEntity getDeviceByMacAddress(String macAddress) {
        if (StringUtils.isBlank(macAddress)) {
            return null;
        }

        // Try exact match first
        QueryWrapper<DeviceEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", macAddress);
        DeviceEntity device = baseDao.selectOne(wrapper);

        // If not found and MAC doesn't have colons, try with colons (format: 00:11:22:33:44:55)
        if (device == null && !macAddress.contains(":")) {
            String macWithColons = macAddress.replaceAll("(.{2})", "$1:").replaceAll(":$", "");
            wrapper = new QueryWrapper<>();
            wrapper.eq("mac_address", macWithColons);
            device = baseDao.selectOne(wrapper);
        }

        // If not found and MAC has colons, try without colons
        if (device == null && macAddress.contains(":")) {
            String macWithoutColons = macAddress.replace(":", "");
            wrapper = new QueryWrapper<>();
            wrapper.eq("mac_address", macWithoutColons);
            device = baseDao.selectOne(wrapper);
        }

        return device;
    }

    private DeviceReportRespDTO.ServerTime buildServerTime() {
        DeviceReportRespDTO.ServerTime serverTime = new DeviceReportRespDTO.ServerTime();
        TimeZone tz = TimeZone.getDefault();
        serverTime.setTimestamp(Instant.now().toEpochMilli());
        serverTime.setTimeZone(tz.getID());
        serverTime.setTimezone_offset(tz.getOffset(System.currentTimeMillis()) / (60 * 1000));
        return serverTime;
    }

    @Override
    public String geCodeByDeviceId(String deviceId) {
        String dataKey = getDeviceCacheKey(deviceId);

        Map<String, Object> cacheMap = (Map<String, Object>) redisUtils.get(dataKey);
        if (cacheMap != null && cacheMap.containsKey("activation_code")) {
            String cachedCode = (String) cacheMap.get("activation_code");
            return cachedCode;
        }
        return null;
    }

    @Override
    public Date getLatestLastConnectionTime(String agentId) {
        // 查询是否有缓存时间，有则返回
        Date cachedDate = (Date) redisUtils.get(RedisKeys.getAgentDeviceLastConnectedAtById(agentId));
        if (cachedDate != null) {
            return cachedDate;
        }
        Date maxDate = deviceDao.getAllLastConnectedAtByAgentId(agentId);
        if (maxDate != null) {
            redisUtils.set(RedisKeys.getAgentDeviceLastConnectedAtById(agentId), maxDate);
        }
        return maxDate;
    }

    private String getDeviceCacheKey(String deviceId) {
        String safeDeviceId = deviceId.replace(":", "_").toLowerCase();
        String dataKey = String.format("ota:activation:data:%s", safeDeviceId);
        return dataKey;
    }

    public DeviceReportRespDTO.Activation buildActivation(String deviceId, DeviceReportReqDTO deviceReport) {
        DeviceReportRespDTO.Activation code = new DeviceReportRespDTO.Activation();

        String cachedCode = geCodeByDeviceId(deviceId);

        if (StringUtils.isNotBlank(cachedCode)) {
            code.setCode(cachedCode);
            String frontedUrl = sysParamsService.getValue(Constant.SERVER_FRONTED_URL, true);
            code.setMessage(frontedUrl + "\n" + cachedCode);
            code.setChallenge(deviceId);
        } else {
            String newCode = RandomUtil.randomNumbers(6);
            code.setCode(newCode);
            String frontedUrl = sysParamsService.getValue(Constant.SERVER_FRONTED_URL, true);
            code.setMessage(frontedUrl + "\n" + newCode);
            code.setChallenge(deviceId);

            Map<String, Object> dataMap = new HashMap<>();
            dataMap.put("id", deviceId);
            dataMap.put("mac_address", deviceId);

            dataMap.put("board", (deviceReport.getBoard() != null && deviceReport.getBoard().getType() != null)
                    ? deviceReport.getBoard().getType()
                    : (deviceReport.getChipModelName() != null ? deviceReport.getChipModelName() : "unknown"));
            dataMap.put("app_version", (deviceReport.getApplication() != null)
                    ? deviceReport.getApplication().getVersion()
                    : null);

            dataMap.put("deviceId", deviceId);
            dataMap.put("activation_code", newCode);

            // 写入主数据 key
            String dataKey = getDeviceCacheKey(deviceId);
            redisUtils.set(dataKey, dataMap);

            // 写入反查激活码 key
            String codeKey = "ota:activation:code:" + newCode;
            redisUtils.set(codeKey, deviceId);
        }
        return code;
    }
    
    private DeviceReportRespDTO.Mqtt buildMqttCredentials(String deviceId) {
        try {
            DeviceReportRespDTO.Mqtt mqtt = new DeviceReportRespDTO.Mqtt();
            
            // Get MQTT configuration from system parameters
            String mqttBroker = sysParamsService.getValue("mqtt.broker", true);
            String mqttPort = sysParamsService.getValue("mqtt.port", true);
            String mqttSignatureKey = sysParamsService.getValue("mqtt.signature_key", true);
            
            // Use defaults if not configured
            if (StringUtils.isBlank(mqttBroker)) {
                mqttBroker = "192.168.1.236"; // Default to local IP
            }
            if (StringUtils.isBlank(mqttPort)) {
                mqttPort = "1883";
            }
            if (StringUtils.isBlank(mqttSignatureKey)) {
                mqttSignatureKey = "test-signature-key-12345";
            }
            
            // Convert MAC address format (remove colons, use underscores)
            String macAddress = deviceId.replace(":", "_");
            
            // Generate UUID for this session
            String clientUuid = UUID.randomUUID().toString();
            
            // Create client ID in format: GID_test@@@mac_address@@@uuid
            String groupId = "GID_test";
            String clientId = groupId + "@@@" + macAddress + "@@@" + clientUuid;
            
            // Get client IP from request
            String clientIp = "127.0.0.1";
            try {
                ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
                if (attributes != null) {
                    HttpServletRequest request = attributes.getRequest();
                    clientIp = request.getRemoteAddr();
                    String forwardedFor = request.getHeader("X-Forwarded-For");
                    if (StringUtils.isNotBlank(forwardedFor)) {
                        clientIp = forwardedFor.split(",")[0].trim();
                    } else {
                        String realIp = request.getHeader("X-Real-IP");
                        if (StringUtils.isNotBlank(realIp)) {
                            clientIp = realIp;
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to get client IP: {}", e.getMessage());
            }
            
            // Create user data and encode as base64 JSON
            Map<String, String> userData = new HashMap<>();
            userData.put("ip", clientIp);
            String userDataJson = "{\"ip\":\"" + clientIp + "\"}";
            String username = Base64.getEncoder().encodeToString(userDataJson.getBytes(StandardCharsets.UTF_8));
            
            // Generate password signature using HMAC-SHA256
            String content = clientId + "|" + username;
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(mqttSignatureKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(secretKeySpec);
            byte[] signature = mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
            String password = Base64.getEncoder().encodeToString(signature);
            
            // Set MQTT credentials
            mqtt.setBroker(mqttBroker);
            mqtt.setPort(Integer.parseInt(mqttPort));
            mqtt.setEndpoint(mqttBroker + ":" + mqttPort);
            mqtt.setClient_id(clientId);
            mqtt.setUsername(username);
            mqtt.setPassword(password);
            mqtt.setPublish_topic("device-server");
            mqtt.setSubscribe_topic("null");

            return mqtt;
        } catch (Exception e) {
            log.error("生成MQTT凭据失败: {}", e.getMessage());
            return null;
        }
    }

    private DeviceReportRespDTO.Firmware buildFirmwareInfo(String type, String currentVersion) {
        if (StringUtils.isBlank(type)) {
            return null;
        }
        if (StringUtils.isBlank(currentVersion)) {
            currentVersion = "0.0.0";
        }

        // Check if there's a force update firmware for this type
        OtaEntity forceUpdateOta = otaService.getForceUpdateFirmware(type);
        DeviceReportRespDTO.Firmware firmware = new DeviceReportRespDTO.Firmware();
        String downloadUrl = null;

        if (forceUpdateOta != null) {
            // Force update mode: return the forced version
            if (!forceUpdateOta.getVersion().equals(currentVersion)) {
                String otaUrl = sysParamsService.getValue(Constant.SERVER_OTA, true);
                if (StringUtils.isBlank(otaUrl) || otaUrl.equals("null")) {
                    HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
                            .getRequestAttributes())
                            .getRequest();
                    otaUrl = request.getRequestURL().toString();
                }
                String uuid = UUID.randomUUID().toString();
                redisUtils.set(RedisKeys.getOtaIdKey(uuid), forceUpdateOta.getId());
                downloadUrl = otaUrl.replace("/ota/", "/otaMag/download/") + uuid;
            }

            firmware.setVersion(forceUpdateOta.getVersion());
            firmware.setUrl(downloadUrl == null ? Constant.INVALID_FIRMWARE_URL : downloadUrl);
            firmware.setForce(downloadUrl != null ? 1 : 0);

            return firmware;
        }

        // Normal mode - get latest firmware and compare versions
        OtaEntity ota = otaService.getLatestOta(type);

        if (ota != null) {
            if (compareVersions(ota.getVersion(), currentVersion) > 0) {
                String otaUrl = sysParamsService.getValue(Constant.SERVER_OTA, true);
                if (StringUtils.isBlank(otaUrl) || otaUrl.equals("null")) {
                    HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
                            .getRequestAttributes())
                            .getRequest();
                    otaUrl = request.getRequestURL().toString();
                }
                String uuid = UUID.randomUUID().toString();
                redisUtils.set(RedisKeys.getOtaIdKey(uuid), ota.getId());
                downloadUrl = otaUrl.replace("/ota/", "/otaMag/download/") + uuid;
            }
        }

        firmware.setVersion(ota == null ? currentVersion : ota.getVersion());
        firmware.setUrl(downloadUrl == null ? Constant.INVALID_FIRMWARE_URL : downloadUrl);
        firmware.setForce(0);

        return firmware;
    }

    /**
     * 比较两个版本号
     * 
     * @param version1 版本1
     * @param version2 版本2
     * @return 如果version1 > version2返回1，version1 < version2返回-1，相等返回0
     */
    private static int compareVersions(String version1, String version2) {
        if (version1 == null || version2 == null) {
            return 0;
        }

        String[] v1Parts = version1.split("\\.");
        String[] v2Parts = version2.split("\\.");

        int length = Math.max(v1Parts.length, v2Parts.length);
        for (int i = 0; i < length; i++) {
            int v1 = i < v1Parts.length ? Integer.parseInt(v1Parts[i]) : 0;
            int v2 = i < v2Parts.length ? Integer.parseInt(v2Parts[i]) : 0;

            if (v1 > v2) {
                return 1;
            } else if (v1 < v2) {
                return -1;
            }
        }
        return 0;
    }

    @Override
    public void manualAddDevice(Long userId, DeviceManualAddDTO dto) {
        // 检查mac是否已存在
        QueryWrapper<DeviceEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("mac_address", dto.getMacAddress());
        DeviceEntity exist = baseDao.selectOne(wrapper);
        if (exist != null) {
            throw new RenException("该Mac地址已存在");
        }
        Date now = new Date();
        DeviceEntity entity = new DeviceEntity();
        entity.setId(dto.getMacAddress());
        entity.setUserId(userId);
        entity.setAgentId(dto.getAgentId());
        entity.setBoard(dto.getBoard());
        entity.setAppVersion(dto.getAppVersion());
        entity.setMacAddress(dto.getMacAddress());
        entity.setCreateDate(now);
        entity.setUpdateDate(now);
        entity.setLastConnectedAt(now);
        entity.setCreator(userId);
        entity.setUpdater(userId);
        entity.setAutoUpdate(1);
        baseDao.insert(entity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public ModeCycleResponse cycleDeviceMode(String macAddress) {
        // 1. Get device by MAC address
        DeviceEntity device = this.getDeviceByMacAddress(macAddress);
        if (device == null) {
            throw new RenException("Device not found for MAC address: " + macAddress);
        }

        String currentMode = device.getMode();
        if (currentMode == null || currentMode.isEmpty()) {
            currentMode = "conversation"; // Default if null
        }

        // 2. Cycle through modes: conversation → music → story → conversation
        String newMode;
        switch (currentMode.toLowerCase()) {
            case "conversation":
                newMode = "music";
                break;
            case "music":
                newMode = "story";
                break;
            case "story":
                newMode = "conversation";
                break;
            default:
                newMode = "conversation"; // Reset to default if invalid
                break;
        }

        // 3. Update device mode
        device.setMode(newMode);
        device.setUpdateDate(new Date());
        this.updateById(device);

        // 4. Build response
        ModeCycleResponse response = new ModeCycleResponse();
        response.setSuccess(true);
        response.setDeviceId(device.getId());
        response.setOldMode(currentMode);
        response.setNewMode(newMode);
        response.setMessage("Mode changed successfully from " + currentMode + " to " + newMode);

        // 5. Log the change
        System.out.println("🔄 ===== DEVICE MODE CYCLE =====");
        System.out.println("Device MAC: " + macAddress);
        System.out.println("Device ID: " + device.getId());
        System.out.println("Mode Change: " + currentMode + " → " + newMode);
        System.out.println("Database Updated: YES ✅");
        System.out.println("================================");

        return response;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String updateDeviceControlMode(String macAddress, String deviceMode) {
        // 1. Get device by MAC address
        DeviceEntity device = this.getDeviceByMacAddress(macAddress);
        if (device == null) {
            throw new RenException("Device not found for MAC address: " + macAddress);
        }

        // 2. Store previous mode
        String previousMode = device.getDeviceMode();
        if (previousMode == null || previousMode.isEmpty()) {
            previousMode = "manual"; // Default if null
        }

        // 3. Validate new mode
        if (!deviceMode.equals("manual") && !deviceMode.equals("auto")) {
            throw new RenException("Invalid device mode. Must be 'manual' or 'auto'");
        }

        // 4. Update device control mode
        device.setDeviceMode(deviceMode);
        device.setUpdateDate(new Date());
        this.updateById(device);

        // 5. Log the change
        log.info("🔧 [DEVICE-MODE] MAC: {} | {} → {}", macAddress, previousMode, deviceMode);

        return previousMode;
    }
}
