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
@TableName("ai_ota")
@Schema(description = "FirmwareInformation")
public class OtaEntity {

    @TableId(type = IdType.ASSIGN_UUID)
    @Schema(description = "ID")
    private String id;

    @Schema(description = "FirmwareName")
    private String firmwareName;

    @Schema(description = "FirmwareType")
    private String type;

    @Schema(description = "Version number")
    private String version;

    @Schema(description = "File size (bytes)")
    private Long size;

    @Schema(description = "Remark/Description")
    private String remark;

    @Schema(description = "FirmwarePath")
    private String firmwarePath;

    @Schema(description = "Whether force update: 0-No, 1-Yes")
    private Integer forceUpdate;

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