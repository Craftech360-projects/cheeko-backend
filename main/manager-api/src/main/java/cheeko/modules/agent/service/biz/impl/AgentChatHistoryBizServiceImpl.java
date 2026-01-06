package cheeko.modules.agent.service.biz.impl;

import java.util.Date;
import java.util.List;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.modules.agent.dto.AgentChatHistoryReportDTO;
import cheeko.modules.agent.dto.AgentChatHistorySessionDTO;
import cheeko.modules.agent.entity.AgentChatHistoryEntity;
import cheeko.modules.agent.entity.AgentEntity;
import cheeko.modules.agent.service.AgentChatHistoryService;
import cheeko.modules.agent.service.AgentService;
import cheeko.modules.agent.service.biz.AgentChatHistoryBizService;
import cheeko.modules.device.entity.DeviceEntity;
import cheeko.modules.device.service.DeviceService;

/**
 * {@link AgentChatHistoryBizService} impl
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AgentChatHistoryBizServiceImpl implements AgentChatHistoryBizService {
    private final AgentService agentService;
    private final AgentChatHistoryService agentChatHistoryService;
    private final RedisUtils redisUtils;
    private final DeviceService deviceService;

    /**
     * Handle chat record report, including file upload and related information record
     *
     * @param report Input object containing chat report information
     * @return Upload result, true indicates success, false indicates failure
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean report(AgentChatHistoryReportDTO report) {
        String macAddress = report.getMacAddress();
        Byte chatType = report.getChatType();
        Long reportTimeMillis = null != report.getReportTime() ? report.getReportTime() * 1000 : System.currentTimeMillis();
        log.info("Cheeko device chat report request: macAddress={}, type={} reportTime={}", macAddress, chatType, reportTimeMillis);

        // Query corresponding default agent by device MAC address to determine whether report is required
        AgentEntity agentEntity = agentService.getDefaultAgentByMacAddress(macAddress);
        if (agentEntity == null) {
            return Boolean.FALSE;
        }

        Integer chatHistoryConf = agentEntity.getChatHistoryConf();
        String agentId = agentEntity.getId();

        if (Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT.getCode())
                || Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT_AUDIO.getCode())) {
            // Audio recording removed - only save text
            saveChatText(report, agentId, macAddress, null, reportTimeMillis);
        }

        // Update device last conversation time
        redisUtils.set(RedisKeys.getAgentDeviceLastConnectedAtById(agentId), new Date());

        // Update device last connection time
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device != null) {
            deviceService.updateDeviceConnectionInfo(agentId, device.getId(), null);
        } else {
            log.warn("During chat record report, device with macAddress {} not found", macAddress);
        }

        return Boolean.TRUE;
    }

    /**
     * Assemble report data
     */
    private void saveChatText(AgentChatHistoryReportDTO report, String agentId, String macAddress, String audioId, Long reportTime) {
        // Build chat record entity
        AgentChatHistoryEntity entity = AgentChatHistoryEntity.builder()
                .macAddress(macAddress)
                .agentId(agentId)
                .sessionId(report.getSessionId())
                .chatType(report.getChatType())
                .content(report.getContent())
                .audioId(audioId)
                .createdAt(new Date(reportTime))
                // NOTE(haotian): 2025/5/26 updateAt can be left unset, focus is on createdAt, and this way we can see report delay
                .build();

        // SaveData
        agentChatHistoryService.save(entity);

        log.info("Device {} CorrespondingAgent {} ReportSuccess", macAddress, agentId);
    }

    /**
     * LiveKit Agent session batch upload
     * Saves entire session chat history at once when room closes
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean reportSession(AgentChatHistorySessionDTO sessionDTO) {
        String macAddress = sessionDTO.getMacAddress();
        String sessionId = sessionDTO.getSessionId();
        String agentIdFromRequest = sessionDTO.getAgentId();
        List<AgentChatHistorySessionDTO.ChatMessage> messages = sessionDTO.getMessages();

        log.info("📝 [SESSION] Processing batch upload - MAC: {}, Session: {}", macAddress, sessionId);

        if (messages == null || messages.isEmpty()) {
            log.warn("📝 [SESSION] No messages to save");
            return Boolean.TRUE;
        }

        log.info("📝 [SESSION] Messages to process: {}", messages.size());

        // Get agent entity - try from request first, then by MAC
        String agentId = agentIdFromRequest;
        AgentEntity agentEntity = null;

        if (agentId != null && !agentId.isEmpty()) {
            agentEntity = agentService.selectById(agentId);
            log.info("📝 [SESSION] Found agent by ID: {}", agentId);
        }

        if (agentEntity == null) {
            agentEntity = agentService.getDefaultAgentByMacAddress(macAddress);
            if (agentEntity != null) {
                agentId = agentEntity.getId();
                log.info("📝 [SESSION] Found agent by MAC: {}", agentId);
            }
        }

        if (agentEntity == null) {
            log.warn("📝 [SESSION] No agent found for MAC: {} or agentId: {}", macAddress, agentIdFromRequest);
            return Boolean.FALSE;
        }

        // Always save chat history regardless of agent config
        log.info("📝 [SESSION] Saving chat history for agent: {}", agentId);

        // Save each message
        int savedCount = 0;
        for (AgentChatHistorySessionDTO.ChatMessage msg : messages) {
            try {
                Long timestamp = msg.getTimestamp() != null ? msg.getTimestamp() * 1000 : System.currentTimeMillis();
                Byte chatType = msg.getChatType() != null ? msg.getChatType().byteValue() : 2;

                AgentChatHistoryEntity entity = AgentChatHistoryEntity.builder()
                        .macAddress(macAddress)
                        .agentId(agentId)
                        .sessionId(sessionId)
                        .chatType(chatType)
                        .content(msg.getContent())
                        .createdAt(new Date(timestamp))
                        .build();

                agentChatHistoryService.save(entity);
                savedCount++;

                String typeStr = chatType == 1 ? "USER" : "AGENT";
                log.debug("📝 [SESSION] Saved message {}/{}: {} - '{}'",
                    savedCount, messages.size(), typeStr,
                    msg.getContent() != null ? msg.getContent().substring(0, Math.min(30, msg.getContent().length())) : "null");

            } catch (Exception e) {
                log.error("📝 [SESSION] Error saving message: {}", e.getMessage());
            }
        }

        log.info("📝 [SESSION] Successfully saved {}/{} messages for session: {}",
            savedCount, messages.size(), sessionId);

        // Update device last connection time
        redisUtils.set(RedisKeys.getAgentDeviceLastConnectedAtById(agentId), new Date());

        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device != null) {
            deviceService.updateDeviceConnectionInfo(agentId, device.getId(), null);
        }

        return Boolean.TRUE;
    }
}
