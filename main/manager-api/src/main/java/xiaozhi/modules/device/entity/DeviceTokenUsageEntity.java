package xiaozhi.modules.device.entity;

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
 * Device Token Usage - tracks token usage per device per day
 *
 * @author claude
 * @version 1.0, 2025/12/06
 * @since 1.0.0
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@TableName(value = "device_token_usage")
public class DeviceTokenUsageEntity {
    /**
     * Primary Key ID
     */
    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * Device MAC Address
     */
    @TableField(value = "mac_address")
    private String macAddress;

    /**
     * Usage date
     */
    @TableField(value = "usage_date")
    private Date usageDate;

    /**
     * Total input tokens for the day
     */
    @TableField(value = "input_tokens")
    private Long inputTokens;

    /**
     * Total output tokens for the day
     */
    @TableField(value = "output_tokens")
    private Long outputTokens;

    /**
     * Number of sessions that day
     */
    @TableField(value = "session_count")
    private Integer sessionCount;

    /**
     * Record creation time
     */
    @TableField(value = "created_at")
    private Date createdAt;

    /**
     * Record update time
     */
    @TableField(value = "updated_at")
    private Date updatedAt;
}
