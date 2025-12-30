package xiaozhi.modules.agent.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.utils.Result;
import xiaozhi.modules.agent.dto.AgentChatHistoryReportDTO;
import xiaozhi.modules.agent.dto.AgentChatHistorySessionDTO;
import xiaozhi.modules.agent.service.biz.AgentChatHistoryBizService;

@Tag(name = "Agent Chat History Management")
@RequiredArgsConstructor
@RestController
@RequestMapping("/agent/chat-history")
@Slf4j
public class AgentChatHistoryController {
    private final AgentChatHistoryBizService agentChatHistoryBizService;

    /**
     * 小智服务聊天上报请求
     * <p>
     * 小智服务聊天上报请求，包含Base64编码的音频数据和相关信息。
     *
     * @param request 包含上传文件及相关信息的请求对象
     */
    @Operation(summary = "Xiaozhi service chat report request")
    @PostMapping("/report")
    public Result<Boolean> uploadFile(@Valid @RequestBody AgentChatHistoryReportDTO request) {
        Boolean result = agentChatHistoryBizService.report(request);
        return new Result<Boolean>().ok(result);
    }

    /**
     * LiveKit Agent session chat history batch upload
     * Called when room closes to save entire session history at once
     *
     * @param request Session chat history with all messages
     */
    @Operation(summary = "LiveKit Agent session chat history batch upload")
    @PostMapping("/session")
    public Result<Boolean> uploadSession(@Valid @RequestBody AgentChatHistorySessionDTO request) {
        log.info("📝 [CHAT-HISTORY] Received session upload request");
        log.info("📝 [CHAT-HISTORY] MAC: {}, SessionID: {}, AgentID: {}",
            request.getMacAddress(), request.getSessionId(), request.getAgentId());
        log.info("📝 [CHAT-HISTORY] Message count: {}, SessionEnd: {}",
            request.getMessageCount(), request.getSessionEnd());

        if (request.getMessages() != null) {
            log.info("📝 [CHAT-HISTORY] Messages in payload: {}", request.getMessages().size());
            for (int i = 0; i < request.getMessages().size(); i++) {
                AgentChatHistorySessionDTO.ChatMessage msg = request.getMessages().get(i);
                String typeStr = msg.getChatType() == 1 ? "USER" : "AGENT";
                String preview = msg.getContent() != null ?
                    msg.getContent().substring(0, Math.min(50, msg.getContent().length())) : "null";
                log.info("📝 [CHAT-HISTORY]   [{}] {}: '{}'...", i+1, typeStr, preview);
            }
        } else {
            log.warn("📝 [CHAT-HISTORY] Messages list is NULL!");
        }

        Boolean result = agentChatHistoryBizService.reportSession(request);
        log.info("📝 [CHAT-HISTORY] Save result: {}", result);
        return new Result<Boolean>().ok(result);
    }
}
