package cheeko.modules.device.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = false)
@TableName("ai_device")
@Schema(description = "DeviceInformation")
public class DeviceEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    @Schema(description = "ID")
    private String id;

    @Schema(description = "Associated user ID")
    private Long userId;

    @Schema(description = "MACAddress")
    private String macAddress;

    @Schema(description = "LastConnectionTime")
    private Date lastConnectedAt;

    @Schema(description = "Auto update switch (0: Off / 1: On)")
    private Integer autoUpdate;

    @Schema(description = "Device hardware model")
    private String board;

    @Schema(description = "Device alias")
    private String alias;

    @Schema(description = "AgentID")
    private String agentId;

    @Schema(description = "Associated child ID")
    private Long kidId;

    @Schema(description = "Device mode (conversation/music/story)")
    private String mode;

    @Schema(description = "Device PTT mode (auto/manual)")
    private String deviceMode;

    @Schema(description = "Firmware version number")
    private String appVersion;

    @Schema(description = "Sort Order")
    private Integer sort;

    @Schema(description = "Updater")
    @TableField(fill = FieldFill.UPDATE)
    private Long updater;

    @Schema(description = "Update Time")
    @TableField(fill = FieldFill.UPDATE)
    private Date updateDate;

    @Schema(description = "Creator")
    @TableField(fill = FieldFill.INSERT)
    private Long creator;

    @Schema(description = "Create Time")
    @TableField(fill = FieldFill.INSERT)
    private Date createDate;
}