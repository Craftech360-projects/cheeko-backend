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
        if (deleteAudio) {
            baseMapper.deleteAudioByAgentId(agentId);
        }
        if (deleteAudio && !deleteText) {
            baseMapper.deleteAudioIdByAgentId(agentId);
        }
        if (deleteText) {
            baseMapper.deleteHistoryByAgentId(agentId);
        }

    }

    @Override
    public List<AgentChatHistoryUserVO> getRecentlyFiftyByAgentId(String agentId) {
        // BuildQueryCondition(不添加按照Create TimeSort Order，Data本来就IsPrimary Key越LargeCreate Time越Large
        // 不添加这样Can减少Sort OrderAllData在Paginations 全盘扫描消耗)
        LambdaQueryWrapper<AgentChatHistoryEntity> wrapper = new LambdaQueryWrapper<>();
        wrapper.select(AgentChatHistoryEntity::getContent, AgentChatHistoryEntity::getAudioId)
                .eq(AgentChatHistoryEntity::getAgentId, agentId)
                .eq(AgentChatHistoryEntity::getChatType, AgentChatHistoryType.USER.getValue())
                .isNotNull(AgentChatHistoryEntity::getAudioId)
                // 添加此行，确保QueryResult按照Create TimeDescending排列
                // Useids 原因：Data形式，id越Larges Create Time就越晚，所以Useids Result和Create TimeDescending排列Result一样
                // idAsAsDescending排列s 优势，性能高，HavePrimary Key索引，不用在Sort Orders Time候重新进行排Except扫描比较
                .orderByDesc(AgentChatHistoryEntity::getId); 

        // BuildPaginationQuery，Query前50页Data
        Page<AgentChatHistoryEntity> pageParam = new Page<>(0, 50);
        IPage<AgentChatHistoryEntity> result = this.baseMapper.selectPage(pageParam, wrapper);
        return result.getRecords().stream().map(item -> {
            AgentChatHistoryUserVO vo = ConvertUtils.sourceToTarget(item, AgentChatHistoryUserVO.class);
            // Handle content Field，确保OnlyReturnChatContent
            if (vo != null && vo.getContent() != null) {
                vo.setContent(extractContentFromString(vo.getContent()));
            }
            return vo;
        }).toList();
    }

    /**
     * from content Field中提取ChatContent
     * If content Is JSON 格式（如 {"speaker": "未知说话Person", "content": "Current在几点d 。"}），Then提取 content
     * Field
     * If content Is普通String，ThenDirectlyReturn
     * 
     * @param content 原始Content
     * @return 提取s ChatContent
     */
    private String extractContentFromString(String content) {
        if (content == null || content.trim().isEmpty()) {
            return content;
        }

        // 尝试ParseAs JSON
        try {
            Map<String, Object> jsonMap = JsonUtils.parseObject(content, Map.class);
            if (jsonMap != null && jsonMap.containsKey("content")) {
                Object contentObj = jsonMap.get("content");
                return contentObj != null ? contentObj.toString() : content;
            }
        } catch (Exception e) {
            // IfNotValids  JSON，DirectlyReturn原Content
        }

        // IfNot JSON 格式OrNot Have content Field，DirectlyReturn原Content
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
        // QueryWhetherHavespecifiedAudioid和Agentids Data，IfHave且OnlyHave一条Description此DataProperty此Agent
        Long row = baseMapper.selectCount(new LambdaQueryWrapper<AgentChatHistoryEntity>()
                .eq(AgentChatHistoryEntity::getAudioId, audioId)
                .eq(AgentChatHistoryEntity::getAgentId, agentId));
        return row == 1;
    }
}
