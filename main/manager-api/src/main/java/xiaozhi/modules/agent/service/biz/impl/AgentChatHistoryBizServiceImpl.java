package xiaozhi.modules.agent.service.biz.impl;

import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.redis.RedisKeys;
import xiaozhi.common.redis.RedisUtils;
import xiaozhi.modules.agent.dto.AgentChatHistoryReportDTO;
import xiaozhi.modules.agent.dto.AgentChatHistorySessionDTO;
import xiaozhi.modules.agent.entity.AgentChatHistoryEntity;
import xiaozhi.modules.agent.entity.AgentEntity;
import xiaozhi.modules.agent.service.AgentChatAudioService;
import xiaozhi.modules.agent.service.AgentChatHistoryService;
import xiaozhi.modules.agent.service.AgentService;
import xiaozhi.modules.agent.service.biz.AgentChatHistoryBizService;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.service.DeviceService;

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
    private final AgentChatAudioService agentChatAudioService;
    private final RedisUtils redisUtils;
    private final DeviceService deviceService;

    /**
     * 处理聊天记录上报，包括文件上传和相关信息记录
     *
     * @param report 包含聊天上报所需信息的输入对象
     * @return 上传结果，true表示成功，false表示失败
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean report(AgentChatHistoryReportDTO report) {
        String macAddress = report.getMacAddress();
        Byte chatType = report.getChatType();
        Long reportTimeMillis = null != report.getReportTime() ? report.getReportTime() * 1000 : System.currentTimeMillis();
        log.info("小智设备聊天上报请求: macAddress={}, type={} reportTime={}", macAddress, chatType, reportTimeMillis);

        // 根据设备MAC地址查询对应的默认智能体，判断是否需要上报
        AgentEntity agentEntity = agentService.getDefaultAgentByMacAddress(macAddress);
        if (agentEntity == null) {
            return Boolean.FALSE;
        }

        Integer chatHistoryConf = agentEntity.getChatHistoryConf();
        String agentId = agentEntity.getId();

        if (Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT.getCode())) {
            saveChatText(report, agentId, macAddress, null, reportTimeMillis);
        } else if (Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT_AUDIO.getCode())) {
            String audioId = saveChatAudio(report);
            saveChatText(report, agentId, macAddress, audioId, reportTimeMillis);
        }

        // 更新设备最后对话时间
        redisUtils.set(RedisKeys.getAgentDeviceLastConnectedAtById(agentId), new Date());

        // 更新设备最后连接时间
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device != null) {
            deviceService.updateDeviceConnectionInfo(agentId, device.getId(), null);
        } else {
            log.warn("聊天记录上报时，未找到mac地址为 {} 的设备", macAddress);
        }

        return Boolean.TRUE;
    }

    /**
     * base64解码report.getOpusDataBase64(),存入ai_agent_chat_audio表
     */
    private String saveChatAudio(AgentChatHistoryReportDTO report) {
        String audioId = null;

        if (report.getAudioBase64() != null && !report.getAudioBase64().isEmpty()) {
            try {
                byte[] audioData = Base64.getDecoder().decode(report.getAudioBase64());
                audioId = agentChatAudioService.saveAudio(audioData);
                log.info("音频数据保存成功，audioId={}", audioId);
            } catch (Exception e) {
                log.error("音频数据保存失败", e);
                return null;
            }
        }
        return audioId;
    }

    /**
     * 组装上报数据
     */
    private void saveChatText(AgentChatHistoryReportDTO report, String agentId, String macAddress, String audioId, Long reportTime) {
        // 构建聊天记录实体
        AgentChatHistoryEntity entity = AgentChatHistoryEntity.builder()
                .macAddress(macAddress)
                .agentId(agentId)
                .sessionId(report.getSessionId())
                .chatType(report.getChatType())
                .content(report.getContent())
                .audioId(audioId)
                .createdAt(new Date(reportTime))
                // NOTE(haotian): 2025/5/26 updateAt可以不设置，重点是createAt，而且这样可以看到上报延迟
                .build();

        // 保存数据
        agentChatHistoryService.save(entity);

        log.info("设备 {} 对应智能体 {} 上报成功", macAddress, agentId);
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

        // Check chat history config
        Integer chatHistoryConf = agentEntity.getChatHistoryConf();
        log.info("📝 [SESSION] Agent {} chat history config: {}", agentId, chatHistoryConf);

        if (!Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT.getCode()) &&
            !Objects.equals(chatHistoryConf, Constant.ChatHistoryConfEnum.RECORD_TEXT_AUDIO.getCode())) {
            log.info("📝 [SESSION] Chat history recording disabled for agent: {}", agentId);
            return Boolean.TRUE;
        }

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
