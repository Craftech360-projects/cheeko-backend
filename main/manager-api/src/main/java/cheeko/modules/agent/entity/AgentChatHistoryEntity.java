package cheeko.modules.agent.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * AgentChatRecordTable
 *
 * @author Goody
 * @version 1.0, 2025/4/30
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "ai_agent_chat_history")
public class AgentChatHistoryEntity {
    /**
     * Primary KeyID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * MACAddress
     */
    @TableField(value = "mac_address")
    private String macAddress;

    /**
     * Agentid
     */
    @TableField(value = "agent_id")
    private String agentId;

    /**
     * SessionID
     */
    @TableField(value = "session_id")
    private String sessionId;

    /**
     * MessageType: 1-User, 2-Agent
     */
    @TableField(value = "chat_type")
    private Byte chatType;

    /**
     * ChatContent
     */
    @TableField(value = "content")
    private String content;

    /**
     * Audiobase64Data
     */
    @TableField(value = "audio_id")
    private String audioId;

    /**
     * Create Time
     */
    @TableField(value = "created_at")
    private Date createdAt;

    /**
     * Update Time
     */
    @TableField(value = "updated_at")
    private Date updatedAt;
}
