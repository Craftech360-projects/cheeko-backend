package cheeko.modules.agent.service.impl;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;

import cheeko.common.constant.Constant;
import cheeko.common.page.PageData;
import cheeko.common.utils.ConvertUtils;
import cheeko.common.utils.JsonUtils;
import cheeko.modules.agent.Enums.AgentChatHistoryType;
import cheeko.modules.agent.dao.AiAgentChatHistoryDao;
import cheeko.modules.agent.dto.AgentChatHistoryDTO;
import cheeko.modules.agent.dto.AgentChatSessionDTO;
import cheeko.modules.agent.entity.AgentChatHistoryEntity;
import cheeko.modules.agent.service.AgentChatHistoryService;
import cheeko.modules.agent.vo.AgentChatHistoryUserVO;

/**
 * AgentChatRecordTableHandleservice {@link AgentChatHistoryService} impl
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
@Service
public class AgentChatHistoryServiceImpl extends ServiceImpl<AiAgentChatHistoryDao, AgentChatHistoryEntity>
        implements AgentChatHistoryService {

    @Override
    public PageData<AgentChatSessionDTO> getSessionListByAgentId(Map<String, Object> params) {
        String agentId = (String) params.get("agentId");
        int page = Integer.parseInt(params.get(Constant.PAGE).toString());
        int limit = Integer.parseInt(params.get(Constant.LIMIT).toString());

        // Get all messages for this agent, then group by session manually
        QueryWrapper<AgentChatHistoryEntity> allMessagesWrapper = new QueryWrapper<>();
        allMessagesWrapper.eq("agent_id", agentId)
                .orderByDesc("created_at");

        List<AgentChatHistoryEntity> allMessages = list(allMessagesWrapper);

        // Group by session ID and get unique session IDs in order of latest message
        Map<String, List<AgentChatHistoryEntity>> sessionGroups = allMessages.stream()
                .collect(Collectors.groupingBy(AgentChatHistoryEntity::getSessionId,
                        LinkedHashMap::new, Collectors.toList()));

        List<String> sessionIds = new ArrayList<>(sessionGroups.keySet());

        // Calculate pagination manually
        int totalSessions = sessionIds.size();
        int startIndex = (page - 1) * limit;
        int endIndex = Math.min(startIndex + limit, totalSessions);

        List<String> paginatedSessionIds = sessionIds.subList(startIndex, endIndex);

        List<AgentChatSessionDTO> records = new ArrayList<>();

        // For each paginated session, get the earliest message time (same logic as chat detail)
        for (String sessionId : paginatedSessionIds) {
            List<AgentChatHistoryEntity> sessionMessages = sessionGroups.get(sessionId);

            if (!sessionMessages.isEmpty()) {
                // Find session creation time (earliest message) - SAME LOGIC AS CHAT DETAIL
                java.util.Date sessionCreationTime = sessionMessages.stream()
                    .map(AgentChatHistoryEntity::getCreatedAt)
                    .min(java.util.Date::compareTo)
                    .orElse(new java.util.Date());

                AgentChatSessionDTO dto = new AgentChatSessionDTO();
                dto.setSessionId(sessionId);
                dto.setCreatedAt(sessionCreationTime);
                dto.setChatCount(sessionMessages.size());

                System.out.println("🔥 BACKEND SIDEBAR TIME - SessionID: " + sessionId +
                                 ", Session creation time: " + sessionCreationTime +
                                 ", Messages: " + sessionMessages.size());

                records.add(dto);
            }
        }

        return new PageData<>(records, totalSessions);
    }

    @Override
    public List<AgentChatHistoryDTO> getChatHistoryBySessionId(String agentId, String sessionId) {
        // BuildQueryCondition
        QueryWrapper<AgentChatHistoryEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("agent_id", agentId)
                .eq("session_id", sessionId)
                .orderByAsc("created_at");

        // QueryChatRecord
        List<AgentChatHistoryEntity> historyList = list(wrapper);

        // ConvertAsDTO
        List<AgentChatHistoryDTO> dtoList = ConvertUtils.sourceToTarget(historyList, AgentChatHistoryDTO.class);

        // Get session creation time (MIN(created_at)) to match sidebar
        if (!historyList.isEmpty()) {
            // Find the earliest message timestamp (session creation time)
            java.util.Date sessionCreationTime = historyList.stream()
                .map(AgentChatHistoryEntity::getCreatedAt)
                .min(java.util.Date::compareTo)
                .orElse(new java.util.Date());

            // Set all messages to use session creation time to match sidebar
            for (AgentChatHistoryDTO dto : dtoList) {
                dto.setCreatedAt(sessionCreationTime);
            }

            System.out.println("💬 BACKEND CHAT TIME - SessionID: " + sessionId +
                             ", Using session creation time for all messages: " + sessionCreationTime +
                             ", Total messages: " + dtoList.size());
        }

        return dtoList;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteByAgentId(String agentId, Boolean deleteAudio, Boolean deleteText) {
        // If deleting audio references (audio_id column), clear them first
        if (deleteAudio && !deleteText) {
            baseMapper.deleteAudioIdByAgentId(agentId);
        }
        // If deleting text, delete the entire history rows (audio_id gets deleted with them)
        if (deleteText) {
            baseMapper.deleteHistoryByAgentId(agentId);
        }
    }

    @Override
    public List<AgentChatHistoryUserVO> getRecentlyFiftyByAgentId(String agentId) {
        // Build query condition (no sorting by create time added since data is already ordered by primary key - larger ID means later create time
        // Not adding this reduces the full table scan cost during pagination sorting)
        LambdaQueryWrapper<AgentChatHistoryEntity> wrapper = new LambdaQueryWrapper<>();
        wrapper.select(AgentChatHistoryEntity::getContent, AgentChatHistoryEntity::getAudioId)
                .eq(AgentChatHistoryEntity::getAgentId, agentId)
                .eq(AgentChatHistoryEntity::getChatType, AgentChatHistoryType.USER.getValue())
                .isNotNull(AgentChatHistoryEntity::getAudioId)
                // Add this line to ensure query results are sorted by create time in descending order
                // Using ID because: in data format, larger ID means later create time, so using ID gives the same result as sorting by create time descending
                // Advantage of sorting by ID in descending order: high performance, has primary key index, no need to re-sort and scan compare during sorting
                .orderByDesc(AgentChatHistoryEntity::getId);

        // Build pagination query, query first 50 records
        Page<AgentChatHistoryEntity> pageParam = new Page<>(0, 50);
        IPage<AgentChatHistoryEntity> result = this.baseMapper.selectPage(pageParam, wrapper);
        return result.getRecords().stream().map(item -> {
            AgentChatHistoryUserVO vo = ConvertUtils.sourceToTarget(item, AgentChatHistoryUserVO.class);
            // Handle content field, ensure only chat content is returned
            if (vo != null && vo.getContent() != null) {
                vo.setContent(extractContentFromString(vo.getContent()));
            }
            return vo;
        }).toList();
    }

    /**
     * Extract chat content from content field
     * If content is JSON format (e.g., {"speaker": "Unknown speaker", "content": "What time is it now."}), extract the content field
     * If content is a plain string, return directly
     *
     * @param content Original content
     * @return Extracted chat content
     */
    private String extractContentFromString(String content) {
        if (content == null || content.trim().isEmpty()) {
            return content;
        }

        // Try to parse as JSON
        try {
            Map<String, Object> jsonMap = JsonUtils.parseObject(content, Map.class);
            if (jsonMap != null && jsonMap.containsKey("content")) {
                Object contentObj = jsonMap.get("content");
                return contentObj != null ? contentObj.toString() : content;
            }
        } catch (Exception e) {
            // If not valid JSON, return original content directly
        }

        // If not JSON format or no content field, return original content directly
        return content;
    }

    @Override
    public String getContentByAudioId(String audioId) {
        AgentChatHistoryEntity agentChatHistoryEntity = baseMapper
                .selectOne(new LambdaQueryWrapper<AgentChatHistoryEntity>()
                        .select(AgentChatHistoryEntity::getContent)
                        .eq(AgentChatHistoryEntity::getAudioId, audioId));
        return agentChatHistoryEntity == null ? null : agentChatHistoryEntity.getContent();
    }

    @Override
    public boolean isAudioOwnedByAgent(String audioId, String agentId) {
        // Query whether data with specified audio ID and agent ID exists. If it exists and there is only one record, it indicates this data belongs to this agent
        Long row = baseMapper.selectCount(new LambdaQueryWrapper<AgentChatHistoryEntity>()
                .eq(AgentChatHistoryEntity::getAudioId, audioId)
                .eq(AgentChatHistoryEntity::getAgentId, agentId));
        return row == 1;
    }
}
