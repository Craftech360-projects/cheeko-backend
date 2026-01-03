package cheeko.modules.device.service;

import java.util.Date;
import java.util.List;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.device.dto.DevicePageUserDTO;
import cheeko.modules.device.dto.DeviceReportReqDTO;
import cheeko.modules.device.dto.DeviceReportRespDTO;
import cheeko.modules.device.dto.DeviceManualAddDTO;
import cheeko.modules.device.dto.ModeCycleResponse;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.vo.UserShowDeviceListVO;

public interface DeviceService extends BaseService<DeviceEntity> {

    /**
     * Check if device is activated
     */
    DeviceReportRespDTO checkDeviceActive(String macAddress, String clientId,
            DeviceReportReqDTO deviceReport);

    /**
     * Get user's device list for specified agent
     */
    List<DeviceEntity> getUserDevices(Long userId, String agentId);

    /**
     * Get all device list for specified agent (Admin only)
     */
    List<DeviceEntity> getDevicesByAgentId(String agentId);

    /**
     * Unbind device
     */
    void unbindDevice(Long userId, String deviceId);

    /**
     * Device activation
     */
    DeviceEntity deviceActivation(String agentId, String activationCode);

    /**
     * Delete all devices for this user
     * 
     * @param userId User ID
     */
    void deleteByUserId(Long userId);

    /**
     * Delete all devices associated with specified agent
     * 
     * @param agentId Agent ID
     */
    void deleteByAgentId(String agentId);

    /**
     * Get device count for specified user
     * 
     * @param userId User ID
     * @return Device count
     */
    Long selectCountByUserId(Long userId);

    /**
     * Pagination get all device information
     *
     * @param dto Pagination query parameters
     * @return User list pagination data
     */
    PageData<UserShowDeviceListVO> page(DevicePageUserDTO dto);

    /**
     * Get device information by MAC address
     * 
     * @param macAddress MAC address
     * @return Device information
     */
    DeviceEntity getDeviceByMacAddress(String macAddress);

    /**
     * Get activation code by device ID
     * 
     * @param deviceId Device ID
     * @return Activation code
     */
    String geCodeByDeviceId(String deviceId);

    /**
     * Get the most recent last connection time for this agent's devices
     * @param agentId Agent ID
     * @return Returns device's most recent last connection time
     */
    Date getLatestLastConnectionTime(String agentId);

    /**
     * Manually add device
     */
    void manualAddDevice(Long userId, DeviceManualAddDTO dto);

    /**
     * Update device connection information
     */
    void updateDeviceConnectionInfo(String agentId, String deviceId, String appVersion);

    /**
     * Cycle through device modes by device MAC address
     * Used for device button triggered mode switching
     *
     * @param macAddress Device MAC address
     * @return Mode switching response information
     */
    ModeCycleResponse cycleDeviceMode(String macAddress);

}